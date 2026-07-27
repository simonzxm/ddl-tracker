import Foundation

public protocol SyncAPI: Sendable {
    func sync(_ request: SyncRequest) async throws -> SyncResponse
}

public enum SyncEngineError: Error, Equatable, Sendable {
    case unexpectedResponseMode(expected: SyncMode, actual: SyncMode)
    case missingCursorAfterSnapshot
}

public struct SyncRetryPolicy: Equatable, Sendable {
    public let maxRetries: Int
    public let initialDelayNanoseconds: UInt64
    public let maxDelayNanoseconds: UInt64
    public let jitterRatio: Double

    public static let standard = SyncRetryPolicy(
        maxRetries: 3,
        initialDelayNanoseconds: 500_000_000,
        maxDelayNanoseconds: 8_000_000_000,
        jitterRatio: 0.2
    )

    public init(
        maxRetries: Int,
        initialDelayNanoseconds: UInt64,
        maxDelayNanoseconds: UInt64,
        jitterRatio: Double
    ) {
        self.maxRetries = max(0, maxRetries)
        self.initialDelayNanoseconds = initialDelayNanoseconds
        self.maxDelayNanoseconds = max(initialDelayNanoseconds, maxDelayNanoseconds)
        self.jitterRatio = min(max(0, jitterRatio), 1)
    }

    func delayNanoseconds(
        retryIndex: Int,
        retryAfter: Int?,
        randomUnit: Double
    ) -> UInt64 {
        let exponent = min(max(0, retryIndex), 20)
        let exponential = min(
            Double(maxDelayNanoseconds),
            Double(initialDelayNanoseconds) * pow(2, Double(exponent))
        )
        let unit = min(max(randomUnit, 0), 1)
        let multiplier = 1 + ((unit * 2) - 1) * jitterRatio
        let jittered = UInt64(
            min(Double(maxDelayNanoseconds), max(0, exponential * multiplier))
        )

        guard let retryAfter, retryAfter > 0 else { return jittered }
        let seconds = UInt64(retryAfter)
        let (serverDelay, overflow) = seconds.multipliedReportingOverflow(by: 1_000_000_000)
        return max(jittered, overflow ? UInt64.max : serverDelay)
    }
}

public typealias SyncSleep = @Sendable (UInt64) async throws -> Void
public typealias SyncRandom = @Sendable () -> Double

public actor SyncEngine {
    private let api: any SyncAPI
    private let store: ClientStore
    private let retryPolicy: SyncRetryPolicy
    private let sleep: SyncSleep
    private let random: SyncRandom
    private var activeTask: Task<ClientStoreSnapshot, any Error>?

    public init(
        api: any SyncAPI,
        store: ClientStore,
        retryPolicy: SyncRetryPolicy = .standard,
        sleep: @escaping SyncSleep = { delay in
            try await Task<Never, Never>.sleep(nanoseconds: delay)
        },
        random: @escaping SyncRandom = { Double.random(in: 0 ... 1) }
    ) {
        self.api = api
        self.store = store
        self.retryPolicy = retryPolicy
        self.sleep = sleep
        self.random = random
    }

    public func synchronize() async throws -> ClientStoreSnapshot {
        if let activeTask { return try await activeTask.value }
        let task = Task { [api, store, retryPolicy, sleep, random] in
            try await Self.run(
                api: api,
                store: store,
                retryPolicy: retryPolicy,
                sleep: sleep,
                random: random
            )
        }
        activeTask = task
        do {
            let value = try await task.value
            activeTask = nil
            return value
        } catch {
            activeTask = nil
            throw error
        }
    }

    private static func run(
        api: any SyncAPI,
        store: ClientStore,
        retryPolicy: SyncRetryPolicy,
        sleep: @escaping SyncSleep,
        random: @escaping SyncRandom
    ) async throws -> ClientStoreSnapshot {
        var needsIncremental = true
        while true {
            var current = try await store.snapshot()

            if current.metadata.cursor == nil {
                if current.metadata.accountSnapshot == nil {
                    try await store.beginAccountSnapshot()
                    current = try await store.snapshot()
                }
                let checkpoint = current.metadata.accountSnapshot
                let response = try await request(
                    .accountSnapshot(.init(
                        snapshotToken: checkpoint?.snapshotToken,
                        pageToken: checkpoint?.pageToken,
                        snapshotLimit: 500
                    )),
                    api: api,
                    retryPolicy: retryPolicy,
                    sleep: sleep,
                    random: random
                )
                guard case let .accountSnapshot(snapshot) = response else {
                    throw SyncEngineError.unexpectedResponseMode(
                        expected: .accountSnapshot,
                        actual: response.mode
                    )
                }
                let committed = try await store.commit(snapshot)
                if snapshot.snapshotComplete, committed.metadata.cursor == nil {
                    throw SyncEngineError.missingCursorAfterSnapshot
                }
                continue
            }

            if let classSectionID = current.metadata.pendingClassSectionSnapshotIDs.first {
                if current.metadata.classSectionSnapshots[classSectionID] == nil {
                    try await store.beginClassSectionSnapshot(classSectionID)
                    current = try await store.snapshot()
                }
                let checkpoint = current.metadata.classSectionSnapshots[classSectionID]
                let cursor = current.metadata.cursor ?? ""
                let response = try await request(
                    .classSectionSnapshot(.init(
                        cursor: cursor,
                        classSectionID: classSectionID,
                        snapshotToken: checkpoint?.snapshotToken,
                        pageToken: checkpoint?.pageToken,
                        snapshotLimit: 500
                    )),
                    api: api,
                    retryPolicy: retryPolicy,
                    sleep: sleep,
                    random: random
                )
                guard case let .classSectionSnapshot(snapshot) = response else {
                    throw SyncEngineError.unexpectedResponseMode(
                        expected: .classSectionSnapshot,
                        actual: response.mode
                    )
                }
                _ = try await store.commit(snapshot)
                continue
            }

            guard needsIncremental else { return current }
            let operations = try await store.pendingOperations()
            let incrementalRequest = try IncrementalSyncRequest(
                cursor: current.metadata.cursor ?? "",
                eventLimit: 500,
                operations: operations
            )
            do {
                let response = try await request(
                    .incremental(incrementalRequest),
                    api: api,
                    retryPolicy: retryPolicy,
                    sleep: sleep,
                    random: random
                )
                guard case let .incremental(incremental) = response else {
                    throw SyncEngineError.unexpectedResponseMode(
                        expected: .incremental,
                        actual: response.mode
                    )
                }
                _ = try await store.commit(incremental)
                needsIncremental = incremental.hasMore
            } catch let error as APIError where error.code == .cursorExpired {
                try await store.beginAccountSnapshot()
                needsIncremental = true
            }
        }
    }

    private static func request(
        _ syncRequest: SyncRequest,
        api: any SyncAPI,
        retryPolicy: SyncRetryPolicy,
        sleep: @escaping SyncSleep,
        random: @escaping SyncRandom
    ) async throws -> SyncResponse {
        var retryIndex = 0
        while true {
            do {
                return try await api.sync(syncRequest)
            } catch {
                let decision = retryDecision(for: error)
                guard decision.retryable, retryIndex < retryPolicy.maxRetries else {
                    throw error
                }
                let delay = retryPolicy.delayNanoseconds(
                    retryIndex: retryIndex,
                    retryAfter: decision.retryAfter,
                    randomUnit: random()
                )
                retryIndex += 1
                try await sleep(delay)
            }
        }
    }

    private static func retryDecision(
        for error: any Error
    ) -> (retryable: Bool, retryAfter: Int?) {
        if error is CancellationError { return (false, nil) }
        if let apiError = error as? APIError {
            return (apiError.retryable, apiError.retryAfter)
        }
        if let urlError = error as? URLError {
            return (urlError.code != .cancelled, nil)
        }
        return (false, nil)
    }
}

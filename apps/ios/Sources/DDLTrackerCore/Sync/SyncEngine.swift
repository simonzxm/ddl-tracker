public protocol SyncAPI: Sendable {
    func sync(_ request: SyncRequest) async throws -> SyncResponse
}

public enum SyncEngineError: Error, Equatable, Sendable {
    case unexpectedResponseMode(expected: SyncMode, actual: SyncMode)
    case missingCursorAfterSnapshot
}

public actor SyncEngine {
    private let api: any SyncAPI
    private let store: ClientStore
    private var activeTask: Task<ClientStoreSnapshot, any Error>?

    public init(api: any SyncAPI, store: ClientStore) {
        self.api = api
        self.store = store
    }

    public func synchronize() async throws -> ClientStoreSnapshot {
        if let activeTask { return try await activeTask.value }
        let task = Task { [api, store] in
            try await Self.run(api: api, store: store)
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

    private static func run(api: any SyncAPI, store: ClientStore) async throws -> ClientStoreSnapshot {
        var needsIncremental = true
        while true {
            var current = try await store.snapshot()

            if current.metadata.cursor == nil {
                if current.metadata.accountSnapshot == nil {
                    try await store.beginAccountSnapshot()
                    current = try await store.snapshot()
                }
                let checkpoint = current.metadata.accountSnapshot
                let response = try await api.sync(.accountSnapshot(.init(
                    snapshotToken: checkpoint?.snapshotToken,
                    pageToken: checkpoint?.pageToken,
                    snapshotLimit: 500
                )))
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
                let request = ClassSectionSnapshotRequest(
                    cursor: cursor,
                    classSectionID: classSectionID,
                    snapshotToken: checkpoint?.snapshotToken,
                    pageToken: checkpoint?.pageToken,
                    snapshotLimit: 500
                )
                let response = try await api.sync(.classSectionSnapshot(request))
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
            let request = try IncrementalSyncRequest(
                cursor: current.metadata.cursor ?? "",
                eventLimit: 500,
                operations: operations
            )
            do {
                let response = try await api.sync(.incremental(request))
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
}

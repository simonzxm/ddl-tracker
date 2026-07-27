import Foundation
import SwiftData
import Testing
@testable import DDLTrackerCore

@Test("sync engine resumes account snapshot pages before incremental sync")
func syncEngineResumesAccountSnapshot() async throws {
    let store = try makeStore()
    let api = ScriptedSyncAPI(steps: [
        .response(.accountSnapshot(.init(
            requestID: id(1),
            records: [.catalogRevision(.init(revision: 7, updatedAt: date(1)))],
            snapshotToken: "snapshot",
            nextPageToken: "page-2",
            snapshotComplete: false,
            nextCursor: nil
        ))),
        .response(.accountSnapshot(.init(
            requestID: id(2),
            records: [],
            snapshotToken: "snapshot",
            nextPageToken: nil,
            snapshotComplete: true,
            nextCursor: "cursor-1"
        ))),
        .response(.incremental(.init(
            requestID: id(3),
            operationResults: [],
            events: [],
            nextCursor: "cursor-2",
            hasMore: false
        ))),
    ])

    let result = try await SyncEngine(api: api, store: store).synchronize()
    #expect(result.projection.catalogRevision?.revision == 7)
    #expect(result.metadata.cursor == "cursor-2")
    #expect(await api.modes() == [.accountSnapshot, .accountSnapshot, .incremental])
}

@Test("cursor expiration rebuilds remote state and preserves outbox")
func cursorExpirationPreservesOutbox() async throws {
    let store = try makeStore()
    let operation = follow(operationID: id(10), sectionID: id(110))
    try await store.enqueue(operation)
    try await store.replaceRemoteState(projection: ClientProjection(), metadata: .init(cursor: "expired"))
    let api = ScriptedSyncAPI(steps: [
        .cursorExpired,
        .response(.accountSnapshot(.init(
            requestID: id(11), records: [], snapshotToken: "fresh", nextPageToken: nil,
            snapshotComplete: true, nextCursor: "fresh-cursor"
        ))),
        .response(.incremental(.init(
            requestID: id(12),
            operationResults: [.success(
                operationID: operation.operationID,
                operationType: operation.type,
                status: .applied,
                followUp: nil
            )],
            events: [], nextCursor: "after-operation", hasMore: false
        ))),
    ])

    let result = try await SyncEngine(api: api, store: store).synchronize()
    #expect(result.metadata.cursor == "after-operation")
    #expect(try await store.pendingOperations().isEmpty)
    let requests = await api.requests()
    guard case let .incremental(retry) = requests.last else {
        Issue.record("Expected final incremental retry")
        return
    }
    #expect(retry.operations == [operation])
}

@Test("operation follow ups run class section snapshots before returning")
func operationFollowUpsRunSnapshots() async throws {
    let store = try makeStore()
    try await store.replaceRemoteState(projection: ClientProjection(), metadata: .init(cursor: "cursor"))
    let operation = follow(operationID: id(20), sectionID: id(120))
    try await store.enqueue(operation)
    let task = CourseTask(
        id: id(121), classSectionID: id(120), createdBy: nil, state: .visible, revision: 1,
        createdAt: date(1), updatedAt: date(1)
    )
    let api = ScriptedSyncAPI(steps: [
        .response(.incremental(.init(
            requestID: id(21),
            operationResults: [.success(
                operationID: operation.operationID,
                operationType: operation.type,
                status: .applied,
                followUp: .init(type: .classSectionSnapshot, classSectionID: id(120))
            )],
            events: [], nextCursor: "cursor-after-follow", hasMore: false
        ))),
        .response(.classSectionSnapshot(.init(
            requestID: id(22), classSectionID: id(120), records: [.courseTask(task)],
            snapshotToken: "section-snapshot", nextPageToken: nil, snapshotComplete: true,
            resumeCursor: "cursor-resume"
        ))),
    ])

    let result = try await SyncEngine(api: api, store: store).synchronize()
    #expect(result.metadata.cursor == "cursor-resume")
    #expect(result.metadata.pendingClassSectionSnapshotIDs.isEmpty)
    #expect(result.projection.courseTasks[task.id] == task)
    #expect(await api.modes() == [.incremental, .classSectionSnapshot])
}


@Test("transient sync failures retry with exponential backoff")
func transientFailuresRetryWithBackoff() async throws {
    let store = try makeStore()
    try await store.replaceRemoteState(projection: ClientProjection(), metadata: .init(cursor: "cursor"))
    let api = ScriptedSyncAPI(steps: [
        .networkFailure,
        .networkFailure,
        .response(.incremental(.init(
            requestID: id(31), operationResults: [], events: [],
            nextCursor: "after-retry", hasMore: false
        ))),
    ])
    let sleeps = SleepRecorder()
    let engine = SyncEngine(
        api: api,
        store: store,
        retryPolicy: .init(
            maxRetries: 3,
            initialDelayNanoseconds: 100,
            maxDelayNanoseconds: 1_000,
            jitterRatio: 0
        ),
        sleep: { delay in await sleeps.record(delay) },
        random: { 0.5 }
    )

    let result = try await engine.synchronize()
    #expect(result.metadata.cursor == "after-retry")
    #expect(await api.requests().count == 3)
    #expect(await sleeps.values() == [100, 200])
}

@Test("retryable API errors honor retry after")
func retryableAPIErrorsHonorRetryAfter() async throws {
    let store = try makeStore()
    try await store.replaceRemoteState(projection: ClientProjection(), metadata: .init(cursor: "cursor"))
    let api = ScriptedSyncAPI(steps: [
        .apiError(APIError(
            code: .rateLimited,
            details: [:],
            message: "Retry later.",
            retryable: true,
            retryAfter: 2,
            requestID: id(32)
        )),
        .response(.incremental(.init(
            requestID: id(33), operationResults: [], events: [],
            nextCursor: "after-rate-limit", hasMore: false
        ))),
    ])
    let sleeps = SleepRecorder()
    let engine = SyncEngine(
        api: api,
        store: store,
        retryPolicy: .init(
            maxRetries: 1,
            initialDelayNanoseconds: 100,
            maxDelayNanoseconds: 1_000,
            jitterRatio: 0
        ),
        sleep: { delay in await sleeps.record(delay) },
        random: { 0.5 }
    )

    _ = try await engine.synchronize()
    #expect(await sleeps.values() == [2_000_000_000])
}

private actor ScriptedSyncAPI: SyncAPI {
    enum Step: Sendable {
        case response(SyncResponse)
        case cursorExpired
        case networkFailure
        case apiError(APIError)
    }

    private var steps: [Step]
    private var recorded: [SyncRequest] = []

    init(steps: [Step]) { self.steps = steps }

    func sync(_ request: SyncRequest) async throws -> SyncResponse {
        recorded.append(request)
        guard !steps.isEmpty else { throw TestFailure.missingStep }
        switch steps.removeFirst() {
        case let .response(response): return response
        case .cursorExpired:
            throw APIError(
                code: .cursorExpired,
                details: [:],
                message: "Cursor expired.",
                retryable: false,
                requestID: id(999)
            )
        case .networkFailure:
            throw URLError(.networkConnectionLost)
        case let .apiError(error):
            throw error
        }
    }

    func requests() -> [SyncRequest] { recorded }
    func modes() -> [SyncMode] { recorded.map(\.mode) }
}

private actor SleepRecorder {
    private var recorded: [UInt64] = []
    func record(_ value: UInt64) { recorded.append(value) }
    func values() -> [UInt64] { recorded }
}

private enum TestFailure: Error { case missingStep }

private func makeStore() throws -> ClientStore {
    let schema = Schema([StoredClientState.self, StoredOutboxItem.self])
    let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
    return try ClientStore(container: ModelContainer(for: schema, configurations: [configuration]))
}

private func follow(operationID: UUIDv7, sectionID: UUIDv7) -> StudentOperation {
    .followClassSection(.init(operationID: operationID, payload: .init(classSectionID: sectionID)))
}

private func date(_ value: TimeInterval) -> Date { Date(timeIntervalSince1970: value) }

private func id(_ suffix: Int) -> UUIDv7 {
    UUIDv7(String(format: "018f0000-0000-7000-8000-%012x", suffix))!
}

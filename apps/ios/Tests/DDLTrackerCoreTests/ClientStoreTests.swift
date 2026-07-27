import Foundation
import SwiftData
import Testing
@testable import DDLTrackerCore

@Test("SwiftData store persists projection and outbox")
func storePersistsProjectionAndOutbox() async throws {
    let store = try makeStore()
    let operation = follow(operationID: id(1), sectionID: id(101))
    try await store.enqueue(operation)

    var projection = ClientProjection()
    projection.apply(.catalogRevision(.init(revision: 4, updatedAt: Date(timeIntervalSince1970: 4))))
    var metadata = PersistedSyncMetadata()
    metadata.cursor = "cursor-4"
    try await store.replaceRemoteState(projection: projection, metadata: metadata)

    let snapshot = try await store.snapshot()
    #expect(snapshot.projection.catalogRevision?.revision == 4)
    #expect(snapshot.metadata.cursor == "cursor-4")
    #expect(try await store.pendingOperations() == [operation])
}

@Test("incremental commit atomically advances cursor and resolves outbox")
func incrementalCommitIsAtomic() async throws {
    let store = try makeStore()
    let operation = follow(operationID: id(1), sectionID: id(101))
    try await store.enqueue(operation)
    let event = SyncEvent.classSectionFollowed(.init(
        eventID: id(201),
        occurredAt: Date(timeIntervalSince1970: 2),
        payload: .init(classSectionID: id(101), followedAt: Date(timeIntervalSince1970: 2))
    ))
    let response = IncrementalSyncResponse(
        requestID: id(301),
        operationResults: [OperationResult.success(
            operationID: operation.operationID,
            operationType: operation.type,
            status: .applied,
            followUp: .init(type: .classSectionSnapshot, classSectionID: id(101))
        )],
        events: [event],
        nextCursor: "cursor-next",
        hasMore: false
    )

    let snapshot = try await store.commit(response)
    #expect(snapshot.metadata.cursor == "cursor-next")
    #expect(snapshot.metadata.pendingClassSectionSnapshotIDs == [id(101)])
    #expect(snapshot.projection.followedClassSections[id(101)] != nil)
    #expect(try await store.pendingOperations().isEmpty)
}

@Test("cursor reset preserves offline operations")
func cursorResetPreservesOutbox() async throws {
    let store = try makeStore()
    let operation = follow(operationID: id(1), sectionID: id(101))
    try await store.enqueue(operation)
    var projection = ClientProjection()
    projection.apply(.catalogRevision(.init(revision: 9, updatedAt: Date())))
    try await store.replaceRemoteState(projection: projection, metadata: .init(cursor: "old"))

    try await store.resetRemoteState()
    let snapshot = try await store.snapshot()
    #expect(snapshot.projection == ClientProjection())
    #expect(snapshot.metadata.cursor == nil)
    #expect(try await store.pendingOperations() == [operation])
}

private func makeStore() throws -> ClientStore {
    let schema = Schema([StoredClientState.self, StoredOutboxItem.self])
    let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
    return try ClientStore(container: ModelContainer(for: schema, configurations: [configuration]))
}

private func follow(operationID: UUIDv7, sectionID: UUIDv7) -> StudentOperation {
    .followClassSection(.init(operationID: operationID, payload: .init(classSectionID: sectionID)))
}

private func id(_ suffix: Int) -> UUIDv7 {
    UUIDv7(String(format: "018f0000-0000-7000-8000-%012x", suffix))!
}

@Test("catalog refresh persists newer class section summaries")
func catalogRefreshPersistsClassSections() async throws {
    let store = try makeStore()
    let section = ClassSectionRecord(
        id: id(401),
        courseID: id(402),
        externalSectionID: "SEC-401",
        sectionNumber: "01",
        departmentCode: "CS",
        departmentName: "Computer Science",
        instructors: ["Teacher"],
        campus: "Main",
        capacity: 80,
        scheduleText: "Tuesday",
        active: true,
        revision: 3,
        createdAt: Date(timeIntervalSince1970: 1),
        updatedAt: Date(timeIntervalSince1970: 2)
    )

    try await store.refreshClassSections([section])
    #expect(try await store.snapshot().projection.classSections[section.id] == section)
}

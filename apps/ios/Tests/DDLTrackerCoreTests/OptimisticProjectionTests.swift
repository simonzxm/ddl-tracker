import Foundation
import SwiftData
import Testing
@testable import DDLTrackerCore

@Test("pending personal todo is visible before synchronization")
func pendingTodoIsVisibleOffline() async throws {
    let store = try makeStore()
    let todoID = id(1)
    let operation = StudentOperation.createPersonalTodo(.init(
        operationID: id(101),
        payload: .init(
            personalTodoID: todoID,
            classSectionID: nil,
            title: "Read chapter 3",
            deadline: date(100),
            note: "Take notes",
            state: .pending
        )
    ))
    try await store.enqueue(operation)
    let effective = try await store.effectiveSnapshot(now: date(10), currentUserID: id(500))
    #expect(effective.projection.personalTodos[todoID]?.title == "Read chapter 3")
    #expect((try await store.snapshot()).projection.personalTodos[todoID] == nil)
}

@Test("optimistic vote updates personal vote and aggregate totals")
func optimisticVoteUpdatesTotals() {
    let proposalID = id(2)
    var projection = ClientProjection()
    projection.apply(.proposalVoteTotals(.init(proposalID: proposalID, up: 3, down: 1, updatedAt: date(1), revision: 2)))
    projection.apply(.accuracyVote(.init(proposalID: proposalID, value: .down, updatedAt: date(1), revision: 1)))
    projection.applyOptimistically(
        .setAccuracyVote(.init(operationID: id(102), payload: .init(proposalID: proposalID, value: .up))),
        now: date(2),
        currentUserID: id(500)
    )
    #expect(projection.accuracyVotes[proposalID]?.value == .up)
    #expect(projection.proposalVoteTotals[proposalID]?.up == 4)
    #expect(projection.proposalVoteTotals[proposalID]?.down == 0)
}

@Test("rejected operations can be retried or discarded")
func rejectedOperationsCanBeManaged() async throws {
    let store = try makeStore()
    let operation = StudentOperation.followClassSection(.init(operationID: id(103), payload: .init(classSectionID: id(3))))
    try await store.enqueue(operation)
    let response = IncrementalSyncResponse(
        requestID: id(201),
        operationResults: [.failure(
            operationID: operation.operationID,
            operationType: operation.type,
            status: .rejected,
            error: .init(code: .conflict, details: [:], message: "Conflict", retryable: true)
        )],
        events: [], nextCursor: "cursor", hasMore: false
    )
    _ = try await store.commit(response)
    #expect(try await store.pendingOperations().isEmpty)
    #expect(try await store.outboxRecords().first?.status == .rejected)

    try await store.retry(operationID: operation.operationID)
    #expect(try await store.pendingOperations() == [operation])
    try await store.discard(operationID: operation.operationID)
    #expect(try await store.outboxRecords().isEmpty)
}

private func makeStore() throws -> ClientStore {
    let schema = Schema([StoredClientState.self, StoredOutboxItem.self])
    let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
    return try ClientStore(container: ModelContainer(for: schema, configurations: [configuration]))
}
private func date(_ value: TimeInterval) -> Date { Date(timeIntervalSince1970: value) }
private func id(_ suffix: Int) -> UUIDv7 { UUIDv7(String(format: "018f0000-0000-7000-8000-%012x", suffix))! }

@Test("publishing a personal todo preserves private content without leaking it")
func publishingTodoPreservesPrivateOverlay() {
    let todoID = id(301)
    let taskID = id(302)
    let sectionID = id(303)
    let proposalID = id(304)
    var projection = ClientProjection()
    projection.apply(.personalTodo(.init(
        id: todoID,
        classSectionID: sectionID,
        title: "Private title",
        deadline: date(100),
        note: "Private note",
        state: .completed,
        revision: 4,
        deletedAt: nil,
        createdAt: date(1),
        updatedAt: date(2)
    )))

    projection.applyOptimistically(
        .publishPersonalTodoAsCourseTask(.init(
            operationID: id(305),
            payload: .init(
                personalTodoID: todoID,
                expectedPersonalTodoRevision: 4,
                courseTaskID: taskID,
                classSectionID: sectionID,
                proposalID: proposalID,
                proposal: .init(
                    title: "Public title",
                    deadline: date(200),
                    description: "Public description",
                    evidenceNote: nil,
                    evidenceURL: nil
                )
            )
        )),
        now: date(10),
        currentUserID: id(500)
    )

    #expect(projection.personalTodos[todoID] == nil)
    #expect(projection.personalTaskDetails[taskID]?.privateTitle == "Private title")
    #expect(projection.personalTaskDetails[taskID]?.privateDeadline == date(100))
    #expect(projection.personalTaskDetails[taskID]?.privateNote == "Private note")
    #expect(projection.personalTaskStates[taskID]?.state == .completed)
    #expect(projection.taskProposals[proposalID]?.title == "Public title")
    #expect(projection.taskProposals[proposalID]?.description == "Public description")
}

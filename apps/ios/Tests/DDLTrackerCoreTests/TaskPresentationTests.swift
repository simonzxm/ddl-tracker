import Foundation
import Testing
@testable import DDLTrackerCore

@Test("shared task presentation uses ranked proposal and private overlay")
func sharedTaskPresentationUsesDomainRules() throws {
    let taskID = id(1)
    let sectionID = id(2)
    let proposalA = id(3)
    let proposalB = id(4)
    var projection = ClientProjection()
    projection.apply(.courseTask(.init(id: taskID, classSectionID: sectionID, createdBy: nil, state: .visible, revision: 1, createdAt: date(1), updatedAt: date(1))))
    projection.apply(.taskProposal(proposal(id: proposalA, taskID: taskID, title: "Lower", deadline: date(100))))
    projection.apply(.taskProposal(proposal(id: proposalB, taskID: taskID, title: "Winner", deadline: date(200))))
    projection.apply(.proposalVoteTotals(.init(proposalID: proposalA, up: 1, down: 2, updatedAt: date(1), revision: 1)))
    projection.apply(.proposalVoteTotals(.init(proposalID: proposalB, up: 5, down: 0, updatedAt: date(1), revision: 1)))
    projection.apply(.personalTaskDetails(.init(courseTaskID: taskID, privateTitle: "My title", privateDeadline: date(50), privateNote: "Private", revision: 1, createdAt: date(1), updatedAt: date(1))))
    projection.apply(.personalTaskState(.init(courseTaskID: taskID, state: .completed, revision: 1, createdAt: date(1), updatedAt: date(1))))

    let item = try #require(try projection.taskListItems().first)
    #expect(item.title == "My title")
    #expect(item.deadline == date(50))
    #expect(item.note == "Private")
    #expect(item.state == .completed)
    #expect(item.canonicalProposalID == proposalB)
    #expect(item.confidence == .supported)
}

@Test("personal todos and shared tasks share deterministic deadline ordering")
func taskListOrdering() throws {
    var projection = ClientProjection()
    projection.apply(.personalTodo(.init(id: id(10), classSectionID: nil, title: "No date", deadline: nil, note: nil, state: .pending, revision: 1, deletedAt: nil, createdAt: date(1), updatedAt: date(1))))
    projection.apply(.personalTodo(.init(id: id(11), classSectionID: nil, title: "Later", deadline: date(20), note: nil, state: .pending, revision: 1, deletedAt: nil, createdAt: date(1), updatedAt: date(1))))
    projection.apply(.personalTodo(.init(id: id(12), classSectionID: nil, title: "Sooner", deadline: date(10), note: nil, state: .pending, revision: 1, deletedAt: nil, createdAt: date(1), updatedAt: date(1))))
    #expect(try projection.taskListItems().map(\.title) == ["Sooner", "Later", "No date"])
}

private func proposal(id: UUIDv7, taskID: UUIDv7, title: String, deadline: Date) -> TaskProposal {
    .init(id: id, courseTaskID: taskID, authorID: nil, title: title, deadline: deadline, description: nil, evidenceNote: nil, evidenceURL: nil, contentFingerprint: id.uuidString, state: .visible, revision: 1, createdAt: date(1))
}
private func date(_ value: TimeInterval) -> Date { Date(timeIntervalSince1970: value) }
private func id(_ suffix: Int) -> UUIDv7 { UUIDv7(String(format: "018f0000-0000-7000-8000-%012x", suffix))! }

@Test("hidden shared tasks retain private details and state")
func hiddenSharedTaskRetainsPrivatePresentation() throws {
    let taskID = id(20)
    let sectionID = id(21)
    var projection = ClientProjection()
    projection.apply(.courseTask(.init(
        id: taskID,
        classSectionID: sectionID,
        createdBy: nil,
        state: .visible,
        revision: 1,
        createdAt: date(1),
        updatedAt: date(1)
    )))
    projection.apply(.personalTaskDetails(.init(
        courseTaskID: taskID,
        privateTitle: "Private retained title",
        privateDeadline: date(50),
        privateNote: "Still available",
        revision: 1,
        createdAt: date(1),
        updatedAt: date(1)
    )))
    projection.apply(.personalTaskState(.init(
        courseTaskID: taskID,
        state: .completed,
        revision: 1,
        createdAt: date(1),
        updatedAt: date(1)
    )))
    projection.apply(.contentTombstone(.init(
        entityType: .courseTask,
        entityID: taskID,
        state: .hidden,
        revision: 2,
        deletedAt: nil
    )))

    let item = try #require(try projection.taskListItems().first { $0.courseTaskID == taskID })
    #expect(item.title == "Private retained title")
    #expect(item.deadline == date(50))
    #expect(item.note == "Still available")
    #expect(item.state == .completed)
    #expect(item.canonicalProposalID == nil)
}

@Test("shared tasks without visible proposals are omitted unless private state remains")
func taskWithoutVisibleProposalsIsNotActive() throws {
    let taskID = id(40)
    var projection = ClientProjection()
    projection.apply(.courseTask(.init(
        id: taskID,
        classSectionID: id(41),
        createdBy: nil,
        state: .visible,
        revision: 1,
        createdAt: date(1),
        updatedAt: date(1)
    )))
    #expect(try projection.taskListItems().allSatisfy { $0.courseTaskID != taskID })
}

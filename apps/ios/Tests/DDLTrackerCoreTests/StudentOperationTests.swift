import Foundation
import Testing
@testable import DDLTrackerCore

@Test("all student operations round trip with stable discriminators")
func allStudentOperationsRoundTrip() throws {
    let operations = sampleOperations()
    #expect(operations.count == StudentOperationType.allCases.count)
    #expect(Set(operations.map(\.type)) == Set(StudentOperationType.allCases))
    let data = try JSONCoding.encoder.encode(operations)
    let decoded = try JSONCoding.decoder.decode([StudentOperation].self, from: data)
    #expect(decoded == operations)
}

@Test("student operation wire envelope contains protocol fields")
func studentOperationWireEnvelope() throws {
    let operation = sampleOperations()[0]
    let object = try #require(
        JSONSerialization.jsonObject(with: JSONCoding.encoder.encode(operation)) as? [String: Any]
    )
    #expect(object["schema_version"] as? Int == 1)
    #expect(object["operation_id"] as? String == operation.operationID.uuidString)
    #expect(object["depends_on"] as? [String] == [])
    #expect(object["type"] as? String == StudentOperationType.followClassSection.rawValue)
    #expect(object["payload"] is [String: Any])
}

private func sampleOperations() -> [StudentOperation] {
    let operationIDs = (1 ... 18).map { id($0) }
    let section = id(101)
    let todo = id(102)
    let task = id(103)
    let proposal = id(104)
    let comment = id(105)
    let report = id(106)
    let deadline = RFC3339.date(from: "2026-09-02T00:00:00Z")!
    let proposalPayload = CanonicalProposalPayload(
        title: "Project report",
        deadline: deadline,
        description: "Submit the report.",
        evidenceNote: nil,
        evidenceURL: nil
    )
    return [
        .followClassSection(.init(operationID: operationIDs[0], payload: .init(classSectionID: section))),
        .unfollowClassSection(.init(operationID: operationIDs[1], payload: .init(classSectionID: section))),
        .createPersonalTodo(.init(operationID: operationIDs[2], payload: .init(personalTodoID: todo, classSectionID: section, title: "Read", deadline: nil, note: nil, state: .pending))),
        .updatePersonalTodo(.init(operationID: operationIDs[3], payload: .init(personalTodoID: todo, classSectionID: section, title: "Read more", deadline: nil, note: "Chapter 3", state: .pending, expectedRevision: 1))),
        .deletePersonalTodo(.init(operationID: operationIDs[4], payload: .init(personalTodoID: todo, expectedRevision: 1))),
        .upsertPersonalTaskDetails(.init(operationID: operationIDs[5], payload: .init(courseTaskID: task, privateTitle: "Mine", privateDeadline: deadline, privateNote: nil, expectedRevision: 0))),
        .deletePersonalTaskDetails(.init(operationID: operationIDs[6], payload: .init(courseTaskID: task, expectedRevision: 1))),
        .setPersonalTaskState(.init(operationID: operationIDs[7], payload: .init(courseTaskID: task, state: .completed, expectedRevision: 0))),
        .mergePersonalTodoIntoCourseTask(.init(operationID: operationIDs[8], payload: .init(personalTodoID: todo, courseTaskID: task, expectedPersonalTodoRevision: 1, expectedDetailsRevision: 0, expectedStateRevision: 0))),
        .publishPersonalTodoAsCourseTask(.init(operationID: operationIDs[9], payload: .init(personalTodoID: todo, expectedPersonalTodoRevision: 1, courseTaskID: task, classSectionID: section, proposalID: proposal, proposal: proposalPayload))),
        .publishPersonalTaskDetailsAsProposal(.init(operationID: operationIDs[10], payload: .init(courseTaskID: task, proposalID: proposal, expectedDetailsRevision: 1, proposal: proposalPayload))),
        .createCourseTaskWithInitialProposal(.init(operationID: operationIDs[11], payload: .init(courseTaskID: task, classSectionID: section, proposalID: proposal, proposal: proposalPayload))),
        .createTaskProposal(.init(operationID: operationIDs[12], payload: .init(courseTaskID: task, proposalID: proposal, proposal: proposalPayload))),
        .setAccuracyVote(.init(operationID: operationIDs[13], payload: .init(proposalID: proposal, value: .up))),
        .createTaskComment(.init(operationID: operationIDs[14], payload: .init(commentID: comment, courseTaskID: task, body: "Announced in class."))),
        .editTaskComment(.init(operationID: operationIDs[15], payload: .init(commentID: comment, body: "Updated", expectedRevision: 1))),
        .deleteTaskComment(.init(operationID: operationIDs[16], payload: .init(commentID: comment, expectedRevision: 2))),
        .createContentReport(.init(operationID: operationIDs[17], payload: .init(reportID: report, targetType: .comment, targetID: comment, reason: .privacy, details: "Contains personal information."))),
    ]
}

private func id(_ suffix: Int) -> UUIDv7 {
    UUIDv7(String(format: "018f0000-0000-7000-8000-%012x", suffix))!
}

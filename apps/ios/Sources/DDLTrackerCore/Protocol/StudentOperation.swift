public struct StudentOperationEnvelope<Payload: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    public let operationID: UUIDv7
    public let dependsOn: [UUIDv7]
    public let payload: Payload

    public init(operationID: UUIDv7, dependsOn: [UUIDv7] = [], payload: Payload) {
        self.operationID = operationID
        self.dependsOn = dependsOn
        self.payload = payload
    }
}

public enum StudentOperation: Codable, Equatable, Sendable {
    case followClassSection(StudentOperationEnvelope<FollowClassSectionPayload>)
    case unfollowClassSection(StudentOperationEnvelope<UnfollowClassSectionPayload>)
    case createPersonalTodo(StudentOperationEnvelope<CreatePersonalTodoPayload>)
    case updatePersonalTodo(StudentOperationEnvelope<UpdatePersonalTodoPayload>)
    case deletePersonalTodo(StudentOperationEnvelope<DeletePersonalTodoPayload>)
    case upsertPersonalTaskDetails(StudentOperationEnvelope<UpsertPersonalTaskDetailsPayload>)
    case deletePersonalTaskDetails(StudentOperationEnvelope<DeletePersonalTaskDetailsPayload>)
    case setPersonalTaskState(StudentOperationEnvelope<SetPersonalTaskStatePayload>)
    case mergePersonalTodoIntoCourseTask(StudentOperationEnvelope<MergePersonalTodoIntoCourseTaskPayload>)
    case publishPersonalTodoAsCourseTask(StudentOperationEnvelope<PublishPersonalTodoAsCourseTaskPayload>)
    case publishPersonalTaskDetailsAsProposal(StudentOperationEnvelope<PublishPersonalTaskDetailsAsProposalPayload>)
    case createCourseTaskWithInitialProposal(StudentOperationEnvelope<CreateCourseTaskWithInitialProposalPayload>)
    case createTaskProposal(StudentOperationEnvelope<CreateTaskProposalPayload>)
    case setAccuracyVote(StudentOperationEnvelope<SetAccuracyVotePayload>)
    case createTaskComment(StudentOperationEnvelope<CreateTaskCommentPayload>)
    case editTaskComment(StudentOperationEnvelope<EditTaskCommentPayload>)
    case deleteTaskComment(StudentOperationEnvelope<DeleteTaskCommentPayload>)
    case createContentReport(StudentOperationEnvelope<CreateContentReportPayload>)

    public var type: StudentOperationType {
        switch self {
        case .followClassSection: .followClassSection
        case .unfollowClassSection: .unfollowClassSection
        case .createPersonalTodo: .createPersonalTodo
        case .updatePersonalTodo: .updatePersonalTodo
        case .deletePersonalTodo: .deletePersonalTodo
        case .upsertPersonalTaskDetails: .upsertPersonalTaskDetails
        case .deletePersonalTaskDetails: .deletePersonalTaskDetails
        case .setPersonalTaskState: .setPersonalTaskState
        case .mergePersonalTodoIntoCourseTask: .mergePersonalTodoIntoCourseTask
        case .publishPersonalTodoAsCourseTask: .publishPersonalTodoAsCourseTask
        case .publishPersonalTaskDetailsAsProposal: .publishPersonalTaskDetailsAsProposal
        case .createCourseTaskWithInitialProposal: .createCourseTaskWithInitialProposal
        case .createTaskProposal: .createTaskProposal
        case .setAccuracyVote: .setAccuracyVote
        case .createTaskComment: .createTaskComment
        case .editTaskComment: .editTaskComment
        case .deleteTaskComment: .deleteTaskComment
        case .createContentReport: .createContentReport
        }
    }

    public var operationID: UUIDv7 {
        switch self {
        case let .followClassSection(value): value.operationID
        case let .unfollowClassSection(value): value.operationID
        case let .createPersonalTodo(value): value.operationID
        case let .updatePersonalTodo(value): value.operationID
        case let .deletePersonalTodo(value): value.operationID
        case let .upsertPersonalTaskDetails(value): value.operationID
        case let .deletePersonalTaskDetails(value): value.operationID
        case let .setPersonalTaskState(value): value.operationID
        case let .mergePersonalTodoIntoCourseTask(value): value.operationID
        case let .publishPersonalTodoAsCourseTask(value): value.operationID
        case let .publishPersonalTaskDetailsAsProposal(value): value.operationID
        case let .createCourseTaskWithInitialProposal(value): value.operationID
        case let .createTaskProposal(value): value.operationID
        case let .setAccuracyVote(value): value.operationID
        case let .createTaskComment(value): value.operationID
        case let .editTaskComment(value): value.operationID
        case let .deleteTaskComment(value): value.operationID
        case let .createContentReport(value): value.operationID
        }
    }

    public var dependsOn: [UUIDv7] {
        switch self {
        case let .followClassSection(value): value.dependsOn
        case let .unfollowClassSection(value): value.dependsOn
        case let .createPersonalTodo(value): value.dependsOn
        case let .updatePersonalTodo(value): value.dependsOn
        case let .deletePersonalTodo(value): value.dependsOn
        case let .upsertPersonalTaskDetails(value): value.dependsOn
        case let .deletePersonalTaskDetails(value): value.dependsOn
        case let .setPersonalTaskState(value): value.dependsOn
        case let .mergePersonalTodoIntoCourseTask(value): value.dependsOn
        case let .publishPersonalTodoAsCourseTask(value): value.dependsOn
        case let .publishPersonalTaskDetailsAsProposal(value): value.dependsOn
        case let .createCourseTaskWithInitialProposal(value): value.dependsOn
        case let .createTaskProposal(value): value.dependsOn
        case let .setAccuracyVote(value): value.dependsOn
        case let .createTaskComment(value): value.dependsOn
        case let .editTaskComment(value): value.dependsOn
        case let .deleteTaskComment(value): value.dependsOn
        case let .createContentReport(value): value.dependsOn
        }
    }

    public var entityIDs: [UUIDv7] {
        switch self {
        case let .followClassSection(value): [value.payload.classSectionID]
        case let .unfollowClassSection(value): [value.payload.classSectionID]
        case let .createPersonalTodo(value): [value.payload.personalTodoID] + (value.payload.classSectionID.map { [$0] } ?? [])
        case let .updatePersonalTodo(value): [value.payload.personalTodoID] + (value.payload.classSectionID.map { [$0] } ?? [])
        case let .deletePersonalTodo(value): [value.payload.personalTodoID]
        case let .upsertPersonalTaskDetails(value): [value.payload.courseTaskID]
        case let .deletePersonalTaskDetails(value): [value.payload.courseTaskID]
        case let .setPersonalTaskState(value): [value.payload.courseTaskID]
        case let .mergePersonalTodoIntoCourseTask(value): [value.payload.personalTodoID, value.payload.courseTaskID]
        case let .publishPersonalTodoAsCourseTask(value): [value.payload.personalTodoID, value.payload.courseTaskID, value.payload.classSectionID, value.payload.proposalID]
        case let .publishPersonalTaskDetailsAsProposal(value): [value.payload.courseTaskID, value.payload.proposalID]
        case let .createCourseTaskWithInitialProposal(value): [value.payload.courseTaskID, value.payload.classSectionID, value.payload.proposalID]
        case let .createTaskProposal(value): [value.payload.courseTaskID, value.payload.proposalID]
        case let .setAccuracyVote(value): [value.payload.proposalID]
        case let .createTaskComment(value): [value.payload.commentID, value.payload.courseTaskID]
        case let .editTaskComment(value): [value.payload.commentID]
        case let .deleteTaskComment(value): [value.payload.commentID]
        case let .createContentReport(value): [value.payload.reportID, value.payload.targetID]
        }
    }

    private enum CodingKeys: String, CodingKey {
        case operationID, schemaVersion, dependsOn, type, payload
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .schemaVersion)
        guard version == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .schemaVersion, in: container, debugDescription: "Unsupported operation schema version \(version).")
        }
        let operationID = try container.decode(UUIDv7.self, forKey: .operationID)
        let dependsOn = try container.decode([UUIDv7].self, forKey: .dependsOn)
        let type = try container.decode(StudentOperationType.self, forKey: .type)
        switch type {
        case .followClassSection: self = .followClassSection(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(FollowClassSectionPayload.self, forKey: .payload)))
        case .unfollowClassSection: self = .unfollowClassSection(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(UnfollowClassSectionPayload.self, forKey: .payload)))
        case .createPersonalTodo: self = .createPersonalTodo(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(CreatePersonalTodoPayload.self, forKey: .payload)))
        case .updatePersonalTodo: self = .updatePersonalTodo(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(UpdatePersonalTodoPayload.self, forKey: .payload)))
        case .deletePersonalTodo: self = .deletePersonalTodo(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(DeletePersonalTodoPayload.self, forKey: .payload)))
        case .upsertPersonalTaskDetails: self = .upsertPersonalTaskDetails(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(UpsertPersonalTaskDetailsPayload.self, forKey: .payload)))
        case .deletePersonalTaskDetails: self = .deletePersonalTaskDetails(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(DeletePersonalTaskDetailsPayload.self, forKey: .payload)))
        case .setPersonalTaskState: self = .setPersonalTaskState(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(SetPersonalTaskStatePayload.self, forKey: .payload)))
        case .mergePersonalTodoIntoCourseTask: self = .mergePersonalTodoIntoCourseTask(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(MergePersonalTodoIntoCourseTaskPayload.self, forKey: .payload)))
        case .publishPersonalTodoAsCourseTask: self = .publishPersonalTodoAsCourseTask(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(PublishPersonalTodoAsCourseTaskPayload.self, forKey: .payload)))
        case .publishPersonalTaskDetailsAsProposal: self = .publishPersonalTaskDetailsAsProposal(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(PublishPersonalTaskDetailsAsProposalPayload.self, forKey: .payload)))
        case .createCourseTaskWithInitialProposal: self = .createCourseTaskWithInitialProposal(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(CreateCourseTaskWithInitialProposalPayload.self, forKey: .payload)))
        case .createTaskProposal: self = .createTaskProposal(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(CreateTaskProposalPayload.self, forKey: .payload)))
        case .setAccuracyVote: self = .setAccuracyVote(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(SetAccuracyVotePayload.self, forKey: .payload)))
        case .createTaskComment: self = .createTaskComment(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(CreateTaskCommentPayload.self, forKey: .payload)))
        case .editTaskComment: self = .editTaskComment(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(EditTaskCommentPayload.self, forKey: .payload)))
        case .deleteTaskComment: self = .deleteTaskComment(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(DeleteTaskCommentPayload.self, forKey: .payload)))
        case .createContentReport: self = .createContentReport(.init(operationID: operationID, dependsOn: dependsOn, payload: try container.decode(CreateContentReportPayload.self, forKey: .payload)))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(operationID, forKey: .operationID)
        try container.encode(1, forKey: .schemaVersion)
        try container.encode(dependsOn, forKey: .dependsOn)
        try container.encode(type, forKey: .type)
        switch self {
        case let .followClassSection(value): try container.encode(value.payload, forKey: .payload)
        case let .unfollowClassSection(value): try container.encode(value.payload, forKey: .payload)
        case let .createPersonalTodo(value): try container.encode(value.payload, forKey: .payload)
        case let .updatePersonalTodo(value): try container.encode(value.payload, forKey: .payload)
        case let .deletePersonalTodo(value): try container.encode(value.payload, forKey: .payload)
        case let .upsertPersonalTaskDetails(value): try container.encode(value.payload, forKey: .payload)
        case let .deletePersonalTaskDetails(value): try container.encode(value.payload, forKey: .payload)
        case let .setPersonalTaskState(value): try container.encode(value.payload, forKey: .payload)
        case let .mergePersonalTodoIntoCourseTask(value): try container.encode(value.payload, forKey: .payload)
        case let .publishPersonalTodoAsCourseTask(value): try container.encode(value.payload, forKey: .payload)
        case let .publishPersonalTaskDetailsAsProposal(value): try container.encode(value.payload, forKey: .payload)
        case let .createCourseTaskWithInitialProposal(value): try container.encode(value.payload, forKey: .payload)
        case let .createTaskProposal(value): try container.encode(value.payload, forKey: .payload)
        case let .setAccuracyVote(value): try container.encode(value.payload, forKey: .payload)
        case let .createTaskComment(value): try container.encode(value.payload, forKey: .payload)
        case let .editTaskComment(value): try container.encode(value.payload, forKey: .payload)
        case let .deleteTaskComment(value): try container.encode(value.payload, forKey: .payload)
        case let .createContentReport(value): try container.encode(value.payload, forKey: .payload)
        }
    }
}

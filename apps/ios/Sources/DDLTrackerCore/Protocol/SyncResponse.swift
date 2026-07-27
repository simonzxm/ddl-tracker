public import Foundation

public enum StudentOperationType: String, Codable, CaseIterable, Sendable {
    case followClassSection = "follow_class_section"
    case unfollowClassSection = "unfollow_class_section"
    case createPersonalTodo = "create_personal_todo"
    case updatePersonalTodo = "update_personal_todo"
    case deletePersonalTodo = "delete_personal_todo"
    case upsertPersonalTaskDetails = "upsert_personal_task_details"
    case deletePersonalTaskDetails = "delete_personal_task_details"
    case setPersonalTaskState = "set_personal_task_state"
    case mergePersonalTodoIntoCourseTask = "merge_personal_todo_into_course_task"
    case publishPersonalTodoAsCourseTask = "publish_personal_todo_as_course_task"
    case publishPersonalTaskDetailsAsProposal = "publish_personal_task_details_as_proposal"
    case createCourseTaskWithInitialProposal = "create_course_task_with_initial_proposal"
    case createTaskProposal = "create_task_proposal"
    case setAccuracyVote = "set_accuracy_vote"
    case createTaskComment = "create_task_comment"
    case editTaskComment = "edit_task_comment"
    case deleteTaskComment = "delete_task_comment"
    case createContentReport = "create_content_report"
}

public struct OperationFollowUp: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case classSectionSnapshot = "class_section_snapshot" }
    public let type: Kind
    public let classSectionID: UUIDv7
}

public struct OperationError: Codable, Equatable, Sendable {
    public let code: APIErrorCode
    public let details: [String: JSONValue]
    public let message: String
    public let retryable: Bool
}

public enum OperationResultStatus: String, Codable, Sendable {
    case applied
    case replayed
    case rejected
    case dependencyFailed = "dependency_failed"
}

public struct OperationResult: Codable, Equatable, Sendable {
    public let operationID: UUIDv7
    public let operationType: StudentOperationType
    public let status: OperationResultStatus
    public let followUp: OperationFollowUp?
    public let error: OperationError?

    private enum CodingKeys: String, CodingKey {
        case operationID, operationType, status, followUp, error
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        operationID = try container.decode(UUIDv7.self, forKey: .operationID)
        operationType = try container.decode(StudentOperationType.self, forKey: .operationType)
        status = try container.decode(OperationResultStatus.self, forKey: .status)
        switch status {
        case .applied, .replayed:
            followUp = try container.decodeIfPresent(OperationFollowUp.self, forKey: .followUp)
            error = nil
        case .rejected, .dependencyFailed:
            followUp = nil
            error = try container.decode(OperationError.self, forKey: .error)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(operationID, forKey: .operationID)
        try container.encode(operationType, forKey: .operationType)
        try container.encode(status, forKey: .status)
        switch status {
        case .applied, .replayed: try container.encode(followUp, forKey: .followUp)
        case .rejected, .dependencyFailed: try container.encode(error, forKey: .error)
        }
    }
}

public struct AccountSnapshotResponse: Codable, Equatable, Sendable {
    public let requestID: UUIDv7
    public let records: [SnapshotRecord]
    public let snapshotToken: String
    public let nextPageToken: String?
    public let snapshotComplete: Bool
    public let nextCursor: String?
}

public struct ClassSectionSnapshotResponse: Codable, Equatable, Sendable {
    public let requestID: UUIDv7
    public let classSectionID: UUIDv7
    public let records: [SnapshotRecord]
    public let snapshotToken: String
    public let nextPageToken: String?
    public let snapshotComplete: Bool
    public let resumeCursor: String?
}

public struct IncrementalSyncResponse: Codable, Equatable, Sendable {
    public let requestID: UUIDv7
    public let operationResults: [OperationResult]
    public let events: [SyncEvent]
    public let nextCursor: String
    public let hasMore: Bool
}

public enum SyncMode: String, Codable, Sendable {
    case accountSnapshot = "account_snapshot"
    case classSectionSnapshot = "class_section_snapshot"
    case incremental
}

public enum SyncResponse: Codable, Equatable, Sendable {
    case accountSnapshot(AccountSnapshotResponse)
    case classSectionSnapshot(ClassSectionSnapshotResponse)
    case incremental(IncrementalSyncResponse)

    public var mode: SyncMode {
        switch self {
        case .accountSnapshot: .accountSnapshot
        case .classSectionSnapshot: .classSectionSnapshot
        case .incremental: .incremental
        }
    }

    private enum CodingKeys: String, CodingKey { case protocolVersion, mode }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .protocolVersion)
        guard version == DDLTrackerCore.syncProtocolVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .protocolVersion,
                in: container,
                debugDescription: "Unsupported sync protocol version \(version)."
            )
        }
        switch try container.decode(SyncMode.self, forKey: .mode) {
        case .accountSnapshot: self = .accountSnapshot(try AccountSnapshotResponse(from: decoder))
        case .classSectionSnapshot: self = .classSectionSnapshot(try ClassSectionSnapshotResponse(from: decoder))
        case .incremental: self = .incremental(try IncrementalSyncResponse(from: decoder))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        switch self {
        case let .accountSnapshot(value): try value.encode(to: encoder)
        case let .classSectionSnapshot(value): try value.encode(to: encoder)
        case let .incremental(value): try value.encode(to: encoder)
        }
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(DDLTrackerCore.syncProtocolVersion, forKey: .protocolVersion)
        try container.encode(mode, forKey: .mode)
    }
}

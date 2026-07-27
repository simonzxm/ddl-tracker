public import Foundation

public struct UnfollowedClassSection: Codable, Equatable, Sendable {
    public let classSectionID: UUIDv7
    public let unfollowedAt: Date

    public init(classSectionID: UUIDv7, unfollowedAt: Date) {
        self.classSectionID = classSectionID
        self.unfollowedAt = unfollowedAt
    }
}

public struct TaskMergeEvent: Codable, Equatable, Sendable {
    public let sourceTaskID: UUIDv7
    public let targetTaskID: UUIDv7
    public let reason: String
    public let revision: Int
    public let createdAt: Date
    public let redirectedProposals: Int
    public let movedProposals: Int
    public let recoveredPersonalTodos: Int

    public init(
        sourceTaskID: UUIDv7,
        targetTaskID: UUIDv7,
        reason: String,
        revision: Int,
        createdAt: Date,
        redirectedProposals: Int,
        movedProposals: Int,
        recoveredPersonalTodos: Int
    ) {
        self.sourceTaskID = sourceTaskID
        self.targetTaskID = targetTaskID
        self.reason = reason
        self.revision = revision
        self.createdAt = createdAt
        self.redirectedProposals = redirectedProposals
        self.movedProposals = movedProposals
        self.recoveredPersonalTodos = recoveredPersonalTodos
    }
}

public struct PersonalTodoDeletion: Codable, Equatable, Sendable {
    public let id: UUIDv7
    public let revision: Int
    public let deletedAt: Date

    public init(id: UUIDv7, revision: Int, deletedAt: Date) {
        self.id = id
        self.revision = revision
        self.deletedAt = deletedAt
    }
}

public struct CourseTaskScopedDeletion: Codable, Equatable, Sendable {
    public let courseTaskID: UUIDv7
    public let revision: Int
    public let deletedAt: Date

    public init(courseTaskID: UUIDv7, revision: Int, deletedAt: Date) {
        self.courseTaskID = courseTaskID
        self.revision = revision
        self.deletedAt = deletedAt
    }
}

public struct PublicUserDeletion: Codable, Equatable, Sendable {
    public let id: UUIDv7
    public let displayName: String
    public let status: UserStatus
    public let revision: Int
    public let deletedAt: Date

    public init(id: UUIDv7, displayName: String, status: UserStatus, revision: Int, deletedAt: Date) {
        self.id = id
        self.displayName = displayName
        self.status = status
        self.revision = revision
        self.deletedAt = deletedAt
    }
}

public struct MaintainerContentReport: Codable, Equatable, Sendable, Identifiable {
    public var id: UUIDv7 { reportID }
    public let reportID: UUIDv7
    public let reporterID: UUIDv7
    public let targetType: ReportTargetType
    public let targetID: UUIDv7
    public let reason: ReportReason
    public let details: String?
    public let status: ReportStatus
    public let resolution: String?
    public let createdAt: Date
    public let resolvedAt: Date?

    public init(
        reportID: UUIDv7,
        reporterID: UUIDv7,
        targetType: ReportTargetType,
        targetID: UUIDv7,
        reason: ReportReason,
        details: String?,
        status: ReportStatus,
        resolution: String?,
        createdAt: Date,
        resolvedAt: Date?
    ) {
        self.reportID = reportID
        self.reporterID = reporterID
        self.targetType = targetType
        self.targetID = targetID
        self.reason = reason
        self.details = details
        self.status = status
        self.resolution = resolution
        self.createdAt = createdAt
        self.resolvedAt = resolvedAt
    }
}

public struct ClassSectionDeactivation: Codable, Equatable, Sendable {
    public let id: UUIDv7
    public let externalSectionID: String
    public let active: Bool
    public let revision: Int
    public let updatedAt: Date

    public init(id: UUIDv7, externalSectionID: String, active: Bool, revision: Int, updatedAt: Date) {
        self.id = id
        self.externalSectionID = externalSectionID
        self.active = active
        self.revision = revision
        self.updatedAt = updatedAt
    }
}

public struct SyncEventValue<Payload: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    public let eventID: UUIDv7
    public let occurredAt: Date
    public let payload: Payload

    public init(eventID: UUIDv7, occurredAt: Date, payload: Payload) {
        self.eventID = eventID
        self.occurredAt = occurredAt
        self.payload = payload
    }
}

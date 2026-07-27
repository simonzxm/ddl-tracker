public import Foundation

public enum UserStatus: String, Codable, Sendable {
    case active
    case suspended
    case deleted
}

public enum TaskProgressState: String, Codable, CaseIterable, Sendable {
    case pending
    case completed
    case ignored
}

public enum AccuracyVoteValue: String, Codable, CaseIterable, Sendable {
    case up
    case down
    case none
}

public enum ContentEntityType: String, Codable, Sendable {
    case courseTask = "course_task"
    case taskProposal = "task_proposal"
    case taskComment = "task_comment"
}

public enum ContentState: String, Codable, Sendable {
    case visible
    case hidden
    case deleted
}

public enum ReportTargetType: String, Codable, CaseIterable, Sendable {
    case courseTask = "course_task"
    case proposal
    case comment
    case user
}

public enum ReportReason: String, Codable, CaseIterable, Sendable {
    case inaccurate
    case spam
    case abuse
    case privacy
    case other
}

public enum ReportStatus: String, Codable, Sendable {
    case open
    case resolved
    case dismissed
}

public struct CatalogRevision: Codable, Equatable, Sendable {
    public let revision: Int
    public let updatedAt: Date

    public init(revision: Int, updatedAt: Date) {
        self.revision = revision
        self.updatedAt = updatedAt
    }
}

public struct PublicUserProfile: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let username: String
    public let displayName: String
    public let avatarURL: String?
    public let bio: String?
    public let status: UserStatus
    public let revision: Int
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUIDv7,
        username: String,
        displayName: String,
        avatarURL: String?,
        bio: String?,
        status: UserStatus,
        revision: Int,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.username = username
        self.displayName = displayName
        self.avatarURL = avatarURL
        self.bio = bio
        self.status = status
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct FollowedClassSection: Codable, Equatable, Sendable {
    public let classSectionID: UUIDv7
    public let followedAt: Date

    public init(classSectionID: UUIDv7, followedAt: Date) {
        self.classSectionID = classSectionID
        self.followedAt = followedAt
    }
}

public struct ClassSectionRecord: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let courseID: UUIDv7
    public let externalSectionID: String
    public let sectionNumber: String
    public let departmentCode: String?
    public let departmentName: String?
    public let instructors: [String]
    public let campus: String?
    public let capacity: Int?
    public let scheduleText: String?
    public let active: Bool
    public let revision: Int
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUIDv7,
        courseID: UUIDv7,
        externalSectionID: String,
        sectionNumber: String,
        departmentCode: String?,
        departmentName: String?,
        instructors: [String],
        campus: String?,
        capacity: Int?,
        scheduleText: String?,
        active: Bool,
        revision: Int,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.courseID = courseID
        self.externalSectionID = externalSectionID
        self.sectionNumber = sectionNumber
        self.departmentCode = departmentCode
        self.departmentName = departmentName
        self.instructors = instructors
        self.campus = campus
        self.capacity = capacity
        self.scheduleText = scheduleText
        self.active = active
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct CourseTask: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let classSectionID: UUIDv7
    public let createdBy: UUIDv7?
    public let state: ContentState
    public let revision: Int
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUIDv7,
        classSectionID: UUIDv7,
        createdBy: UUIDv7?,
        state: ContentState,
        revision: Int,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.classSectionID = classSectionID
        self.createdBy = createdBy
        self.state = state
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct TaskProposal: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let courseTaskID: UUIDv7
    public let authorID: UUIDv7?
    public let title: String
    public let deadline: Date
    public let description: String?
    public let evidenceNote: String?
    public let evidenceURL: String?
    public let contentFingerprint: String
    public let state: ContentState
    public let revision: Int
    public let createdAt: Date

    public init(
        id: UUIDv7,
        courseTaskID: UUIDv7,
        authorID: UUIDv7?,
        title: String,
        deadline: Date,
        description: String?,
        evidenceNote: String?,
        evidenceURL: String?,
        contentFingerprint: String,
        state: ContentState,
        revision: Int,
        createdAt: Date
    ) {
        self.id = id
        self.courseTaskID = courseTaskID
        self.authorID = authorID
        self.title = title
        self.deadline = deadline
        self.description = description
        self.evidenceNote = evidenceNote
        self.evidenceURL = evidenceURL
        self.contentFingerprint = contentFingerprint
        self.state = state
        self.revision = revision
        self.createdAt = createdAt
    }
}

public struct ProposalVoteTotals: Codable, Equatable, Sendable {
    public let proposalID: UUIDv7
    public let up: Int
    public let down: Int
    public let updatedAt: Date
    public let revision: Int

    public init(proposalID: UUIDv7, up: Int, down: Int, updatedAt: Date, revision: Int) {
        self.proposalID = proposalID
        self.up = up
        self.down = down
        self.updatedAt = updatedAt
        self.revision = revision
    }
}

public struct AccuracyVote: Codable, Equatable, Sendable {
    public let proposalID: UUIDv7
    public let value: AccuracyVoteValue
    public let updatedAt: Date
    public let revision: Int

    public init(proposalID: UUIDv7, value: AccuracyVoteValue, updatedAt: Date, revision: Int) {
        self.proposalID = proposalID
        self.value = value
        self.updatedAt = updatedAt
        self.revision = revision
    }
}

public struct ProposalRedirect: Codable, Equatable, Sendable {
    public let sourceProposalID: UUIDv7
    public let canonicalProposalID: UUIDv7
    public let revision: Int
    public let createdAt: Date

    public init(sourceProposalID: UUIDv7, canonicalProposalID: UUIDv7, revision: Int, createdAt: Date) {
        self.sourceProposalID = sourceProposalID
        self.canonicalProposalID = canonicalProposalID
        self.revision = revision
        self.createdAt = createdAt
    }
}

public struct TaskMerge: Codable, Equatable, Sendable {
    public let sourceTaskID: UUIDv7
    public let targetTaskID: UUIDv7
    public let reason: String
    public let revision: Int
    public let createdAt: Date

    public init(sourceTaskID: UUIDv7, targetTaskID: UUIDv7, reason: String, revision: Int, createdAt: Date) {
        self.sourceTaskID = sourceTaskID
        self.targetTaskID = targetTaskID
        self.reason = reason
        self.revision = revision
        self.createdAt = createdAt
    }
}

public struct PersonalTodo: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let classSectionID: UUIDv7?
    public let title: String
    public let deadline: Date?
    public let note: String?
    public let state: TaskProgressState
    public let revision: Int
    public let deletedAt: Date?
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUIDv7,
        classSectionID: UUIDv7?,
        title: String,
        deadline: Date?,
        note: String?,
        state: TaskProgressState,
        revision: Int,
        deletedAt: Date?,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.classSectionID = classSectionID
        self.title = title
        self.deadline = deadline
        self.note = note
        self.state = state
        self.revision = revision
        self.deletedAt = deletedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct PersonalTaskDetails: Codable, Equatable, Sendable {
    public let courseTaskID: UUIDv7
    public let privateTitle: String?
    public let privateDeadline: Date?
    public let privateNote: String?
    public let revision: Int
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        courseTaskID: UUIDv7,
        privateTitle: String?,
        privateDeadline: Date?,
        privateNote: String?,
        revision: Int,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.courseTaskID = courseTaskID
        self.privateTitle = privateTitle
        self.privateDeadline = privateDeadline
        self.privateNote = privateNote
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct PersonalTaskState: Codable, Equatable, Sendable {
    public let courseTaskID: UUIDv7
    public let state: TaskProgressState
    public let revision: Int
    public let createdAt: Date
    public let updatedAt: Date

    public init(courseTaskID: UUIDv7, state: TaskProgressState, revision: Int, createdAt: Date, updatedAt: Date) {
        self.courseTaskID = courseTaskID
        self.state = state
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct TaskComment: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let courseTaskID: UUIDv7
    public let authorID: UUIDv7?
    public let body: String
    public let revision: Int
    public let state: ContentState
    public let deletedAt: Date?
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUIDv7,
        courseTaskID: UUIDv7,
        authorID: UUIDv7?,
        body: String,
        revision: Int,
        state: ContentState,
        deletedAt: Date?,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.courseTaskID = courseTaskID
        self.authorID = authorID
        self.body = body
        self.revision = revision
        self.state = state
        self.deletedAt = deletedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct ReporterContentReport: Codable, Equatable, Sendable, Identifiable {
    public var id: UUIDv7 { reportID }
    public let reportID: UUIDv7
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

public struct ContentTombstone: Codable, Equatable, Sendable {
    public let entityType: ContentEntityType
    public let entityID: UUIDv7
    public let state: ContentState
    public let revision: Int
    public let deletedAt: Date?

    public init(entityType: ContentEntityType, entityID: UUIDv7, state: ContentState, revision: Int, deletedAt: Date? = nil) {
        self.entityType = entityType
        self.entityID = entityID
        self.state = state
        self.revision = revision
        self.deletedAt = deletedAt
    }
}

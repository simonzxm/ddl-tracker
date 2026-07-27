public import Foundation

public struct CanonicalProposalPayload: Codable, Equatable, Sendable {
    public let title: String
    public let deadline: Date
    public let description: String?
    public let evidenceNote: String?
    public let evidenceURL: String?

    public init(title: String, deadline: Date, description: String?, evidenceNote: String?, evidenceURL: String?) {
        self.title = title
        self.deadline = deadline
        self.description = description
        self.evidenceNote = evidenceNote
        self.evidenceURL = evidenceURL
    }
}

public struct FollowClassSectionPayload: Codable, Equatable, Sendable {
    public let classSectionID: UUIDv7

    public init(classSectionID: UUIDv7) {
        self.classSectionID = classSectionID
    }
}

public struct UnfollowClassSectionPayload: Codable, Equatable, Sendable {
    public let classSectionID: UUIDv7

    public init(classSectionID: UUIDv7) {
        self.classSectionID = classSectionID
    }
}

public struct CreatePersonalTodoPayload: Codable, Equatable, Sendable {
    public let personalTodoID: UUIDv7
    public let classSectionID: UUIDv7?
    public let title: String
    public let deadline: Date?
    public let note: String?
    public let state: TaskProgressState

    public init(personalTodoID: UUIDv7, classSectionID: UUIDv7?, title: String, deadline: Date?, note: String?, state: TaskProgressState) {
        self.personalTodoID = personalTodoID
        self.classSectionID = classSectionID
        self.title = title
        self.deadline = deadline
        self.note = note
        self.state = state
    }
}

public struct UpdatePersonalTodoPayload: Codable, Equatable, Sendable {
    public let personalTodoID: UUIDv7
    public let classSectionID: UUIDv7?
    public let title: String
    public let deadline: Date?
    public let note: String?
    public let state: TaskProgressState
    public let expectedRevision: Int

    public init(personalTodoID: UUIDv7, classSectionID: UUIDv7?, title: String, deadline: Date?, note: String?, state: TaskProgressState, expectedRevision: Int) {
        self.personalTodoID = personalTodoID
        self.classSectionID = classSectionID
        self.title = title
        self.deadline = deadline
        self.note = note
        self.state = state
        self.expectedRevision = expectedRevision
    }
}

public struct DeletePersonalTodoPayload: Codable, Equatable, Sendable {
    public let personalTodoID: UUIDv7
    public let expectedRevision: Int

    public init(personalTodoID: UUIDv7, expectedRevision: Int) {
        self.personalTodoID = personalTodoID
        self.expectedRevision = expectedRevision
    }
}

public struct UpsertPersonalTaskDetailsPayload: Codable, Equatable, Sendable {
    public let courseTaskID: UUIDv7
    public let privateTitle: String?
    public let privateDeadline: Date?
    public let privateNote: String?
    public let expectedRevision: Int

    public init(courseTaskID: UUIDv7, privateTitle: String?, privateDeadline: Date?, privateNote: String?, expectedRevision: Int) {
        self.courseTaskID = courseTaskID
        self.privateTitle = privateTitle
        self.privateDeadline = privateDeadline
        self.privateNote = privateNote
        self.expectedRevision = expectedRevision
    }
}

public struct DeletePersonalTaskDetailsPayload: Codable, Equatable, Sendable {
    public let courseTaskID: UUIDv7
    public let expectedRevision: Int

    public init(courseTaskID: UUIDv7, expectedRevision: Int) {
        self.courseTaskID = courseTaskID
        self.expectedRevision = expectedRevision
    }
}

public struct SetPersonalTaskStatePayload: Codable, Equatable, Sendable {
    public let courseTaskID: UUIDv7
    public let state: TaskProgressState
    public let expectedRevision: Int

    public init(courseTaskID: UUIDv7, state: TaskProgressState, expectedRevision: Int) {
        self.courseTaskID = courseTaskID
        self.state = state
        self.expectedRevision = expectedRevision
    }
}

public struct MergePersonalTodoIntoCourseTaskPayload: Codable, Equatable, Sendable {
    public let personalTodoID: UUIDv7
    public let courseTaskID: UUIDv7
    public let expectedPersonalTodoRevision: Int
    public let expectedDetailsRevision: Int
    public let expectedStateRevision: Int

    public init(personalTodoID: UUIDv7, courseTaskID: UUIDv7, expectedPersonalTodoRevision: Int, expectedDetailsRevision: Int, expectedStateRevision: Int) {
        self.personalTodoID = personalTodoID
        self.courseTaskID = courseTaskID
        self.expectedPersonalTodoRevision = expectedPersonalTodoRevision
        self.expectedDetailsRevision = expectedDetailsRevision
        self.expectedStateRevision = expectedStateRevision
    }
}

public struct PublishPersonalTodoAsCourseTaskPayload: Codable, Equatable, Sendable {
    public let personalTodoID: UUIDv7
    public let expectedPersonalTodoRevision: Int
    public let courseTaskID: UUIDv7
    public let classSectionID: UUIDv7
    public let proposalID: UUIDv7
    public let proposal: CanonicalProposalPayload

    public init(personalTodoID: UUIDv7, expectedPersonalTodoRevision: Int, courseTaskID: UUIDv7, classSectionID: UUIDv7, proposalID: UUIDv7, proposal: CanonicalProposalPayload) {
        self.personalTodoID = personalTodoID
        self.expectedPersonalTodoRevision = expectedPersonalTodoRevision
        self.courseTaskID = courseTaskID
        self.classSectionID = classSectionID
        self.proposalID = proposalID
        self.proposal = proposal
    }
}

public struct PublishPersonalTaskDetailsAsProposalPayload: Codable, Equatable, Sendable {
    public let courseTaskID: UUIDv7
    public let proposalID: UUIDv7
    public let expectedDetailsRevision: Int
    public let proposal: CanonicalProposalPayload

    public init(courseTaskID: UUIDv7, proposalID: UUIDv7, expectedDetailsRevision: Int, proposal: CanonicalProposalPayload) {
        self.courseTaskID = courseTaskID
        self.proposalID = proposalID
        self.expectedDetailsRevision = expectedDetailsRevision
        self.proposal = proposal
    }
}

public struct CreateCourseTaskWithInitialProposalPayload: Codable, Equatable, Sendable {
    public let courseTaskID: UUIDv7
    public let classSectionID: UUIDv7
    public let proposalID: UUIDv7
    public let proposal: CanonicalProposalPayload

    public init(courseTaskID: UUIDv7, classSectionID: UUIDv7, proposalID: UUIDv7, proposal: CanonicalProposalPayload) {
        self.courseTaskID = courseTaskID
        self.classSectionID = classSectionID
        self.proposalID = proposalID
        self.proposal = proposal
    }
}

public struct CreateTaskProposalPayload: Codable, Equatable, Sendable {
    public let courseTaskID: UUIDv7
    public let proposalID: UUIDv7
    public let proposal: CanonicalProposalPayload

    public init(courseTaskID: UUIDv7, proposalID: UUIDv7, proposal: CanonicalProposalPayload) {
        self.courseTaskID = courseTaskID
        self.proposalID = proposalID
        self.proposal = proposal
    }
}

public struct SetAccuracyVotePayload: Codable, Equatable, Sendable {
    public let proposalID: UUIDv7
    public let value: AccuracyVoteValue

    public init(proposalID: UUIDv7, value: AccuracyVoteValue) {
        self.proposalID = proposalID
        self.value = value
    }
}

public struct CreateTaskCommentPayload: Codable, Equatable, Sendable {
    public let commentID: UUIDv7
    public let courseTaskID: UUIDv7
    public let body: String

    public init(commentID: UUIDv7, courseTaskID: UUIDv7, body: String) {
        self.commentID = commentID
        self.courseTaskID = courseTaskID
        self.body = body
    }
}

public struct EditTaskCommentPayload: Codable, Equatable, Sendable {
    public let commentID: UUIDv7
    public let body: String
    public let expectedRevision: Int

    public init(commentID: UUIDv7, body: String, expectedRevision: Int) {
        self.commentID = commentID
        self.body = body
        self.expectedRevision = expectedRevision
    }
}

public struct DeleteTaskCommentPayload: Codable, Equatable, Sendable {
    public let commentID: UUIDv7
    public let expectedRevision: Int

    public init(commentID: UUIDv7, expectedRevision: Int) {
        self.commentID = commentID
        self.expectedRevision = expectedRevision
    }
}

public struct CreateContentReportPayload: Codable, Equatable, Sendable {
    public let reportID: UUIDv7
    public let targetType: ReportTargetType
    public let targetID: UUIDv7
    public let reason: ReportReason
    public let details: String?

    public init(reportID: UUIDv7, targetType: ReportTargetType, targetID: UUIDv7, reason: ReportReason, details: String?) {
        self.reportID = reportID
        self.targetType = targetType
        self.targetID = targetID
        self.reason = reason
        self.details = details
    }
}

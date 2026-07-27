public import Foundation

public enum SyncEvent: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, CaseIterable, Sendable {
        case classSectionFollowed = "class_section_followed"
        case classSectionUnfollowed = "class_section_unfollowed"
        case courseTaskCreated = "course_task_created"
        case courseTaskMerged = "course_task_merged"
        case courseTaskHidden = "course_task_hidden"
        case courseTaskRestored = "course_task_restored"
        case taskProposalCreated = "task_proposal_created"
        case taskProposalHidden = "task_proposal_hidden"
        case taskProposalRestored = "task_proposal_restored"
        case taskProposalRedirected = "task_proposal_redirected"
        case proposalVoteTotalsUpdated = "proposal_vote_totals_updated"
        case accuracyVoteUpdated = "accuracy_vote_updated"
        case personalTodoUpserted = "personal_todo_upserted"
        case personalTodoDeleted = "personal_todo_deleted"
        case personalTaskDetailsUpserted = "personal_task_details_upserted"
        case personalTaskDetailsDeleted = "personal_task_details_deleted"
        case personalTaskStateUpserted = "personal_task_state_upserted"
        case personalTaskStateDeleted = "personal_task_state_deleted"
        case taskCommentUpserted = "task_comment_upserted"
        case taskCommentDeleted = "task_comment_deleted"
        case taskCommentHidden = "task_comment_hidden"
        case taskCommentRestored = "task_comment_restored"
        case publicUserProfileUpdated = "public_user_profile_updated"
        case publicUserDeleted = "public_user_deleted"
        case reporterContentReportUpdated = "reporter_content_report_updated"
        case maintainerContentReportUpdated = "maintainer_content_report_updated"
        case classSectionDeactivated = "class_section_deactivated"
        case catalogRevisionChanged = "catalog_revision_changed"
    }

    case classSectionFollowed(SyncEventValue<FollowedClassSection>)
    case classSectionUnfollowed(SyncEventValue<UnfollowedClassSection>)
    case courseTaskCreated(SyncEventValue<CourseTask>)
    case courseTaskMerged(SyncEventValue<TaskMergeEvent>)
    case courseTaskHidden(SyncEventValue<ContentTombstone>)
    case courseTaskRestored(SyncEventValue<CourseTask>)
    case taskProposalCreated(SyncEventValue<TaskProposal>)
    case taskProposalHidden(SyncEventValue<ContentTombstone>)
    case taskProposalRestored(SyncEventValue<TaskProposal>)
    case taskProposalRedirected(SyncEventValue<ProposalRedirect>)
    case proposalVoteTotalsUpdated(SyncEventValue<ProposalVoteTotals>)
    case accuracyVoteUpdated(SyncEventValue<AccuracyVote>)
    case personalTodoUpserted(SyncEventValue<PersonalTodo>)
    case personalTodoDeleted(SyncEventValue<PersonalTodoDeletion>)
    case personalTaskDetailsUpserted(SyncEventValue<PersonalTaskDetails>)
    case personalTaskDetailsDeleted(SyncEventValue<CourseTaskScopedDeletion>)
    case personalTaskStateUpserted(SyncEventValue<PersonalTaskState>)
    case personalTaskStateDeleted(SyncEventValue<CourseTaskScopedDeletion>)
    case taskCommentUpserted(SyncEventValue<TaskComment>)
    case taskCommentDeleted(SyncEventValue<ContentTombstone>)
    case taskCommentHidden(SyncEventValue<ContentTombstone>)
    case taskCommentRestored(SyncEventValue<TaskComment>)
    case publicUserProfileUpdated(SyncEventValue<PublicUserProfile>)
    case publicUserDeleted(SyncEventValue<PublicUserDeletion>)
    case reporterContentReportUpdated(SyncEventValue<ReporterContentReport>)
    case maintainerContentReportUpdated(SyncEventValue<MaintainerContentReport>)
    case classSectionDeactivated(SyncEventValue<ClassSectionDeactivation>)
    case catalogRevisionChanged(SyncEventValue<CatalogRevision>)

    public var kind: Kind {
        switch self {
        case .classSectionFollowed: .classSectionFollowed
        case .classSectionUnfollowed: .classSectionUnfollowed
        case .courseTaskCreated: .courseTaskCreated
        case .courseTaskMerged: .courseTaskMerged
        case .courseTaskHidden: .courseTaskHidden
        case .courseTaskRestored: .courseTaskRestored
        case .taskProposalCreated: .taskProposalCreated
        case .taskProposalHidden: .taskProposalHidden
        case .taskProposalRestored: .taskProposalRestored
        case .taskProposalRedirected: .taskProposalRedirected
        case .proposalVoteTotalsUpdated: .proposalVoteTotalsUpdated
        case .accuracyVoteUpdated: .accuracyVoteUpdated
        case .personalTodoUpserted: .personalTodoUpserted
        case .personalTodoDeleted: .personalTodoDeleted
        case .personalTaskDetailsUpserted: .personalTaskDetailsUpserted
        case .personalTaskDetailsDeleted: .personalTaskDetailsDeleted
        case .personalTaskStateUpserted: .personalTaskStateUpserted
        case .personalTaskStateDeleted: .personalTaskStateDeleted
        case .taskCommentUpserted: .taskCommentUpserted
        case .taskCommentDeleted: .taskCommentDeleted
        case .taskCommentHidden: .taskCommentHidden
        case .taskCommentRestored: .taskCommentRestored
        case .publicUserProfileUpdated: .publicUserProfileUpdated
        case .publicUserDeleted: .publicUserDeleted
        case .reporterContentReportUpdated: .reporterContentReportUpdated
        case .maintainerContentReportUpdated: .maintainerContentReportUpdated
        case .classSectionDeactivated: .classSectionDeactivated
        case .catalogRevisionChanged: .catalogRevisionChanged
        }
    }

    public var eventID: UUIDv7 {
        switch self {
        case let .classSectionFollowed(value): value.eventID
        case let .classSectionUnfollowed(value): value.eventID
        case let .courseTaskCreated(value): value.eventID
        case let .courseTaskMerged(value): value.eventID
        case let .courseTaskHidden(value): value.eventID
        case let .courseTaskRestored(value): value.eventID
        case let .taskProposalCreated(value): value.eventID
        case let .taskProposalHidden(value): value.eventID
        case let .taskProposalRestored(value): value.eventID
        case let .taskProposalRedirected(value): value.eventID
        case let .proposalVoteTotalsUpdated(value): value.eventID
        case let .accuracyVoteUpdated(value): value.eventID
        case let .personalTodoUpserted(value): value.eventID
        case let .personalTodoDeleted(value): value.eventID
        case let .personalTaskDetailsUpserted(value): value.eventID
        case let .personalTaskDetailsDeleted(value): value.eventID
        case let .personalTaskStateUpserted(value): value.eventID
        case let .personalTaskStateDeleted(value): value.eventID
        case let .taskCommentUpserted(value): value.eventID
        case let .taskCommentDeleted(value): value.eventID
        case let .taskCommentHidden(value): value.eventID
        case let .taskCommentRestored(value): value.eventID
        case let .publicUserProfileUpdated(value): value.eventID
        case let .publicUserDeleted(value): value.eventID
        case let .reporterContentReportUpdated(value): value.eventID
        case let .maintainerContentReportUpdated(value): value.eventID
        case let .classSectionDeactivated(value): value.eventID
        case let .catalogRevisionChanged(value): value.eventID
        }
    }

    public var occurredAt: Date {
        switch self {
        case let .classSectionFollowed(value): value.occurredAt
        case let .classSectionUnfollowed(value): value.occurredAt
        case let .courseTaskCreated(value): value.occurredAt
        case let .courseTaskMerged(value): value.occurredAt
        case let .courseTaskHidden(value): value.occurredAt
        case let .courseTaskRestored(value): value.occurredAt
        case let .taskProposalCreated(value): value.occurredAt
        case let .taskProposalHidden(value): value.occurredAt
        case let .taskProposalRestored(value): value.occurredAt
        case let .taskProposalRedirected(value): value.occurredAt
        case let .proposalVoteTotalsUpdated(value): value.occurredAt
        case let .accuracyVoteUpdated(value): value.occurredAt
        case let .personalTodoUpserted(value): value.occurredAt
        case let .personalTodoDeleted(value): value.occurredAt
        case let .personalTaskDetailsUpserted(value): value.occurredAt
        case let .personalTaskDetailsDeleted(value): value.occurredAt
        case let .personalTaskStateUpserted(value): value.occurredAt
        case let .personalTaskStateDeleted(value): value.occurredAt
        case let .taskCommentUpserted(value): value.occurredAt
        case let .taskCommentDeleted(value): value.occurredAt
        case let .taskCommentHidden(value): value.occurredAt
        case let .taskCommentRestored(value): value.occurredAt
        case let .publicUserProfileUpdated(value): value.occurredAt
        case let .publicUserDeleted(value): value.occurredAt
        case let .reporterContentReportUpdated(value): value.occurredAt
        case let .maintainerContentReportUpdated(value): value.occurredAt
        case let .classSectionDeactivated(value): value.occurredAt
        case let .catalogRevisionChanged(value): value.occurredAt
        }
    }

    private enum CodingKeys: String, CodingKey {
        case eventID
        case schemaVersion
        case type
        case occurredAt
        case payload
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .schemaVersion)
        guard version == 2 else {
            throw DecodingError.dataCorruptedError(forKey: .schemaVersion, in: container, debugDescription: "Unsupported sync event schema version \(version).")
        }
        let eventID = try container.decode(UUIDv7.self, forKey: .eventID)
        let occurredAt = try container.decode(Date.self, forKey: .occurredAt)
        let kind = try container.decode(Kind.self, forKey: .type)
        switch kind {
        case .classSectionFollowed: self = .classSectionFollowed(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(FollowedClassSection.self, forKey: .payload)))
        case .classSectionUnfollowed: self = .classSectionUnfollowed(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(UnfollowedClassSection.self, forKey: .payload)))
        case .courseTaskCreated: self = .courseTaskCreated(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(CourseTask.self, forKey: .payload)))
        case .courseTaskMerged: self = .courseTaskMerged(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(TaskMergeEvent.self, forKey: .payload)))
        case .courseTaskHidden: self = .courseTaskHidden(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(ContentTombstone.self, forKey: .payload)))
        case .courseTaskRestored: self = .courseTaskRestored(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(CourseTask.self, forKey: .payload)))
        case .taskProposalCreated: self = .taskProposalCreated(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(TaskProposal.self, forKey: .payload)))
        case .taskProposalHidden: self = .taskProposalHidden(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(ContentTombstone.self, forKey: .payload)))
        case .taskProposalRestored: self = .taskProposalRestored(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(TaskProposal.self, forKey: .payload)))
        case .taskProposalRedirected: self = .taskProposalRedirected(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(ProposalRedirect.self, forKey: .payload)))
        case .proposalVoteTotalsUpdated: self = .proposalVoteTotalsUpdated(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(ProposalVoteTotals.self, forKey: .payload)))
        case .accuracyVoteUpdated: self = .accuracyVoteUpdated(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(AccuracyVote.self, forKey: .payload)))
        case .personalTodoUpserted: self = .personalTodoUpserted(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(PersonalTodo.self, forKey: .payload)))
        case .personalTodoDeleted: self = .personalTodoDeleted(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(PersonalTodoDeletion.self, forKey: .payload)))
        case .personalTaskDetailsUpserted: self = .personalTaskDetailsUpserted(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(PersonalTaskDetails.self, forKey: .payload)))
        case .personalTaskDetailsDeleted: self = .personalTaskDetailsDeleted(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(CourseTaskScopedDeletion.self, forKey: .payload)))
        case .personalTaskStateUpserted: self = .personalTaskStateUpserted(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(PersonalTaskState.self, forKey: .payload)))
        case .personalTaskStateDeleted: self = .personalTaskStateDeleted(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(CourseTaskScopedDeletion.self, forKey: .payload)))
        case .taskCommentUpserted: self = .taskCommentUpserted(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(TaskComment.self, forKey: .payload)))
        case .taskCommentDeleted: self = .taskCommentDeleted(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(ContentTombstone.self, forKey: .payload)))
        case .taskCommentHidden: self = .taskCommentHidden(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(ContentTombstone.self, forKey: .payload)))
        case .taskCommentRestored: self = .taskCommentRestored(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(TaskComment.self, forKey: .payload)))
        case .publicUserProfileUpdated: self = .publicUserProfileUpdated(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(PublicUserProfile.self, forKey: .payload)))
        case .publicUserDeleted: self = .publicUserDeleted(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(PublicUserDeletion.self, forKey: .payload)))
        case .reporterContentReportUpdated: self = .reporterContentReportUpdated(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(ReporterContentReport.self, forKey: .payload)))
        case .maintainerContentReportUpdated: self = .maintainerContentReportUpdated(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(MaintainerContentReport.self, forKey: .payload)))
        case .classSectionDeactivated: self = .classSectionDeactivated(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(ClassSectionDeactivation.self, forKey: .payload)))
        case .catalogRevisionChanged: self = .catalogRevisionChanged(SyncEventValue(eventID: eventID, occurredAt: occurredAt, payload: try container.decode(CatalogRevision.self, forKey: .payload)))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(eventID, forKey: .eventID)
        try container.encode(2, forKey: .schemaVersion)
        try container.encode(kind, forKey: .type)
        try container.encode(occurredAt, forKey: .occurredAt)
        switch self {
        case let .classSectionFollowed(value): try container.encode(value.payload, forKey: .payload)
        case let .classSectionUnfollowed(value): try container.encode(value.payload, forKey: .payload)
        case let .courseTaskCreated(value): try container.encode(value.payload, forKey: .payload)
        case let .courseTaskMerged(value): try container.encode(value.payload, forKey: .payload)
        case let .courseTaskHidden(value): try container.encode(value.payload, forKey: .payload)
        case let .courseTaskRestored(value): try container.encode(value.payload, forKey: .payload)
        case let .taskProposalCreated(value): try container.encode(value.payload, forKey: .payload)
        case let .taskProposalHidden(value): try container.encode(value.payload, forKey: .payload)
        case let .taskProposalRestored(value): try container.encode(value.payload, forKey: .payload)
        case let .taskProposalRedirected(value): try container.encode(value.payload, forKey: .payload)
        case let .proposalVoteTotalsUpdated(value): try container.encode(value.payload, forKey: .payload)
        case let .accuracyVoteUpdated(value): try container.encode(value.payload, forKey: .payload)
        case let .personalTodoUpserted(value): try container.encode(value.payload, forKey: .payload)
        case let .personalTodoDeleted(value): try container.encode(value.payload, forKey: .payload)
        case let .personalTaskDetailsUpserted(value): try container.encode(value.payload, forKey: .payload)
        case let .personalTaskDetailsDeleted(value): try container.encode(value.payload, forKey: .payload)
        case let .personalTaskStateUpserted(value): try container.encode(value.payload, forKey: .payload)
        case let .personalTaskStateDeleted(value): try container.encode(value.payload, forKey: .payload)
        case let .taskCommentUpserted(value): try container.encode(value.payload, forKey: .payload)
        case let .taskCommentDeleted(value): try container.encode(value.payload, forKey: .payload)
        case let .taskCommentHidden(value): try container.encode(value.payload, forKey: .payload)
        case let .taskCommentRestored(value): try container.encode(value.payload, forKey: .payload)
        case let .publicUserProfileUpdated(value): try container.encode(value.payload, forKey: .payload)
        case let .publicUserDeleted(value): try container.encode(value.payload, forKey: .payload)
        case let .reporterContentReportUpdated(value): try container.encode(value.payload, forKey: .payload)
        case let .maintainerContentReportUpdated(value): try container.encode(value.payload, forKey: .payload)
        case let .classSectionDeactivated(value): try container.encode(value.payload, forKey: .payload)
        case let .catalogRevisionChanged(value): try container.encode(value.payload, forKey: .payload)
        }
    }
}

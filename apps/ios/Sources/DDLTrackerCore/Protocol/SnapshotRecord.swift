public enum SnapshotRecord: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, CaseIterable, Sendable {
        case catalogRevision = "catalog_revision"
        case publicUserProfile = "public_user_profile"
        case followedClassSection = "followed_class_section"
        case classSection = "class_section"
        case courseTask = "course_task"
        case taskProposal = "task_proposal"
        case proposalVoteTotals = "proposal_vote_totals"
        case accuracyVote = "accuracy_vote"
        case proposalRedirect = "proposal_redirect"
        case taskMerge = "task_merge"
        case personalTodo = "personal_todo"
        case personalTaskDetails = "personal_task_details"
        case personalTaskState = "personal_task_state"
        case taskComment = "task_comment"
        case reporterContentReport = "reporter_content_report"
        case contentTombstone = "content_tombstone"
    }

    case catalogRevision(CatalogRevision)
    case publicUserProfile(PublicUserProfile)
    case followedClassSection(FollowedClassSection)
    case classSection(ClassSectionRecord)
    case courseTask(CourseTask)
    case taskProposal(TaskProposal)
    case proposalVoteTotals(ProposalVoteTotals)
    case accuracyVote(AccuracyVote)
    case proposalRedirect(ProposalRedirect)
    case taskMerge(TaskMerge)
    case personalTodo(PersonalTodo)
    case personalTaskDetails(PersonalTaskDetails)
    case personalTaskState(PersonalTaskState)
    case taskComment(TaskComment)
    case reporterContentReport(ReporterContentReport)
    case contentTombstone(ContentTombstone)

    public var kind: Kind {
        switch self {
        case .catalogRevision: .catalogRevision
        case .publicUserProfile: .publicUserProfile
        case .followedClassSection: .followedClassSection
        case .classSection: .classSection
        case .courseTask: .courseTask
        case .taskProposal: .taskProposal
        case .proposalVoteTotals: .proposalVoteTotals
        case .accuracyVote: .accuracyVote
        case .proposalRedirect: .proposalRedirect
        case .taskMerge: .taskMerge
        case .personalTodo: .personalTodo
        case .personalTaskDetails: .personalTaskDetails
        case .personalTaskState: .personalTaskState
        case .taskComment: .taskComment
        case .reporterContentReport: .reporterContentReport
        case .contentTombstone: .contentTombstone
        }
    }

    private enum CodingKeys: String, CodingKey {
        case recordType
        case schemaVersion
        case payload
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .schemaVersion)
        guard version == 1 else {
            throw DecodingError.dataCorruptedError(
                forKey: .schemaVersion,
                in: container,
                debugDescription: "Unsupported snapshot schema version \(version)."
            )
        }
        let kind = try container.decode(Kind.self, forKey: .recordType)
        switch kind {
        case .catalogRevision: self = .catalogRevision(try container.decode(CatalogRevision.self, forKey: .payload))
        case .publicUserProfile: self = .publicUserProfile(try container.decode(PublicUserProfile.self, forKey: .payload))
        case .followedClassSection: self = .followedClassSection(try container.decode(FollowedClassSection.self, forKey: .payload))
        case .classSection: self = .classSection(try container.decode(ClassSectionRecord.self, forKey: .payload))
        case .courseTask: self = .courseTask(try container.decode(CourseTask.self, forKey: .payload))
        case .taskProposal: self = .taskProposal(try container.decode(TaskProposal.self, forKey: .payload))
        case .proposalVoteTotals: self = .proposalVoteTotals(try container.decode(ProposalVoteTotals.self, forKey: .payload))
        case .accuracyVote: self = .accuracyVote(try container.decode(AccuracyVote.self, forKey: .payload))
        case .proposalRedirect: self = .proposalRedirect(try container.decode(ProposalRedirect.self, forKey: .payload))
        case .taskMerge: self = .taskMerge(try container.decode(TaskMerge.self, forKey: .payload))
        case .personalTodo: self = .personalTodo(try container.decode(PersonalTodo.self, forKey: .payload))
        case .personalTaskDetails: self = .personalTaskDetails(try container.decode(PersonalTaskDetails.self, forKey: .payload))
        case .personalTaskState: self = .personalTaskState(try container.decode(PersonalTaskState.self, forKey: .payload))
        case .taskComment: self = .taskComment(try container.decode(TaskComment.self, forKey: .payload))
        case .reporterContentReport: self = .reporterContentReport(try container.decode(ReporterContentReport.self, forKey: .payload))
        case .contentTombstone: self = .contentTombstone(try container.decode(ContentTombstone.self, forKey: .payload))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .recordType)
        try container.encode(1, forKey: .schemaVersion)
        switch self {
        case let .catalogRevision(value): try container.encode(value, forKey: .payload)
        case let .publicUserProfile(value): try container.encode(value, forKey: .payload)
        case let .followedClassSection(value): try container.encode(value, forKey: .payload)
        case let .classSection(value): try container.encode(value, forKey: .payload)
        case let .courseTask(value): try container.encode(value, forKey: .payload)
        case let .taskProposal(value): try container.encode(value, forKey: .payload)
        case let .proposalVoteTotals(value): try container.encode(value, forKey: .payload)
        case let .accuracyVote(value): try container.encode(value, forKey: .payload)
        case let .proposalRedirect(value): try container.encode(value, forKey: .payload)
        case let .taskMerge(value): try container.encode(value, forKey: .payload)
        case let .personalTodo(value): try container.encode(value, forKey: .payload)
        case let .personalTaskDetails(value): try container.encode(value, forKey: .payload)
        case let .personalTaskState(value): try container.encode(value, forKey: .payload)
        case let .taskComment(value): try container.encode(value, forKey: .payload)
        case let .reporterContentReport(value): try container.encode(value, forKey: .payload)
        case let .contentTombstone(value): try container.encode(value, forKey: .payload)
        }
    }
}

public struct ProjectionEntityKey: Codable, Hashable, Sendable {
    public let type: ContentEntityType
    public let id: UUIDv7

    public init(type: ContentEntityType, id: UUIDv7) {
        self.type = type
        self.id = id
    }
}

public enum ProjectionResolutionError: Error, Equatable, Sendable {
    case redirectCycle
    case taskMergeCycle
}

public struct ClientProjection: Codable, Equatable, Sendable {
    public var catalogRevision: CatalogRevision?
    public var publicUsers: [UUIDv7: PublicUserProfile] = [:]
    public var deletedUsers: [UUIDv7: PublicUserDeletion] = [:]
    public var followedClassSections: [UUIDv7: FollowedClassSection] = [:]
    public var classSections: [UUIDv7: ClassSectionRecord] = [:]
    public var courseTasks: [UUIDv7: CourseTask] = [:]
    public var taskProposals: [UUIDv7: TaskProposal] = [:]
    public var proposalVoteTotals: [UUIDv7: ProposalVoteTotals] = [:]
    public var accuracyVotes: [UUIDv7: AccuracyVote] = [:]
    public var proposalRedirects: [UUIDv7: ProposalRedirect] = [:]
    public var taskMerges: [UUIDv7: TaskMerge] = [:]
    public var personalTodos: [UUIDv7: PersonalTodo] = [:]
    public var personalTaskDetails: [UUIDv7: PersonalTaskDetails] = [:]
    public var personalTaskStates: [UUIDv7: PersonalTaskState] = [:]
    public var taskComments: [UUIDv7: TaskComment] = [:]
    public var reporterReports: [UUIDv7: ReporterContentReport] = [:]
    public var maintainerReports: [UUIDv7: MaintainerContentReport] = [:]
    public var contentTombstones: [ProjectionEntityKey: ContentTombstone] = [:]
    public var personalTodoDeletionRevisions: [UUIDv7: Int] = [:]
    public var personalTaskDetailsDeletionRevisions: [UUIDv7: Int] = [:]
    public var personalTaskStateDeletionRevisions: [UUIDv7: Int] = [:]
    public var processedEventIDs: Set<UUIDv7> = []

    public init() {}

    public mutating func apply(_ record: SnapshotRecord) {
        switch record {
        case let .catalogRevision(value): upsertCatalogRevision(value)
        case let .publicUserProfile(value): upsertPublicUser(value)
        case let .followedClassSection(value): followedClassSections[value.classSectionID] = value
        case let .classSection(value): upsertClassSection(value)
        case let .courseTask(value): upsertCourseTask(value)
        case let .taskProposal(value): upsertTaskProposal(value)
        case let .proposalVoteTotals(value): upsertVoteTotals(value)
        case let .accuracyVote(value): upsertAccuracyVote(value)
        case let .proposalRedirect(value): upsertProposalRedirect(value)
        case let .taskMerge(value): upsertTaskMerge(value)
        case let .personalTodo(value): upsertPersonalTodo(value)
        case let .personalTaskDetails(value): upsertPersonalTaskDetails(value)
        case let .personalTaskState(value): upsertPersonalTaskState(value)
        case let .taskComment(value): upsertTaskComment(value)
        case let .reporterContentReport(value): reporterReports[value.reportID] = value
        case let .contentTombstone(value): applyContentTombstone(value)
        }
    }

    public mutating func apply(_ event: SyncEvent) {
        guard processedEventIDs.insert(event.eventID).inserted else { return }
        switch event {
        case let .classSectionFollowed(value):
            followedClassSections[value.payload.classSectionID] = value.payload
        case let .classSectionUnfollowed(value):
            followedClassSections.removeValue(forKey: value.payload.classSectionID)
        case let .courseTaskCreated(value), let .courseTaskRestored(value):
            upsertCourseTask(value.payload)
        case let .courseTaskMerged(value):
            upsertTaskMerge(TaskMerge(
                sourceTaskID: value.payload.sourceTaskID,
                targetTaskID: value.payload.targetTaskID,
                reason: value.payload.reason,
                revision: value.payload.revision,
                createdAt: value.payload.createdAt
            ))
        case let .courseTaskHidden(value): applyContentTombstone(value.payload)
        case let .taskProposalCreated(value), let .taskProposalRestored(value):
            upsertTaskProposal(value.payload)
        case let .taskProposalHidden(value): applyContentTombstone(value.payload)
        case let .taskProposalRedirected(value): upsertProposalRedirect(value.payload)
        case let .proposalVoteTotalsUpdated(value): upsertVoteTotals(value.payload)
        case let .accuracyVoteUpdated(value): upsertAccuracyVote(value.payload)
        case let .personalTodoUpserted(value): upsertPersonalTodo(value.payload)
        case let .personalTodoDeleted(value): applyPersonalTodoDeletion(value.payload)
        case let .personalTaskDetailsUpserted(value): upsertPersonalTaskDetails(value.payload)
        case let .personalTaskDetailsDeleted(value): applyPersonalTaskDetailsDeletion(value.payload)
        case let .personalTaskStateUpserted(value): upsertPersonalTaskState(value.payload)
        case let .personalTaskStateDeleted(value): applyPersonalTaskStateDeletion(value.payload)
        case let .taskCommentUpserted(value), let .taskCommentRestored(value): upsertTaskComment(value.payload)
        case let .taskCommentDeleted(value), let .taskCommentHidden(value): applyContentTombstone(value.payload)
        case let .publicUserProfileUpdated(value): upsertPublicUser(value.payload)
        case let .publicUserDeleted(value): applyPublicUserDeletion(value.payload)
        case let .reporterContentReportUpdated(value): reporterReports[value.payload.reportID] = value.payload
        case let .maintainerContentReportUpdated(value): maintainerReports[value.payload.reportID] = value.payload
        case let .classSectionDeactivated(value): applyClassSectionDeactivation(value.payload)
        case let .catalogRevisionChanged(value): upsertCatalogRevision(value.payload)
        }
    }

    public func canonicalProposalID(for proposalID: UUIDv7) throws -> UUIDv7 {
        var current = proposalID
        var visited = Set<UUIDv7>()
        while let redirect = proposalRedirects[current] {
            guard visited.insert(current).inserted else { throw ProjectionResolutionError.redirectCycle }
            current = redirect.canonicalProposalID
        }
        guard visited.insert(current).inserted else { throw ProjectionResolutionError.redirectCycle }
        return current
    }

    public func canonicalTaskID(for taskID: UUIDv7) throws -> UUIDv7 {
        var current = taskID
        var visited = Set<UUIDv7>()
        while let merge = taskMerges[current] {
            guard visited.insert(current).inserted else { throw ProjectionResolutionError.taskMergeCycle }
            current = merge.targetTaskID
        }
        guard visited.insert(current).inserted else { throw ProjectionResolutionError.taskMergeCycle }
        return current
    }

    private mutating func upsertCatalogRevision(_ value: CatalogRevision) {
        if let current = catalogRevision, value.revision < current.revision { return }
        catalogRevision = value
    }

    private mutating func upsertPublicUser(_ value: PublicUserProfile) {
        guard value.revision >= (deletedUsers[value.id]?.revision ?? 0) else { return }
        if value.revision >= (publicUsers[value.id]?.revision ?? 0) {
            deletedUsers.removeValue(forKey: value.id)
            publicUsers[value.id] = value
        }
    }

    private mutating func upsertClassSection(_ value: ClassSectionRecord) {
        if value.revision >= (classSections[value.id]?.revision ?? 0) { classSections[value.id] = value }
    }

    private mutating func upsertCourseTask(_ value: CourseTask) {
        let key = ProjectionEntityKey(type: .courseTask, id: value.id)
        guard value.revision > (contentTombstones[key]?.revision ?? 0) else { return }
        if value.revision >= (courseTasks[value.id]?.revision ?? 0) {
            contentTombstones.removeValue(forKey: key)
            courseTasks[value.id] = value
        }
    }

    private mutating func upsertTaskProposal(_ value: TaskProposal) {
        let key = ProjectionEntityKey(type: .taskProposal, id: value.id)
        guard value.revision > (contentTombstones[key]?.revision ?? 0) else { return }
        if value.revision >= (taskProposals[value.id]?.revision ?? 0) {
            contentTombstones.removeValue(forKey: key)
            taskProposals[value.id] = value
        }
    }

    private mutating func upsertTaskComment(_ value: TaskComment) {
        let key = ProjectionEntityKey(type: .taskComment, id: value.id)
        guard value.revision > (contentTombstones[key]?.revision ?? 0) else { return }
        if value.revision >= (taskComments[value.id]?.revision ?? 0) {
            contentTombstones.removeValue(forKey: key)
            taskComments[value.id] = value
        }
    }

    private mutating func upsertVoteTotals(_ value: ProposalVoteTotals) {
        if value.revision >= (proposalVoteTotals[value.proposalID]?.revision ?? 0) {
            proposalVoteTotals[value.proposalID] = value
        }
    }

    private mutating func upsertAccuracyVote(_ value: AccuracyVote) {
        if value.revision >= (accuracyVotes[value.proposalID]?.revision ?? 0) {
            accuracyVotes[value.proposalID] = value
        }
    }

    private mutating func upsertProposalRedirect(_ value: ProposalRedirect) {
        if value.revision >= (proposalRedirects[value.sourceProposalID]?.revision ?? 0) {
            proposalRedirects[value.sourceProposalID] = value
        }
    }

    private mutating func upsertTaskMerge(_ value: TaskMerge) {
        if value.revision >= (taskMerges[value.sourceTaskID]?.revision ?? 0) {
            taskMerges[value.sourceTaskID] = value
        }
    }

    private mutating func upsertPersonalTodo(_ value: PersonalTodo) {
        if let deletedAt = value.deletedAt {
            applyPersonalTodoDeletion(.init(id: value.id, revision: value.revision, deletedAt: deletedAt))
            return
        }
        guard value.revision > (personalTodoDeletionRevisions[value.id] ?? 0) else { return }
        if value.revision >= (personalTodos[value.id]?.revision ?? 0) {
            personalTodoDeletionRevisions.removeValue(forKey: value.id)
            personalTodos[value.id] = value
        }
    }

    private mutating func upsertPersonalTaskDetails(_ value: PersonalTaskDetails) {
        guard value.revision > (personalTaskDetailsDeletionRevisions[value.courseTaskID] ?? 0) else { return }
        if value.revision >= (personalTaskDetails[value.courseTaskID]?.revision ?? 0) {
            personalTaskDetailsDeletionRevisions.removeValue(forKey: value.courseTaskID)
            personalTaskDetails[value.courseTaskID] = value
        }
    }

    private mutating func upsertPersonalTaskState(_ value: PersonalTaskState) {
        guard value.revision > (personalTaskStateDeletionRevisions[value.courseTaskID] ?? 0) else { return }
        if value.revision >= (personalTaskStates[value.courseTaskID]?.revision ?? 0) {
            personalTaskStateDeletionRevisions.removeValue(forKey: value.courseTaskID)
            personalTaskStates[value.courseTaskID] = value
        }
    }

    private mutating func applyContentTombstone(_ value: ContentTombstone) {
        let key = ProjectionEntityKey(type: value.entityType, id: value.entityID)
        guard value.revision >= (contentTombstones[key]?.revision ?? 0) else { return }
        contentTombstones[key] = value
        switch value.entityType {
        case .courseTask:
            if (courseTasks[value.entityID]?.revision ?? 0) <= value.revision { courseTasks.removeValue(forKey: value.entityID) }
        case .taskProposal:
            if (taskProposals[value.entityID]?.revision ?? 0) <= value.revision { taskProposals.removeValue(forKey: value.entityID) }
        case .taskComment:
            if (taskComments[value.entityID]?.revision ?? 0) <= value.revision { taskComments.removeValue(forKey: value.entityID) }
        }
    }

    private mutating func applyPersonalTodoDeletion(_ value: PersonalTodoDeletion) {
        guard value.revision >= (personalTodoDeletionRevisions[value.id] ?? 0) else { return }
        personalTodoDeletionRevisions[value.id] = value.revision
        if (personalTodos[value.id]?.revision ?? 0) <= value.revision { personalTodos.removeValue(forKey: value.id) }
    }

    private mutating func applyPersonalTaskDetailsDeletion(_ value: CourseTaskScopedDeletion) {
        guard value.revision >= (personalTaskDetailsDeletionRevisions[value.courseTaskID] ?? 0) else { return }
        personalTaskDetailsDeletionRevisions[value.courseTaskID] = value.revision
        if (personalTaskDetails[value.courseTaskID]?.revision ?? 0) <= value.revision {
            personalTaskDetails.removeValue(forKey: value.courseTaskID)
        }
    }

    private mutating func applyPersonalTaskStateDeletion(_ value: CourseTaskScopedDeletion) {
        guard value.revision >= (personalTaskStateDeletionRevisions[value.courseTaskID] ?? 0) else { return }
        personalTaskStateDeletionRevisions[value.courseTaskID] = value.revision
        if (personalTaskStates[value.courseTaskID]?.revision ?? 0) <= value.revision {
            personalTaskStates.removeValue(forKey: value.courseTaskID)
        }
    }

    private mutating func applyPublicUserDeletion(_ value: PublicUserDeletion) {
        guard value.revision >= (deletedUsers[value.id]?.revision ?? 0) else { return }
        deletedUsers[value.id] = value
        if (publicUsers[value.id]?.revision ?? 0) <= value.revision { publicUsers.removeValue(forKey: value.id) }
    }

    private mutating func applyClassSectionDeactivation(_ value: ClassSectionDeactivation) {
        guard let existing = classSections[value.id], value.revision >= existing.revision else { return }
        classSections[value.id] = ClassSectionRecord(
            id: existing.id,
            courseID: existing.courseID,
            externalSectionID: value.externalSectionID,
            sectionNumber: existing.sectionNumber,
            departmentCode: existing.departmentCode,
            departmentName: existing.departmentName,
            instructors: existing.instructors,
            campus: existing.campus,
            capacity: existing.capacity,
            scheduleText: existing.scheduleText,
            active: value.active,
            revision: value.revision,
            createdAt: existing.createdAt,
            updatedAt: value.updatedAt
        )
    }
}

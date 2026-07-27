public import Foundation

public extension ClientProjection {
    mutating func applyOptimistically(
        _ operation: StudentOperation,
        now: Date = Date(),
        currentUserID: UUIDv7? = nil
    ) {
        switch operation {
        case let .followClassSection(value):
            followedClassSections[value.payload.classSectionID] = FollowedClassSection(classSectionID: value.payload.classSectionID, followedAt: now)
        case let .unfollowClassSection(value):
            followedClassSections.removeValue(forKey: value.payload.classSectionID)
        case let .createPersonalTodo(value):
            apply(.personalTodo(PersonalTodo(
                id: value.payload.personalTodoID,
                classSectionID: value.payload.classSectionID,
                title: value.payload.title,
                deadline: value.payload.deadline,
                note: value.payload.note,
                state: value.payload.state,
                revision: 1,
                deletedAt: nil,
                createdAt: now,
                updatedAt: now
            )))
        case let .updatePersonalTodo(value):
            let existing = personalTodos[value.payload.personalTodoID]
            apply(.personalTodo(PersonalTodo(
                id: value.payload.personalTodoID,
                classSectionID: value.payload.classSectionID,
                title: value.payload.title,
                deadline: value.payload.deadline,
                note: value.payload.note,
                state: value.payload.state,
                revision: value.payload.expectedRevision + 1,
                deletedAt: nil,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now
            )))
        case let .deletePersonalTodo(value):
            personalTodos.removeValue(forKey: value.payload.personalTodoID)
            personalTodoDeletionRevisions[value.payload.personalTodoID] = value.payload.expectedRevision + 1
        case let .upsertPersonalTaskDetails(value):
            let existing = personalTaskDetails[value.payload.courseTaskID]
            apply(.personalTaskDetails(PersonalTaskDetails(
                courseTaskID: value.payload.courseTaskID,
                privateTitle: value.payload.privateTitle,
                privateDeadline: value.payload.privateDeadline,
                privateNote: value.payload.privateNote,
                revision: value.payload.expectedRevision + 1,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now
            )))
        case let .deletePersonalTaskDetails(value):
            personalTaskDetails.removeValue(forKey: value.payload.courseTaskID)
            personalTaskDetailsDeletionRevisions[value.payload.courseTaskID] = value.payload.expectedRevision + 1
        case let .setPersonalTaskState(value):
            let existing = personalTaskStates[value.payload.courseTaskID]
            apply(.personalTaskState(PersonalTaskState(
                courseTaskID: value.payload.courseTaskID,
                state: value.payload.state,
                revision: value.payload.expectedRevision + 1,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now
            )))
        case let .mergePersonalTodoIntoCourseTask(value):
            mergePersonalTodoOptimistically(
                personalTodoID: value.payload.personalTodoID,
                courseTaskID: value.payload.courseTaskID,
                expectedDetailsRevision: value.payload.expectedDetailsRevision,
                expectedStateRevision: value.payload.expectedStateRevision,
                now: now
            )
        case let .publishPersonalTodoAsCourseTask(value):
            mergePersonalTodoOptimistically(
                personalTodoID: value.payload.personalTodoID,
                courseTaskID: value.payload.courseTaskID,
                expectedDetailsRevision: 0,
                expectedStateRevision: 0,
                now: now
            )
            createSharedTask(
                taskID: value.payload.courseTaskID,
                sectionID: value.payload.classSectionID,
                proposalID: value.payload.proposalID,
                proposal: value.payload.proposal,
                authorID: currentUserID,
                now: now
            )
        case let .publishPersonalTaskDetailsAsProposal(value):
            createProposal(taskID: value.payload.courseTaskID, proposalID: value.payload.proposalID, proposal: value.payload.proposal, authorID: currentUserID, now: now)
        case let .createCourseTaskWithInitialProposal(value):
            createSharedTask(taskID: value.payload.courseTaskID, sectionID: value.payload.classSectionID, proposalID: value.payload.proposalID, proposal: value.payload.proposal, authorID: currentUserID, now: now)
        case let .createTaskProposal(value):
            createProposal(taskID: value.payload.courseTaskID, proposalID: value.payload.proposalID, proposal: value.payload.proposal, authorID: currentUserID, now: now)
        case let .setAccuracyVote(value):
            applyOptimisticVote(proposalID: value.payload.proposalID, value: value.payload.value, now: now)
        case let .createTaskComment(value):
            apply(.taskComment(TaskComment(
                id: value.payload.commentID,
                courseTaskID: value.payload.courseTaskID,
                authorID: currentUserID,
                body: value.payload.body,
                revision: 1,
                state: .visible,
                deletedAt: nil,
                createdAt: now,
                updatedAt: now
            )))
        case let .editTaskComment(value):
            guard let existing = taskComments[value.payload.commentID] else { break }
            apply(.taskComment(TaskComment(
                id: existing.id,
                courseTaskID: existing.courseTaskID,
                authorID: existing.authorID,
                body: value.payload.body,
                revision: value.payload.expectedRevision + 1,
                state: existing.state,
                deletedAt: nil,
                createdAt: existing.createdAt,
                updatedAt: now
            )))
        case let .deleteTaskComment(value):
            taskComments.removeValue(forKey: value.payload.commentID)
            contentTombstones[ProjectionEntityKey(type: .taskComment, id: value.payload.commentID)] = ContentTombstone(
                entityType: .taskComment,
                entityID: value.payload.commentID,
                state: .deleted,
                revision: value.payload.expectedRevision + 1,
                deletedAt: now
            )
        case let .createContentReport(value):
            reporterReports[value.payload.reportID] = ReporterContentReport(
                reportID: value.payload.reportID,
                targetType: value.payload.targetType,
                targetID: value.payload.targetID,
                reason: value.payload.reason,
                details: value.payload.details,
                status: .open,
                resolution: nil,
                createdAt: now,
                resolvedAt: nil
            )
        }
    }

    private mutating func mergePersonalTodoOptimistically(
        personalTodoID: UUIDv7,
        courseTaskID: UUIDv7,
        expectedDetailsRevision: Int,
        expectedStateRevision: Int,
        now: Date
    ) {
        guard let todo = personalTodos.removeValue(forKey: personalTodoID) else { return }
        apply(.personalTaskDetails(PersonalTaskDetails(
            courseTaskID: courseTaskID,
            privateTitle: todo.title,
            privateDeadline: todo.deadline,
            privateNote: todo.note,
            revision: expectedDetailsRevision + 1,
            createdAt: now,
            updatedAt: now
        )))
        apply(.personalTaskState(PersonalTaskState(
            courseTaskID: courseTaskID,
            state: todo.state,
            revision: expectedStateRevision + 1,
            createdAt: now,
            updatedAt: now
        )))
    }

    private mutating func createSharedTask(taskID: UUIDv7, sectionID: UUIDv7, proposalID: UUIDv7, proposal: CanonicalProposalPayload, authorID: UUIDv7?, now: Date) {
        apply(.courseTask(CourseTask(id: taskID, classSectionID: sectionID, createdBy: authorID, state: .visible, revision: 1, createdAt: now, updatedAt: now)))
        createProposal(taskID: taskID, proposalID: proposalID, proposal: proposal, authorID: authorID, now: now)
        apply(.proposalVoteTotals(.init(
            proposalID: proposalID,
            up: 1,
            down: 0,
            updatedAt: now,
            revision: 1
        )))
        apply(.accuracyVote(.init(
            proposalID: proposalID,
            value: .up,
            updatedAt: now,
            revision: 1
        )))
    }

    private mutating func createProposal(taskID: UUIDv7, proposalID: UUIDv7, proposal: CanonicalProposalPayload, authorID: UUIDv7?, now: Date) {
        apply(.taskProposal(TaskProposal(
            id: proposalID,
            courseTaskID: taskID,
            authorID: authorID,
            title: proposal.title,
            deadline: proposal.deadline,
            description: proposal.description,
            evidenceNote: proposal.evidenceNote,
            evidenceURL: proposal.evidenceURL,
            contentFingerprint: "pending:\(proposalID.uuidString)",
            state: .visible,
            revision: 1,
            createdAt: now
        )))
        apply(.proposalVoteTotals(.init(proposalID: proposalID, up: 0, down: 0, updatedAt: now, revision: 1)))
    }

    private mutating func applyOptimisticVote(proposalID: UUIDv7, value: AccuracyVoteValue, now: Date) {
        let previous = accuracyVotes[proposalID]?.value ?? .none
        var totals = proposalVoteTotals[proposalID] ?? ProposalVoteTotals(proposalID: proposalID, up: 0, down: 0, updatedAt: now, revision: 0)
        var up = totals.up
        var down = totals.down
        if previous == .up { up = max(0, up - 1) }
        if previous == .down { down = max(0, down - 1) }
        if value == .up { up += 1 }
        if value == .down { down += 1 }
        totals = ProposalVoteTotals(proposalID: proposalID, up: up, down: down, updatedAt: now, revision: totals.revision + 1)
        apply(.proposalVoteTotals(totals))
        let voteRevision = (accuracyVotes[proposalID]?.revision ?? 0) + 1
        apply(.accuracyVote(.init(proposalID: proposalID, value: value, updatedAt: now, revision: voteRevision)))
    }
}

import DDLTrackerCore
import Foundation

extension AppModel {
    func followClassSection(_ classSectionID: UUIDv7) async {
        guard projection.followedClassSections[classSectionID] == nil else { return }
        await enqueue(.followClassSection(.init(
            operationID: UUIDv7.generate(),
            payload: .init(classSectionID: classSectionID)
        )))
    }

    func unfollowClassSection(_ classSectionID: UUIDv7) async {
        guard projection.followedClassSections[classSectionID] != nil else { return }
        await enqueue(.unfollowClassSection(.init(
            operationID: UUIDv7.generate(),
            payload: .init(classSectionID: classSectionID)
        )))
    }

    func upsertPersonalTaskDetails(
        courseTaskID: UUIDv7,
        privateTitle: String?,
        privateDeadline: Date?,
        privateNote: String?
    ) async {
        let revision = projection.personalTaskDetails[courseTaskID]?.revision ?? 0
        await enqueue(.upsertPersonalTaskDetails(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                courseTaskID: courseTaskID,
                privateTitle: privateTitle,
                privateDeadline: privateDeadline,
                privateNote: privateNote,
                expectedRevision: revision
            )
        )))
    }

    func deletePersonalTaskDetails(courseTaskID: UUIDv7) async {
        guard let details = projection.personalTaskDetails[courseTaskID] else { return }
        await enqueue(.deletePersonalTaskDetails(.init(
            operationID: UUIDv7.generate(),
            payload: .init(courseTaskID: courseTaskID, expectedRevision: details.revision)
        )))
    }

    func createSharedTask(
        classSectionID: UUIDv7,
        title: String,
        deadline: Date,
        description: String?,
        evidenceNote: String?,
        evidenceURL: String?
    ) async {
        await enqueue(.createCourseTaskWithInitialProposal(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                courseTaskID: UUIDv7.generate(),
                classSectionID: classSectionID,
                proposalID: UUIDv7.generate(),
                proposal: .init(
                    title: title,
                    deadline: deadline,
                    description: description,
                    evidenceNote: evidenceNote,
                    evidenceURL: evidenceURL
                )
            )
        )))
    }

    func createTaskProposal(
        courseTaskID: UUIDv7,
        title: String,
        deadline: Date,
        description: String?,
        evidenceNote: String?,
        evidenceURL: String?
    ) async {
        await enqueue(.createTaskProposal(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                courseTaskID: courseTaskID,
                proposalID: UUIDv7.generate(),
                proposal: .init(
                    title: title,
                    deadline: deadline,
                    description: description,
                    evidenceNote: evidenceNote,
                    evidenceURL: evidenceURL
                )
            )
        )))
    }

    func setAccuracyVote(proposalID: UUIDv7, value: AccuracyVoteValue) async {
        await enqueue(.setAccuracyVote(.init(
            operationID: UUIDv7.generate(),
            payload: .init(proposalID: proposalID, value: value)
        )))
    }

    func createTaskComment(courseTaskID: UUIDv7, body: String) async {
        await enqueue(.createTaskComment(.init(
            operationID: UUIDv7.generate(),
            payload: .init(commentID: UUIDv7.generate(), courseTaskID: courseTaskID, body: body)
        )))
    }

    func editTaskComment(_ comment: TaskComment, body: String) async {
        await enqueue(.editTaskComment(.init(
            operationID: UUIDv7.generate(),
            payload: .init(commentID: comment.id, body: body, expectedRevision: comment.revision)
        )))
    }

    func deleteTaskComment(_ comment: TaskComment) async {
        await enqueue(.deleteTaskComment(.init(
            operationID: UUIDv7.generate(),
            payload: .init(commentID: comment.id, expectedRevision: comment.revision)
        )))
    }

    func createContentReport(
        targetType: ReportTargetType,
        targetID: UUIDv7,
        reason: ReportReason,
        details: String?
    ) async {
        await enqueue(.createContentReport(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                reportID: UUIDv7.generate(),
                targetType: targetType,
                targetID: targetID,
                reason: reason,
                details: details
            )
        )))
    }

    func publishPersonalTodo(_ todo: PersonalTodo) async {
        guard let classSectionID = todo.classSectionID, let deadline = todo.deadline else { return }
        await enqueue(.publishPersonalTodoAsCourseTask(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                personalTodoID: todo.id,
                expectedPersonalTodoRevision: todo.revision,
                courseTaskID: UUIDv7.generate(),
                classSectionID: classSectionID,
                proposalID: UUIDv7.generate(),
                proposal: .init(
                    title: todo.title,
                    deadline: deadline,
                    description: todo.note,
                    evidenceNote: nil,
                    evidenceURL: nil
                )
            )
        )))
    }

    func mergePersonalTodo(_ todo: PersonalTodo, into courseTaskID: UUIDv7) async {
        await enqueue(.mergePersonalTodoIntoCourseTask(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                personalTodoID: todo.id,
                courseTaskID: courseTaskID,
                expectedPersonalTodoRevision: todo.revision,
                expectedDetailsRevision: projection.personalTaskDetails[courseTaskID]?.revision ?? 0,
                expectedStateRevision: projection.personalTaskStates[courseTaskID]?.revision ?? 0
            )
        )))
    }

    func publishPersonalTaskDetails(_ details: PersonalTaskDetails) async {
        guard let title = details.privateTitle, let deadline = details.privateDeadline else { return }
        await enqueue(.publishPersonalTaskDetailsAsProposal(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                courseTaskID: details.courseTaskID,
                proposalID: UUIDv7.generate(),
                expectedDetailsRevision: details.revision,
                proposal: .init(
                    title: title,
                    deadline: deadline,
                    description: details.privateNote,
                    evidenceNote: nil,
                    evidenceURL: nil
                )
            )
        )))
    }

    func createPersonalTodo(
        title: String,
        deadline: Date?,
        note: String?,
        classSectionID: UUIDv7? = nil
    ) async {
        let operation = StudentOperation.createPersonalTodo(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                personalTodoID: UUIDv7.generate(),
                classSectionID: classSectionID,
                title: title,
                deadline: deadline,
                note: note,
                state: .pending
            )
        ))
        await enqueue(operation)
    }

    func updatePersonalTodo(
        _ todo: PersonalTodo,
        title: String,
        deadline: Date?,
        note: String?,
        state: TaskProgressState,
        classSectionID: UUIDv7?
    ) async {
        let operation = StudentOperation.updatePersonalTodo(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                personalTodoID: todo.id,
                classSectionID: classSectionID,
                title: title,
                deadline: deadline,
                note: note,
                state: state,
                expectedRevision: todo.revision
            )
        ))
        await enqueue(operation)
    }

    func deletePersonalTodo(_ todo: PersonalTodo) async {
        await enqueue(.deletePersonalTodo(.init(
            operationID: UUIDv7.generate(),
            payload: .init(personalTodoID: todo.id, expectedRevision: todo.revision)
        )))
    }

    func setTaskState(_ item: TaskListItem, state: TaskProgressState) async {
        if let todoID = item.personalTodoID, let todo = projection.personalTodos[todoID] {
            await updatePersonalTodo(
                todo,
                title: todo.title,
                deadline: todo.deadline,
                note: todo.note,
                state: state,
                classSectionID: todo.classSectionID
            )
            return
        }
        guard let taskID = item.courseTaskID else { return }
        let revision = projection.personalTaskStates[taskID]?.revision ?? 0
        await enqueue(.setPersonalTaskState(.init(
            operationID: UUIDv7.generate(),
            payload: .init(courseTaskID: taskID, state: state, expectedRevision: revision)
        )))
    }
}

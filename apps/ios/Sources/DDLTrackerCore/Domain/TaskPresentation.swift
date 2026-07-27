public import Foundation

public enum TaskListItemKind: String, Codable, Sendable {
    case shared
    case personal
}

public struct TaskListItem: Identifiable, Equatable, Sendable {
    public let id: UUIDv7
    public let kind: TaskListItemKind
    public let classSectionID: UUIDv7?
    public let courseTaskID: UUIDv7?
    public let personalTodoID: UUIDv7?
    public let canonicalProposalID: UUIDv7?
    public let title: String
    public let deadline: Date?
    public let note: String?
    public let state: TaskProgressState
    public let confidence: ProposalConfidence?
    public let hasSharedUpdate: Bool

    public init(id: UUIDv7, kind: TaskListItemKind, classSectionID: UUIDv7?, courseTaskID: UUIDv7?, personalTodoID: UUIDv7?, canonicalProposalID: UUIDv7?, title: String, deadline: Date?, note: String?, state: TaskProgressState, confidence: ProposalConfidence?, hasSharedUpdate: Bool = false) {
        self.id = id; self.kind = kind; self.classSectionID = classSectionID; self.courseTaskID = courseTaskID
        self.personalTodoID = personalTodoID; self.canonicalProposalID = canonicalProposalID; self.title = title
        self.deadline = deadline; self.note = note; self.state = state; self.confidence = confidence
        self.hasSharedUpdate = hasSharedUpdate
    }
}

public extension ClientProjection {
    func taskListItems() throws -> [TaskListItem] {
        var result: [TaskListItem] = []
        var presentedSharedTaskIDs = Set<UUIDv7>()
        for task in courseTasks.values where task.state == .visible {
            let proposals = taskProposals.values.filter {
                $0.courseTaskID == task.id && $0.state == .visible && proposalRedirects[$0.id] == nil
            }
            guard !proposals.isEmpty else { continue }
            let ranked = try ProposalRanker.rank(proposals.map { proposal in
                let totals = proposalVoteTotals[proposal.id]
                return ProposalRankingInput(
                    id: proposal.id,
                    up: totals?.up ?? 0,
                    down: totals?.down ?? 0,
                    createdAt: proposal.createdAt
                )
            })
            let leader = ranked.first
            let proposal = leader.flatMap { rankedValue in proposals.first { $0.id == rankedValue.id } }
            let overlay = personalTaskDetails[task.id]
            let personalState = personalTaskStates[task.id]
            let state = personalState?.state ?? .pending
            let confidence = leader.map { ProposalRanker.confidence(leader: $0, runnerUp: ranked.dropFirst().first) }
            let sharedUpdatedAt = [
                task.updatedAt,
                proposal?.createdAt,
                proposal.flatMap { proposalVoteTotals[$0.id]?.updatedAt },
            ].compactMap { $0 }.max() ?? task.updatedAt
            let hasSharedUpdate = state != .pending
                && personalState.map { sharedUpdatedAt > $0.updatedAt } == true
            presentedSharedTaskIDs.insert(task.id)
            result.append(TaskListItem(
                id: task.id,
                kind: .shared,
                classSectionID: task.classSectionID,
                courseTaskID: task.id,
                personalTodoID: nil,
                canonicalProposalID: proposal?.id,
                title: overlay?.privateTitle ?? proposal?.title ?? "未命名任务",
                deadline: overlay?.privateDeadline ?? proposal?.deadline,
                note: overlay?.privateNote ?? proposal?.description,
                state: state,
                confidence: confidence,
                hasSharedUpdate: hasSharedUpdate
            ))
        }
        let privateSharedTaskIDs = Set(personalTaskDetails.keys).union(personalTaskStates.keys)
        for taskID in privateSharedTaskIDs where !presentedSharedTaskIDs.contains(taskID) {
            let overlay = personalTaskDetails[taskID]
            result.append(TaskListItem(
                id: taskID,
                kind: .shared,
                classSectionID: courseTasks[taskID]?.classSectionID,
                courseTaskID: taskID,
                personalTodoID: nil,
                canonicalProposalID: nil,
                title: overlay?.privateTitle ?? "已隐藏的共享任务",
                deadline: overlay?.privateDeadline,
                note: overlay?.privateNote,
                state: personalTaskStates[taskID]?.state ?? .pending,
                confidence: nil
            ))
        }
        result.append(contentsOf: personalTodos.values.map { todo in
            TaskListItem(
                id: todo.id,
                kind: .personal,
                classSectionID: todo.classSectionID,
                courseTaskID: nil,
                personalTodoID: todo.id,
                canonicalProposalID: nil,
                title: todo.title,
                deadline: todo.deadline,
                note: todo.note,
                state: todo.state,
                confidence: nil
            )
        })
        return result.sorted { left, right in
            switch (left.deadline, right.deadline) {
            case let (leftDate?, rightDate?) where leftDate != rightDate: return leftDate < rightDate
            case (.some, .none): return true
            case (.none, .some): return false
            default: return left.id < right.id
            }
        }
    }
}

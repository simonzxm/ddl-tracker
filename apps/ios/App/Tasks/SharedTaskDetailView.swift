import DDLTrackerCore
import SwiftUI

struct SharedTaskDetailView: View {
    @Environment(AppModel.self) private var model
    let courseTaskID: UUIDv7
    @State private var showingPrivateEditor = false
    @State private var showingProposalEditor = false
    @State private var reportTarget: ReportTarget?
    @State private var editingComment: TaskComment?
    @State private var commentDraft = ""

    private var item: TaskListItem? {
        model.taskItems.first { $0.courseTaskID == courseTaskID }
    }

    private var comments: [TaskComment] {
        model.projection.taskComments.values
            .filter { $0.courseTaskID == courseTaskID && $0.state == .visible && $0.deletedAt == nil }
            .sorted { $0.createdAt < $1.createdAt }
    }

    private var rankedProposals: [(proposal: TaskProposal, ranking: RankedProposal)] {
        let proposals = model.projection.taskProposals.values.filter {
            $0.courseTaskID == courseTaskID
                && $0.state == .visible
                && model.projection.proposalRedirects[$0.id] == nil
        }
        let inputs = proposals.map { proposal in
            let totals = model.projection.proposalVoteTotals[proposal.id]
            return ProposalRankingInput(
                id: proposal.id,
                up: totals?.up ?? 0,
                down: totals?.down ?? 0,
                createdAt: proposal.createdAt
            )
        }
        let ranked = (try? ProposalRanker.rank(inputs)) ?? []
        return ranked.compactMap { ranking in
            proposals.first(where: { $0.id == ranking.id }).map { ($0, ranking) }
        }
    }

    var body: some View {
        List {
            taskSection
            privateDetailsSection
            proposalsSection
            commentsSection
        }
        .navigationTitle(item?.title ?? "共享任务")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            SyncToolbar()
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("举报共享任务", systemImage: "exclamationmark.bubble") {
                        reportTarget = ReportTarget(
                            id: courseTaskID,
                            type: .courseTask,
                            title: item?.title ?? "共享任务"
                        )
                    }
                } label: {
                    Label("更多", systemImage: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingPrivateEditor) {
            PrivateTaskDetailsEditor(
                courseTaskID: courseTaskID,
                current: model.projection.personalTaskDetails[courseTaskID]
            )
        }
        .sheet(isPresented: $showingProposalEditor) {
            ProposalEditor(courseTaskID: courseTaskID)
        }
        .sheet(item: $reportTarget) { target in
            ReportEditor(target: target)
        }
        .sheet(item: $editingComment) { comment in
            CommentEditor(comment: comment)
        }
    }

    @ViewBuilder
    private var taskSection: some View {
        if let item {
            Section {
                TaskRow(item: item)
                Picker("状态", selection: Binding(
                    get: { item.state },
                    set: { state in Task { await model.setTaskState(item, state: state) } }
                )) {
                    Text("待完成").tag(TaskProgressState.pending)
                    Text("已完成").tag(TaskProgressState.completed)
                    Text("已忽略").tag(TaskProgressState.ignored)
                }
            }
        }
    }

    private var privateDetailsSection: some View {
        Section {
            if let details = model.projection.personalTaskDetails[courseTaskID] {
                if let title = details.privateTitle { LabeledContent("标题", value: title) }
                if let deadline = details.privateDeadline {
                    LabeledContent("截止", value: AcademicTime.dateTime(deadline))
                }
                if let note = details.privateNote { Text(note).foregroundStyle(.secondary) }
            } else {
                Text("未设置私人覆盖")
                    .foregroundStyle(.secondary)
            }
            Button("编辑私人覆盖") { showingPrivateEditor = true }
        } header: {
            Label("只对我可见", systemImage: "lock")
        }
    }

    private var proposalsSection: some View {
        Section {
            if rankedProposals.isEmpty {
                Text("暂无提案")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(rankedProposals.enumerated()), id: \.element.proposal.id) { index, entry in
                    ProposalRow(
                        proposal: entry.proposal,
                        ranking: entry.ranking,
                        isLeading: index == 0
                    ) {
                        reportTarget = ReportTarget(
                            id: entry.proposal.id,
                            type: .proposal,
                            title: entry.proposal.title
                        )
                    }
                }
            }
            Button("提出不同信息") { showingProposalEditor = true }
        } header: {
            Label("共享信息", systemImage: "person.2")
        } footer: {
            Text("共享展示采用 Wilson 置信下界排名；同分时按票数、创建时间和 ID 稳定排序。")
        }
    }

    private var commentsSection: some View {
        Section {
            if comments.isEmpty {
                Text("暂无评论")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(comments) { comment in
                    CommentRow(
                        comment: comment,
                        canEdit: comment.authorID == model.currentUser?.id,
                        onEdit: { editingComment = comment },
                        onDelete: { Task { await model.deleteTaskComment(comment) } },
                        onReport: {
                            reportTarget = ReportTarget(id: comment.id, type: .comment, title: comment.body)
                        }
                    )
                }
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("添加评论", text: $commentDraft, axis: .vertical)
                    .lineLimit(1 ... 5)
                Button(action: sendComment) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(cleanComment.isEmpty)
                .accessibilityLabel("发送评论")
            }
        } header: {
            Label("讨论", systemImage: "bubble.left.and.bubble.right")
        }
    }

    private var cleanComment: String {
        commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func sendComment() {
        let body = cleanComment
        guard !body.isEmpty else { return }
        commentDraft = ""
        Task { await model.createTaskComment(courseTaskID: courseTaskID, body: body) }
    }
}

private struct ProposalRow: View {
    @Environment(AppModel.self) private var model
    let proposal: TaskProposal
    let ranking: RankedProposal
    let isLeading: Bool
    let onReport: () -> Void

    private var totals: ProposalVoteTotals? {
        model.projection.proposalVoteTotals[proposal.id]
    }

    private var ownVote: AccuracyVoteValue {
        model.projection.accuracyVotes[proposal.id]?.value ?? .none
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(proposal.title)
                    .font(.headline)
                Spacer()
                if isLeading {
                    Text("当前展示")
                        .font(.caption.bold())
                        .foregroundStyle(.tint)
                }
            }
            Label(AcademicTime.dateTime(proposal.deadline), systemImage: "calendar")
                .font(.subheadline)
            if let description = proposal.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let evidenceNote = proposal.evidenceNote, !evidenceNote.isEmpty {
                Label(evidenceNote, systemImage: "checkmark.seal")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let evidenceURL = proposal.evidenceURL, let url = URL(string: evidenceURL) {
                Link(destination: url) {
                    Label("查看依据", systemImage: "arrow.up.right.square")
                        .font(.caption)
                }
            }
            HStack(spacing: 10) {
                VoteButton(title: String(totals?.up ?? 0), symbol: "hand.thumbsup", selected: ownVote == .up) {
                    Task {
                        await model.setAccuracyVote(
                            proposalID: proposal.id,
                            value: ownVote == .up ? .none : .up
                        )
                    }
                }
                VoteButton(title: String(totals?.down ?? 0), symbol: "hand.thumbsdown", selected: ownVote == .down) {
                    Task {
                        await model.setAccuracyVote(
                            proposalID: proposal.id,
                            value: ownVote == .down ? .none : .down
                        )
                    }
                }
                Spacer()
                Text("得分 \(ranking.score, format: .number.precision(.fractionLength(3)))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                Menu {
                    Button("举报提案", systemImage: "exclamationmark.bubble", action: onReport)
                } label: {
                    Image(systemName: "ellipsis")
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct CommentRow: View {
    @Environment(AppModel.self) private var model
    let comment: TaskComment
    let canEdit: Bool
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onReport: () -> Void

    private var authorName: String {
        guard let authorID = comment.authorID else { return "已删除用户" }
        return model.projection.publicUsers[authorID]?.displayName ?? "同学"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(authorName)
                    .font(.subheadline.bold())
                Spacer()
                Text(comment.createdAt, style: .relative)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Menu {
                    NavigationLink("查看历史") {
                        CommentHistoryView(commentID: comment.id)
                    }
                    if canEdit {
                        Button("编辑", action: onEdit)
                        Button("删除", role: .destructive, action: onDelete)
                    } else {
                        Button("举报", systemImage: "exclamationmark.bubble", action: onReport)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
            }
            Text(comment.body)
        }
        .padding(.vertical, 3)
    }
}

private struct VoteButton: View {
    let title: String
    let symbol: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: selected ? "\(symbol).fill" : symbol)
        }
        .buttonStyle(.bordered)
        .tint(selected ? .accentColor : .secondary)
        .accessibilityValue(selected ? "已选择" : "未选择")
    }
}

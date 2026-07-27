import DDLTrackerCore
import SwiftUI

struct SharedTaskDetailView: View {
    @Environment(AppModel.self) private var model
    let courseTaskID: UUIDv7
    @State private var showingPrivateEditor = false
    @State private var showingProposalEditor = false

    private var item: TaskListItem? {
        model.taskItems.first { $0.courseTaskID == courseTaskID }
    }

    private var rankedProposals: [(proposal: TaskProposal, ranking: RankedProposal)] {
        let proposals = model.projection.taskProposals.values.filter {
            $0.courseTaskID == courseTaskID && $0.state == .visible && model.projection.proposalRedirects[$0.id] == nil
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

            Section {
                if let details = model.projection.personalTaskDetails[courseTaskID] {
                    if let title = details.privateTitle { LabeledContent("标题", value: title) }
                    if let deadline = details.privateDeadline {
                        LabeledContent("截止", value: deadline.formatted(date: .abbreviated, time: .shortened))
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
                        )
                    }
                }
                Button("提出不同信息") { showingProposalEditor = true }
            } header: {
                Label("共享信息", systemImage: "person.2")
            } footer: {
                Text("共享展示采用 Wilson 置信下界排名；同分时按票数、创建时间和 ID 稳定排序。")
            }
        }
        .navigationTitle(item?.title ?? "共享任务")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { SyncToolbar() }
        .sheet(isPresented: $showingPrivateEditor) {
            PrivateTaskDetailsEditor(
                courseTaskID: courseTaskID,
                current: model.projection.personalTaskDetails[courseTaskID]
            )
        }
        .sheet(isPresented: $showingProposalEditor) {
            ProposalEditor(courseTaskID: courseTaskID)
        }
    }
}

private struct ProposalRow: View {
    @Environment(AppModel.self) private var model
    let proposal: TaskProposal
    let ranking: RankedProposal
    let isLeading: Bool

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
            Label(proposal.deadline.formatted(date: .abbreviated, time: .shortened), systemImage: "calendar")
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
                VoteButton(
                    title: String(totals?.up ?? 0),
                    symbol: "hand.thumbsup",
                    selected: ownVote == .up
                ) {
                    Task { await model.setAccuracyVote(proposalID: proposal.id, value: ownVote == .up ? .none : .up) }
                }
                VoteButton(
                    title: String(totals?.down ?? 0),
                    symbol: "hand.thumbsdown",
                    selected: ownVote == .down
                ) {
                    Task { await model.setAccuracyVote(proposalID: proposal.id, value: ownVote == .down ? .none : .down) }
                }
                Spacer()
                Text("得分 \(ranking.score, format: .number.precision(.fractionLength(3)))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
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

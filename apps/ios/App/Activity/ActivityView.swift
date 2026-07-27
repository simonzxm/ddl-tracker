import DDLTrackerCore
import SwiftUI

struct ActivityView: View {
    @Environment(AppModel.self) private var model

    private var pendingCount: Int {
        model.outbox.count { $0.status == .pending }
    }

    private var rejectedCount: Int {
        model.outbox.count { $0.status == .rejected }
    }

    var body: some View {
        List {
            statusSection
            operationsSection
        }
        .navigationTitle("同步")
        .refreshable { await model.synchronize() }
        .toolbar { SyncToolbar() }
    }

    private var statusSection: some View {
        Section("状态") {
            LabeledContent("连接") {
                ConnectivityLabel(connectivity: model.connectivity)
            }
            LabeledContent("待提交", value: String(pendingCount))
            LabeledContent("需要处理", value: String(rejectedCount))
        }
    }

    @ViewBuilder
    private var operationsSection: some View {
        if model.outbox.isEmpty {
            Section {
                ContentUnavailableView("已全部同步", systemImage: "checkmark.icloud")
                    .listRowBackground(Color.clear)
            }
        } else {
            Section("操作") {
                ForEach(model.outbox, id: \.operation.operationID) { record in
                    OutboxRow(record: record)
                }
            }
        }
    }
}

private struct ConnectivityLabel: View {
    let connectivity: AppModel.Connectivity

    var body: some View {
        switch connectivity {
        case .online:
            Label("在线", systemImage: "wifi")
        case .offline:
            Label("离线", systemImage: "wifi.slash")
        case .unknown:
            Text("未知")
        }
    }
}

private struct OutboxRow: View {
    let record: OutboxRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(record.operation.type.displayName)
            Text(detail)
                .font(.caption)
                .foregroundStyle(record.status == .pending ? Color.secondary : Color.red)
        }
    }

    private var detail: String {
        if record.status == .pending { return "等待同步" }
        return record.error?.message ?? "同步失败"
    }
}

private extension StudentOperationType {
    var displayName: String {
        switch self {
        case .followClassSection: "关注教学班"
        case .unfollowClassSection: "取消关注"
        case .createPersonalTodo: "创建个人待办"
        case .updatePersonalTodo: "更新个人待办"
        case .deletePersonalTodo: "删除个人待办"
        case .upsertPersonalTaskDetails: "更新私人覆盖"
        case .deletePersonalTaskDetails: "清除私人覆盖"
        case .setPersonalTaskState: "更新任务状态"
        case .mergePersonalTodoIntoCourseTask: "关联共享任务"
        case .publishPersonalTodoAsCourseTask: "发布共享任务"
        case .publishPersonalTaskDetailsAsProposal: "发布任务提案"
        case .createCourseTaskWithInitialProposal: "创建共享任务"
        case .createTaskProposal: "创建提案"
        case .setAccuracyVote: "更新准确性投票"
        case .createTaskComment: "发表评论"
        case .editTaskComment: "编辑评论"
        case .deleteTaskComment: "删除评论"
        case .createContentReport: "提交举报"
        }
    }
}

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

    private var reports: [ReporterContentReport] {
        model.projection.reporterReports.values.sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        List {
            statusSection
            operationsSection
            reportsSection
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
            if let lastSyncedAt = model.lastSyncedAt {
                LabeledContent("上次同步", value: lastSyncedAt.formatted(.relative(presentation: .named)))
            }
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
            Section {
                ForEach(model.outbox, id: \.operation.operationID) { record in
                    OutboxRow(record: record)
                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                            if record.status == .rejected {
                                Button("重试") {
                                    Task { await model.retry(record.operation.operationID) }
                                }
                                .tint(.blue)
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("丢弃", role: .destructive) {
                                Task { await model.discard(record.operation.operationID) }
                            }
                        }
                        .contextMenu {
                            if record.status == .rejected {
                                Button("重试", systemImage: "arrow.clockwise") {
                                    Task { await model.retry(record.operation.operationID) }
                                }
                            }
                            Button("丢弃操作", systemImage: "trash", role: .destructive) {
                                Task { await model.discard(record.operation.operationID) }
                            }
                        }
                }
            } header: {
                Text("操作")
            } footer: {
                Text("被拒绝的操作不会自动重试。可根据服务器返回的原因修改后重试，或丢弃本地操作。")
            }
        }
    }

    @ViewBuilder
    private var reportsSection: some View {
        if !reports.isEmpty {
            Section("我的举报") {
                ForEach(reports) { report in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Label(report.targetType.displayName, systemImage: "exclamationmark.bubble")
                                .font(.headline)
                            Spacer()
                            Text(report.status.displayName)
                                .font(.caption.bold())
                                .foregroundStyle(report.status == .open ? .orange : .secondary)
                        }
                        Text(report.reason.displayName)
                            .font(.subheadline)
                        if let details = report.details, !details.isEmpty {
                            Text(details)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                        if let resolution = report.resolution, !resolution.isEmpty {
                            Text("处理结果：\(resolution)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 3)
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
            HStack {
                Text(record.operation.type.displayName)
                    .font(.headline)
                Spacer()
                if record.status == .pending {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
            }
            Text(detail)
                .font(.caption)
                .foregroundStyle(record.status == .pending ? Color.secondary : Color.red)
            if record.attemptCount > 0 {
                Text("已尝试 \(record.attemptCount) 次")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
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

private extension ReportTargetType {
    var displayName: String {
        switch self {
        case .courseTask: "共享任务"
        case .proposal: "提案"
        case .comment: "评论"
        case .user: "用户"
        }
    }
}

private extension ReportStatus {
    var displayName: String {
        switch self {
        case .open: "处理中"
        case .resolved: "已处理"
        case .dismissed: "已驳回"
        }
    }
}

private extension ReportReason {
    var displayName: String {
        switch self {
        case .inaccurate: "信息不准确"
        case .spam: "垃圾内容"
        case .abuse: "辱骂或骚扰"
        case .privacy: "隐私问题"
        case .other: "其他"
        }
    }
}

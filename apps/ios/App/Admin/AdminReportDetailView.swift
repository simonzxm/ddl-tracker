import DDLTrackerCore
import SwiftUI

struct AdminReportDetailView: View {
    @Environment(AppModel.self) private var model
    let report: AdminReport
    let onChanged: @MainActor () async -> Void

    @State private var action: ReportAction?
    @State private var isWorking = false

    var body: some View {
        List {
            Section("举报") {
                LabeledContent("状态", value: report.status.adminDisplayName)
                LabeledContent("原因", value: report.reason.adminDisplayName)
                LabeledContent("类型", value: report.targetType.adminDisplayName)
                if let details = report.details, !details.isEmpty {
                    Text(details)
                }
                LabeledContent("提交时间", value: report.createdAt.formatted(date: .abbreviated, time: .shortened))
            }

            Section("标识符") {
                CopyableIdentifierRow(title: "举报", value: report.id.uuidString)
                CopyableIdentifierRow(title: "举报人", value: report.reporterID.uuidString)
                CopyableIdentifierRow(title: "目标", value: report.targetID.uuidString)
            }

            if let resolution = report.resolution {
                Section("处理结果") {
                    Text(resolution)
                    if let resolvedAt = report.resolvedAt {
                        LabeledContent("处理时间", value: resolvedAt.formatted(date: .abbreviated, time: .shortened))
                    }
                    if let resolvedBy = report.resolvedBy {
                        CopyableIdentifierRow(title: "处理人", value: resolvedBy.uuidString)
                    }
                }
            }

            if report.status == .open {
                Section("目标处置") {
                    switch report.targetType {
                    case .courseTask, .proposal, .comment:
                        Button("隐藏内容", systemImage: "eye.slash", role: .destructive) {
                            action = .hideContent
                        }
                        Button("恢复内容", systemImage: "eye") {
                            action = .restoreContent
                        }
                    case .user:
                        Button("停用用户", systemImage: "person.crop.circle.badge.xmark", role: .destructive) {
                            action = .suspendUser
                        }
                        Button("恢复用户", systemImage: "person.crop.circle.badge.checkmark") {
                            action = .restoreUser
                        }
                    }
                }

                Section("关闭举报") {
                    Button("标记为已解决", systemImage: "checkmark.circle") {
                        action = .resolve
                    }
                    Button("驳回举报", systemImage: "xmark.circle") {
                        action = .dismiss
                    }
                }
            }
        }
        .navigationTitle("举报详情")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(isWorking)
        .overlay {
            if isWorking {
                ProgressView()
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .sheet(item: $action) { selected in
            AdminReasonSheet(
                title: selected.title,
                prompt: selected.prompt,
                destructive: selected.destructive
            ) { reason in
                await perform(selected, reason: reason)
            }
        }
    }

    @MainActor
    private func perform(_ selected: ReportAction, reason: String) async -> Bool {
        isWorking = true
        defer { isWorking = false }
        do {
            switch selected {
            case .resolve:
                _ = try await model.api.resolveReport(id: report.id, status: .resolved, resolution: reason)
            case .dismiss:
                _ = try await model.api.resolveReport(id: report.id, status: .dismissed, resolution: reason)
            case .hideContent, .restoreContent:
                guard let type = report.targetType.adminContentType else { return false }
                _ = try await model.api.setContentHidden(
                    id: report.targetID,
                    targetType: type,
                    hidden: selected == .hideContent,
                    reason: reason
                )
            case .suspendUser, .restoreUser:
                _ = try await model.api.setUserSuspended(
                    id: report.targetID,
                    suspended: selected == .suspendUser,
                    reason: reason
                )
            }
            await onChanged()
            return true
        } catch {
            model.alertMessage = adminErrorMessage(error)
            return false
        }
    }
}

private enum ReportAction: String, Identifiable {
    case resolve
    case dismiss
    case hideContent
    case restoreContent
    case suspendUser
    case restoreUser

    var id: String { rawValue }

    var title: String {
        switch self {
        case .resolve: "解决举报"
        case .dismiss: "驳回举报"
        case .hideContent: "隐藏内容"
        case .restoreContent: "恢复内容"
        case .suspendUser: "停用用户"
        case .restoreUser: "恢复用户"
        }
    }

    var prompt: String {
        switch self {
        case .resolve, .dismiss: "填写会向举报人展示的处理说明。"
        default: "填写本次管理操作的原因；该内容会写入审计记录。"
        }
    }

    var destructive: Bool {
        switch self {
        case .dismiss, .hideContent, .suspendUser: true
        default: false
        }
    }
}

struct AdminReasonSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let prompt: String
    let destructive: Bool
    let action: @MainActor (String) async -> Bool

    @State private var reason = ""
    @State private var isWorking = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("原因", text: $reason, axis: .vertical)
                        .lineLimit(3 ... 8)
                        .focused($focused)
                } footer: {
                    Text(prompt)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(destructive ? "确认" : "完成", role: destructive ? .destructive : nil) {
                        Task {
                            isWorking = true
                            if await action(cleanReason) { dismiss() }
                            isWorking = false
                        }
                    }
                    .disabled(cleanReason.isEmpty || isWorking)
                }
            }
            .onAppear { focused = true }
        }
    }

    private var cleanReason: String {
        reason.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct CopyableIdentifierRow: View {
    let title: String
    let value: String

    var body: some View {
        LabeledContent(title) {
            Text(value)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .lineLimit(1)
        }
    }
}

private extension ReportTargetType {
    var adminContentType: AdminContentTargetType? {
        switch self {
        case .courseTask: .courseTask
        case .proposal: .proposal
        case .comment: .comment
        case .user: nil
        }
    }
}

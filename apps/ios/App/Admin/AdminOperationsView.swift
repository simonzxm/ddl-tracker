import DDLTrackerCore
import SwiftUI

struct AdminOperationsView: View {
    var body: some View {
        List {
            Section("内容") {
                NavigationLink {
                    AdminContentOperationView()
                } label: {
                    Label("隐藏或恢复内容", systemImage: "eye.slash")
                }

                NavigationLink {
                    AdminTaskMergeView()
                } label: {
                    Label("合并共享任务", systemImage: "arrow.triangle.merge")
                }
            }

            Section("账户") {
                NavigationLink {
                    AdminUserStateView()
                } label: {
                    Label("停用或恢复用户", systemImage: "person.crop.circle.badge.xmark")
                }

                NavigationLink {
                    AdminRoleView()
                } label: {
                    Label("维护者角色", systemImage: "person.badge.shield.checkmark")
                }
            }

            Section("初始化") {
                NavigationLink {
                    AdminBootstrapView()
                } label: {
                    Label("首次维护者引导", systemImage: "key")
                }
            }
        }
        .navigationTitle("管理操作")
    }
}

private struct AdminContentOperationView: View {
    @Environment(AppModel.self) private var model
    @State private var targetID = ""
    @State private var targetType: AdminContentTargetType = .courseTask
    @State private var hidden = true
    @State private var reason = ""
    @State private var isWorking = false
    @State private var success: String?

    var body: some View {
        AdminActionForm(
            title: "内容状态",
            isWorking: isWorking,
            isValid: parsedID != nil && !cleanReason.isEmpty,
            destructive: hidden,
            actionTitle: hidden ? "隐藏内容" : "恢复内容",
            success: $success
        ) {
            Section("目标") {
                TextField("内容 UUID", text: $targetID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                Picker("内容类型", selection: $targetType) {
                    Text("共享任务").tag(AdminContentTargetType.courseTask)
                    Text("提案").tag(AdminContentTargetType.proposal)
                    Text("评论").tag(AdminContentTargetType.comment)
                }
                Toggle("隐藏", isOn: $hidden)
            }
            AdminReasonField(reason: $reason)
        } perform: {
            guard let id = parsedID else { return }
            isWorking = true
            defer { isWorking = false }
            do {
                let result = try await model.api.setContentHidden(
                    id: id,
                    targetType: targetType,
                    hidden: hidden,
                    reason: cleanReason
                )
                success = result.changed ? "内容状态已更新。" : "内容已经处于目标状态。"
            } catch {
                model.alertMessage = adminErrorMessage(error)
            }
        }
    }

    private var parsedID: UUIDv7? { UUIDv7(targetID.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var cleanReason: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
}

private struct AdminUserStateView: View {
    @Environment(AppModel.self) private var model
    @State private var userID = ""
    @State private var suspended = true
    @State private var reason = ""
    @State private var isWorking = false
    @State private var success: String?

    var body: some View {
        AdminActionForm(
            title: "用户状态",
            isWorking: isWorking,
            isValid: parsedID != nil && !cleanReason.isEmpty,
            destructive: suspended,
            actionTitle: suspended ? "停用用户" : "恢复用户",
            success: $success
        ) {
            Section("账户") {
                TextField("用户 UUID", text: $userID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                Toggle("停用", isOn: $suspended)
            }
            AdminReasonField(reason: $reason)
        } perform: {
            guard let id = parsedID else { return }
            isWorking = true
            defer { isWorking = false }
            do {
                _ = try await model.api.setUserSuspended(id: id, suspended: suspended, reason: cleanReason)
                success = suspended ? "用户已停用。" : "用户已恢复。"
            } catch {
                model.alertMessage = adminErrorMessage(error)
            }
        }
    }

    private var parsedID: UUIDv7? { UUIDv7(userID.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var cleanReason: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
}

private struct AdminRoleView: View {
    @Environment(AppModel.self) private var model
    @State private var userID = ""
    @State private var maintainer = true
    @State private var reason = ""
    @State private var isWorking = false
    @State private var success: String?

    var body: some View {
        AdminActionForm(
            title: "维护者角色",
            isWorking: isWorking,
            isValid: parsedID != nil && !cleanReason.isEmpty,
            destructive: !maintainer,
            actionTitle: maintainer ? "授予角色" : "移除角色",
            success: $success
        ) {
            Section("账户") {
                TextField("用户 UUID", text: $userID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                Toggle("维护者", isOn: $maintainer)
            }
            AdminReasonField(reason: $reason)
        } perform: {
            guard let id = parsedID else { return }
            isWorking = true
            defer { isWorking = false }
            do {
                _ = try await model.api.setMaintainerRole(id: id, maintainer: maintainer, reason: cleanReason)
                success = maintainer ? "维护者角色已授予。" : "维护者角色已移除。"
            } catch {
                model.alertMessage = adminErrorMessage(error)
            }
        }
    }

    private var parsedID: UUIDv7? { UUIDv7(userID.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var cleanReason: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
}

private struct AdminTaskMergeView: View {
    @Environment(AppModel.self) private var model
    @State private var sourceID = ""
    @State private var targetID = ""
    @State private var reason = ""
    @State private var isWorking = false
    @State private var success: String?

    var body: some View {
        AdminActionForm(
            title: "合并共享任务",
            isWorking: isWorking,
            isValid: source != nil && target != nil && source != target && !cleanReason.isEmpty,
            destructive: true,
            actionTitle: "合并任务",
            success: $success
        ) {
            Section("任务") {
                TextField("来源任务 UUID", text: $sourceID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                TextField("目标任务 UUID", text: $targetID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
            }
            AdminReasonField(reason: $reason)
        } perform: {
            guard let source, let target else { return }
            isWorking = true
            defer { isWorking = false }
            do {
                _ = try await model.api.mergeTask(sourceID: source, targetID: target, reason: cleanReason)
                success = "来源任务已重定向到目标任务。"
            } catch {
                model.alertMessage = adminErrorMessage(error)
            }
        }
    }

    private var source: UUIDv7? { UUIDv7(sourceID.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var target: UUIDv7? { UUIDv7(targetID.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var cleanReason: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
}

private struct AdminBootstrapView: View {
    @Environment(AppModel.self) private var model
    @State private var token = ""
    @State private var isWorking = false
    @State private var success: String?

    var body: some View {
        AdminActionForm(
            title: "首次维护者引导",
            isWorking: isWorking,
            isValid: !cleanToken.isEmpty,
            destructive: false,
            actionTitle: "执行引导",
            success: $success
        ) {
            Section {
                SecureField("引导令牌", text: $token)
                    .textContentType(.password)
            } header: {
                Text("引导令牌")
            } footer: {
                Text("仅在服务尚未建立首位维护者时使用。完成后服务端会永久关闭该入口。")
            }
        } perform: {
            isWorking = true
            defer { isWorking = false }
            do {
                _ = try await model.api.bootstrapMaintainer(token: cleanToken)
                success = "维护者引导已完成。"
                await model.refreshCurrentUser()
            } catch {
                model.alertMessage = adminErrorMessage(error)
            }
        }
    }

    private var cleanToken: String { token.trimmingCharacters(in: .whitespacesAndNewlines) }
}

private struct AdminReasonField: View {
    @Binding var reason: String

    var body: some View {
        Section {
            TextField("原因", text: $reason, axis: .vertical)
                .lineLimit(3 ... 8)
        } header: {
            Text("审计原因")
        } footer: {
            Text("服务端会把原因、操作者与请求 ID 一并写入审计记录。")
        }
    }
}

private struct AdminActionForm<Content: View>: View {
    let title: String
    let isWorking: Bool
    let isValid: Bool
    let destructive: Bool
    let actionTitle: String
    @Binding var success: String?
    @ViewBuilder let content: Content
    let perform: @MainActor () async -> Void

    init(
        title: String,
        isWorking: Bool,
        isValid: Bool,
        destructive: Bool,
        actionTitle: String,
        success: Binding<String?>,
        @ViewBuilder content: () -> Content,
        perform: @escaping @MainActor () async -> Void
    ) {
        self.title = title
        self.isWorking = isWorking
        self.isValid = isValid
        self.destructive = destructive
        self.actionTitle = actionTitle
        _success = success
        self.content = content()
        self.perform = perform
    }

    var body: some View {
        Form {
            content
            Section {
                Button(actionTitle, role: destructive ? .destructive : nil) {
                    Task { await perform() }
                }
                .disabled(!isValid || isWorking)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isWorking { ProgressView() }
        }
        .alert("操作完成", isPresented: Binding(
            get: { success != nil },
            set: { if !$0 { success = nil } }
        )) {
            Button("好") { success = nil }
        } message: {
            Text(success ?? "")
        }
    }
}

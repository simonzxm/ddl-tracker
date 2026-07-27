import DDLTrackerCore
import SwiftUI

struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmingSignOut = false
    @State private var confirmingDeletion = false
    @State private var deletionError: String?

    var body: some View {
        List {
            if let user = model.currentUser {
                ProfileHeaderSection(user: user)
            }
            securitySection
            accountSection
            AboutSection()
        }
        .navigationTitle("我的")
        .toolbar { SyncToolbar() }
        .confirmationDialog("退出当前设备？", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) {
                Task { await model.signOut() }
            }
            Button("取消", role: .cancel) {}
        }
        .confirmationDialog("永久删除账户？", isPresented: $confirmingDeletion, titleVisibility: .visible) {
            Button("删除账户", role: .destructive) {
                Task { await deleteAccount() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("账户删除后无法恢复。")
        }
        .alert("无法删除账户", isPresented: Binding(
            get: { deletionError != nil },
            set: { if !$0 { deletionError = nil } }
        )) {
            Button("好") { deletionError = nil }
        } message: {
            Text(deletionError ?? "")
        }
    }

    private var securitySection: some View {
        Section("安全") {
            NavigationLink {
                SessionsView()
            } label: {
                Label("登录设备", systemImage: "iphone.and.arrow.forward")
            }
            Button {
                confirmingSignOut = true
            } label: {
                Label("退出当前设备", systemImage: "rectangle.portrait.and.arrow.right")
            }
        }
    }

    private var accountSection: some View {
        Section {
            LabeledContent("本地待同步操作", value: String(model.outbox.count))
            Button("删除账户", role: .destructive) {
                confirmingDeletion = true
            }
        } header: {
            Text("数据与账户")
        } footer: {
            Text("删除账户会撤销所有 session，并按照服务端策略处理你的数据。此操作不可撤销。")
        }
    }

    private func deleteAccount() async {
        do {
            try await model.deleteAccount()
        } catch {
            deletionError = error.localizedDescription
        }
    }
}

private struct ProfileHeaderSection: View {
    let user: CurrentUser

    var body: some View {
        Section {
            HStack(spacing: 14) {
                ProfileAvatar(urlString: user.avatarURL)
                VStack(alignment: .leading, spacing: 3) {
                    Text(user.displayName)
                        .font(.headline)
                    Text("@\(user.username)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if user.isMaintainer {
                        Label("维护者", systemImage: "shield.lefthalf.filled")
                            .font(.caption)
                            .foregroundStyle(.tint)
                    }
                }
            }
            .padding(.vertical, 4)
            if let bio = user.bio, !bio.isEmpty {
                Text(bio)
            }
            NavigationLink("编辑个人资料") {
                ProfileEditor(user: user)
            }
        }
    }
}

private struct ProfileAvatar: View {
    let urlString: String?

    var body: some View {
        Group {
            if let value = urlString, let url = URL(string: value) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(Circle())
    }

    private var placeholder: some View {
        Image(systemName: "person.crop.circle.fill")
            .resizable()
            .foregroundStyle(.secondary)
    }
}

private struct AboutSection: View {
    var body: some View {
        Section("关于") {
            LabeledContent("协议版本", value: String(DDLTrackerCore.syncProtocolVersion))
            LabeledContent("API 合同", value: DDLTrackerCore.apiContractVersion)
            Link(destination: URL(string: "https://api.210023.xyz/api/openapi.json")!) {
                Label("OpenAPI 文档", systemImage: "doc.text")
            }
        }
    }
}

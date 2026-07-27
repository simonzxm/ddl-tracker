import DDLTrackerCore
import SwiftUI

struct SessionsView: View {
    @Environment(AppModel.self) private var model
    @State private var sessions: [SessionRecord] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var confirmingAll = false

    var body: some View {
        Group {
            if isLoading && sessions.isEmpty {
                ProgressView("正在载入设备…")
            } else if sessions.isEmpty {
                ContentUnavailableView("没有活动设备", systemImage: "iphone.slash")
            } else {
                List {
                    ForEach(sessions) { session in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Label(session.deviceName ?? "未命名设备", systemImage: "iphone")
                                    .font(.headline)
                                Spacer()
                                if session.revokedAt != nil {
                                    Text("已撤销")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Text("最近使用：\(session.lastSeenAt.formatted(.relative(presentation: .named)))")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text("有效期至 \(AcademicTime.dateTime(session.absoluteExpiresAt))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 3)
                        .swipeActions {
                            if session.revokedAt == nil {
                                Button("撤销", role: .destructive) {
                                    Task { await revoke(session) }
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("登录设备")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("全部退出", role: .destructive) { confirmingAll = true }
                    .disabled(sessions.isEmpty)
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("退出所有设备？", isPresented: $confirmingAll, titleVisibility: .visible) {
            Button("退出所有设备", role: .destructive) {
                Task { await model.signOut(revokeAll: true) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("包括当前设备在内的所有 session 都会被撤销。")
        }
        .alert("设备操作失败", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("好") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do { sessions = try await model.api.sessions() }
        catch { errorMessage = error.localizedDescription }
    }

    private func revoke(_ session: SessionRecord) async {
        do {
            try await model.api.revokeSession(session.id)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

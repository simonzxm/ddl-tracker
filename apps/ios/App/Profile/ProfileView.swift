import DDLTrackerCore
import SwiftUI

struct ProfileView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            if let user = model.currentUser {
                Section {
                    HStack(spacing: 14) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(user.displayName)
                                .font(.headline)
                            Text("@\(user.username)")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            Section("账户") {
                Button("退出登录", role: .destructive) {
                    Task { await model.signOut() }
                }
            }
            Section("关于") {
                LabeledContent("协议版本", value: "2")
                LabeledContent("应用", value: "DDL Tracker")
            }
        }
        .navigationTitle("我的")
        .toolbar { SyncToolbar() }
    }
}

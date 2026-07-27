import SwiftUI

struct SyncStatusView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if model.connectivity == .offline {
                Label("离线 · 修改将在联网后同步", systemImage: "wifi.slash")
                    .foregroundStyle(.secondary)
            } else if model.isSyncing {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("正在同步")
                }
                .foregroundStyle(.secondary)
            } else if !model.outbox.isEmpty {
                Label("\(model.outbox.count) 项待同步", systemImage: "icloud.and.arrow.up")
                    .foregroundStyle(.secondary)
            } else if let lastSyncedAt = model.lastSyncedAt {
                Label(lastSyncedAt.formatted(.relative(presentation: .named)), systemImage: "checkmark.icloud")
                    .foregroundStyle(.secondary)
            }
        }
        .font(.footnote)
        .accessibilityElement(children: .combine)
    }
}

struct SyncToolbar: ToolbarContent {
    @Environment(AppModel.self) private var model

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                Task { await model.synchronize() }
            } label: {
                if model.isSyncing {
                    ProgressView()
                } else {
                    Label("同步", systemImage: "arrow.clockwise")
                }
            }
            .disabled(model.isSyncing)
        }
    }
}

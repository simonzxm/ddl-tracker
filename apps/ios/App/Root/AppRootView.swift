import SwiftUI

struct AppRootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.phase {
            case .launching:
                ProgressView("正在打开 DDL Tracker…")
                    .controlSize(.large)
            case .signedOut:
                AuthenticationView()
            case .signedIn:
                StudentRootView()
            case let .unavailable(message):
                ContentUnavailableView("无法启动", systemImage: "externaldrive.badge.exclamationmark", description: Text(message))
            }
        }
        .task { await model.launch() }
        .alert("DDL Tracker", isPresented: Binding(
            get: { model.alertMessage != nil },
            set: { if !$0 { model.alertMessage = nil } }
        )) {
            Button("好") { model.alertMessage = nil }
        } message: {
            Text(model.alertMessage ?? "")
        }
    }
}

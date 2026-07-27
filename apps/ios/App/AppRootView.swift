import SwiftUI

struct AppRootView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("DDL Tracker", systemImage: "checklist")
            } description: {
                Text("正在准备你的课程待办。")
            }
            .navigationTitle("DDL Tracker")
        }
    }
}

import SwiftUI

struct StudentRootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TabView {
            NavigationStack {
                TodayView()
            }
            .tabItem { Label("待办", systemImage: "checklist") }

            NavigationStack {
                CoursesView()
            }
            .tabItem { Label("课程", systemImage: "books.vertical") }

            NavigationStack {
                ActivityView()
            }
            .tabItem { Label("同步", systemImage: "arrow.triangle.2.circlepath") }
            .badge(model.outbox.filter { $0.status == .rejected }.count)

            NavigationStack {
                ProfileView()
            }
            .tabItem { Label("我的", systemImage: "person.crop.circle") }

            if model.currentUser?.isMaintainer == true {
                NavigationStack {
                    MaintainerPlaceholderView()
                }
                .tabItem { Label("管理", systemImage: "shield.lefthalf.filled") }
            }
        }
    }
}

private struct MaintainerPlaceholderView: View {
    var body: some View {
        ContentUnavailableView {
            Label("维护者中心", systemImage: "shield.lefthalf.filled")
        } description: {
            Text("审核、目录导入与审计工具将在这里显示。")
        }
        .navigationTitle("管理")
    }
}

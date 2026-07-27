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
                    MaintainerHomeView()
                }
                .tabItem { Label("管理", systemImage: "shield.lefthalf.filled") }
            }
        }
    }
}

import SwiftUI

struct StudentRootView: View {
    @Environment(AppModel.self) private var model
    @State private var selection: StudentTab

    init() {
#if DEBUG
        let argument = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--ui-preview-tab=") }
        let rawValue = argument?.replacingOccurrences(of: "--ui-preview-tab=", with: "")
        _selection = State(initialValue: StudentTab(rawValue: rawValue ?? "") ?? .tasks)
#else
        _selection = State(initialValue: .tasks)
#endif
    }

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack {
                TodayView()
            }
            .tabItem { Label("待办", systemImage: "checklist") }
            .tag(StudentTab.tasks)

            NavigationStack {
                CoursesView()
            }
            .tabItem { Label("课程", systemImage: "books.vertical") }
            .tag(StudentTab.courses)

            NavigationStack {
                ActivityView()
            }
            .tabItem { Label("同步", systemImage: "arrow.triangle.2.circlepath") }
            .badge(model.outbox.filter { $0.status == .rejected }.count)
            .tag(StudentTab.activity)

            NavigationStack {
                ProfileView()
            }
            .tabItem { Label("我的", systemImage: "person.crop.circle") }
            .tag(StudentTab.profile)

            if model.currentUser?.isMaintainer == true {
                NavigationStack {
                    MaintainerHomeView()
                }
                .tabItem { Label("管理", systemImage: "shield.lefthalf.filled") }
                .tag(StudentTab.admin)
            }
        }
    }
}

private enum StudentTab: String, Hashable {
    case tasks
    case courses
    case activity
    case profile
    case admin
}

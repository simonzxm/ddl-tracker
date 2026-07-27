import DDLTrackerCore
import SwiftUI

@main
struct DDLTrackerApp: App {
    @State private var model = AppModel.live()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(model)
                .environment(\.timeZone, AcademicTime.timeZone)
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    Task { await model.synchronize() }
                }
        }
    }
}

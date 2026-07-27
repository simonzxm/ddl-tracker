import DDLTrackerCore
import SwiftUI

struct TodayView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if model.taskItems.isEmpty {
                ContentUnavailableView {
                    Label("没有待办", systemImage: "checkmark.circle")
                } description: {
                    Text("添加个人待办，或关注课程教学班以查看共享 DDL。")
                }
            } else {
                List(model.taskItems) { item in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.title)
                            .font(.headline)
                        if let deadline = item.deadline {
                            Text(deadline, style: .date)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("待办")
        .safeAreaInset(edge: .bottom) {
            SyncStatusView()
                .padding(.horizontal)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(.bar)
        }
        .refreshable { await model.synchronize() }
        .toolbar { SyncToolbar() }
    }
}

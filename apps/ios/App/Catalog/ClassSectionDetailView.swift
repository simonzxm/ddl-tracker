import DDLTrackerCore
import SwiftUI

struct ClassSectionDetailView: View {
    @Environment(AppModel.self) private var model
    let classSectionID: UUIDv7
    @State private var showingCreator = false

    private var section: ClassSectionRecord? {
        model.projection.classSections[classSectionID]
    }

    private var tasks: [TaskListItem] {
        model.taskItems.filter { $0.classSectionID == classSectionID && $0.kind == .shared }
    }

    var body: some View {
        List {
            if let section {
                Section("教学班") {
                    LabeledContent("班号", value: section.sectionNumber)
                    if !section.instructors.isEmpty {
                        LabeledContent("教师", value: section.instructors.joined(separator: "、"))
                    }
                    if let schedule = section.scheduleText, !schedule.isEmpty {
                        LabeledContent("时间", value: schedule)
                    }
                    if let campus = section.campus, !campus.isEmpty {
                        LabeledContent("校区", value: campus)
                    }
                }
            }

            Section("共享任务") {
                if tasks.isEmpty {
                    Text("暂无共享任务")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(tasks) { item in
                        if let taskID = item.courseTaskID {
                            NavigationLink {
                                SharedTaskDetailView(courseTaskID: taskID)
                            } label: {
                                TaskRow(item: item)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(section.map { "教学班 \($0.sectionNumber)" } ?? "教学班")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.synchronize() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingCreator = true } label: {
                    Label("新建共享任务", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $showingCreator) {
            SharedTaskCreator(classSectionID: classSectionID)
        }
    }
}

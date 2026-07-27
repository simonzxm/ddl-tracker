import DDLTrackerCore
import SwiftUI

struct CoursesView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if model.projection.followedClassSections.isEmpty {
                ContentUnavailableView {
                    Label("尚未关注课程", systemImage: "books.vertical")
                } description: {
                    Text("浏览学期、课程和教学班后即可关注。")
                }
            } else {
                List(model.projection.followedClassSections.keys.sorted(), id: \.self) { sectionID in
                    let section = model.projection.classSections[sectionID]
                    VStack(alignment: .leading, spacing: 4) {
                        Text(section?.sectionNumber ?? "教学班")
                            .font(.headline)
                        Text(section?.instructors.joined(separator: "、") ?? sectionID.uuidString)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
        }
        .navigationTitle("课程")
        .refreshable { await model.synchronize() }
        .toolbar { SyncToolbar() }
    }
}

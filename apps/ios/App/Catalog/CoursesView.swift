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
                } actions: {
                    NavigationLink("浏览课程") {
                        CatalogBrowserView()
                    }
                    .buttonStyle(.borderedProminent)
                }
            } else {
                List {
                    Section("已关注教学班") {
                        ForEach(model.projection.followedClassSections.keys.sorted(), id: \.self) { sectionID in
                            let section = model.projection.classSections[sectionID]
                            NavigationLink {
                                ClassSectionDetailView(classSectionID: sectionID)
                            } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(section.map { "教学班 \($0.sectionNumber)" } ?? "教学班")
                                        .font(.headline)
                                    if let section {
                                        if !section.instructors.isEmpty {
                                            Text(section.instructors.joined(separator: "、"))
                                                .font(.subheadline)
                                                .foregroundStyle(.secondary)
                                        }
                                        if let schedule = section.scheduleText, !schedule.isEmpty {
                                            Text(schedule)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                            .swipeActions {
                                Button("取消关注", role: .destructive) {
                                    Task { await model.unfollowClassSection(sectionID) }
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("课程")
        .refreshable { await model.synchronize() }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink {
                    CatalogBrowserView()
                } label: {
                    Label("浏览课程", systemImage: "magnifyingglass")
                }
            }
            SyncToolbar()
        }
    }
}

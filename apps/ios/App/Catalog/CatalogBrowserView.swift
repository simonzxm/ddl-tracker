import DDLTrackerCore
import SwiftUI

struct CatalogBrowserView: View {
    @Environment(AppModel.self) private var model
    @State private var terms: [AcademicTerm] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && terms.isEmpty {
                ProgressView("正在载入学期…")
            } else if terms.isEmpty {
                ContentUnavailableView("没有可用学期", systemImage: "calendar.badge.exclamationmark")
            } else {
                List(terms) { term in
                    NavigationLink(value: term.id) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(term.name)
                                .font(.headline)
                            HStack {
                                Text(term.externalCode)
                                Spacer()
                                Text(term.status.displayName)
                            }
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
                .navigationDestination(for: UUIDv7.self) { termID in
                    if let term = terms.first(where: { $0.id == termID }) {
                        TermCoursesView(term: term)
                    }
                }
            }
        }
        .navigationTitle("浏览课程")
        .task(id: model.projection.catalogRevision?.revision) { await load() }
        .refreshable { await load() }
        .alert("无法载入目录", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("好") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            terms = try await model.api.terms()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct TermCoursesView: View {
    @Environment(AppModel.self) private var model
    let term: AcademicTerm
    @State private var courses: [CourseSummary] = []
    @State private var isLoading = true
    @State private var search = ""
    @State private var errorMessage: String?

    private var filteredCourses: [CourseSummary] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return courses }
        return courses.filter {
            $0.name.localizedStandardContains(query) || $0.externalCourseCode.localizedStandardContains(query)
        }
    }

    var body: some View {
        Group {
            if isLoading && courses.isEmpty {
                ProgressView("正在载入课程…")
            } else if filteredCourses.isEmpty {
                ContentUnavailableView.search(text: search)
            } else {
                List(filteredCourses) { course in
                    NavigationLink {
                        CourseSectionsView(course: course)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(course.name)
                                .font(.headline)
                            HStack {
                                Text(course.externalCourseCode)
                                if let credits = course.credits { Text("· \(credits) 学分") }
                            }
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle(term.name)
        .searchable(text: $search, prompt: "课程名称或代码")
        .task(id: model.projection.catalogRevision?.revision) { await load() }
        .refreshable { await load() }
        .alert("无法载入课程", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("好") { errorMessage = nil } } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do { courses = try await model.api.courses(termID: term.id) }
        catch { errorMessage = error.localizedDescription }
    }
}

private struct CourseSectionsView: View {
    @Environment(AppModel.self) private var model
    let course: CourseSummary
    @State private var sections: [ClassSectionSummary] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && sections.isEmpty {
                ProgressView("正在载入教学班…")
            } else if sections.isEmpty {
                ContentUnavailableView("没有教学班", systemImage: "person.3")
            } else {
                List(sections) { section in
                    SectionRow(section: section)
                }
            }
        }
        .navigationTitle(course.name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.projection.catalogRevision?.revision) { await load() }
        .refreshable { await load() }
        .alert("无法载入教学班", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("好") { errorMessage = nil } } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do { sections = try await model.api.classSections(courseID: course.id) }
        catch { errorMessage = error.localizedDescription }
    }
}

private struct SectionRow: View {
    @Environment(AppModel.self) private var model
    let section: ClassSectionSummary

    private var isFollowed: Bool {
        model.projection.followedClassSections[section.id] != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("教学班 \(section.sectionNumber)")
                        .font(.headline)
                    if !section.instructors.isEmpty {
                        Text(section.instructors.joined(separator: "、"))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button(isFollowed ? "已关注" : "关注") {
                    Task {
                        if isFollowed {
                            await model.unfollowClassSection(section.id)
                        } else {
                            await model.followClassSection(section.id)
                        }
                    }
                }
                .buttonStyle(.bordered)
                .tint(isFollowed ? .secondary : .accentColor)
            }
            if let schedule = section.scheduleText, !schedule.isEmpty {
                Label(schedule, systemImage: "clock")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let campus = section.campus, !campus.isEmpty {
                Label(campus, systemImage: "mappin.and.ellipse")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
    }
}

private extension AcademicTermStatus {
    var displayName: String {
        switch self {
        case .upcoming: "即将开始"
        case .inProgress: "进行中"
        case .archived: "已归档"
        }
    }
}

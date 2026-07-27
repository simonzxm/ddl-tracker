import DDLTrackerCore
import SwiftUI

struct PersonalTodoEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let todo: PersonalTodo?
    @State private var title: String
    @State private var note: String
    @State private var hasDeadline: Bool
    @State private var deadline: Date
    @State private var state: TaskProgressState
    @State private var classSectionID: UUIDv7?
    @State private var mergeTargetID: UUIDv7?
    @State private var confirmingPublish = false
    @FocusState private var titleFocused: Bool

    init(todo: PersonalTodo? = nil) {
        self.todo = todo
        _title = State(initialValue: todo?.title ?? "")
        _note = State(initialValue: todo?.note ?? "")
        _hasDeadline = State(initialValue: todo?.deadline != nil)
        _deadline = State(initialValue: todo?.deadline ?? Date().addingTimeInterval(24 * 60 * 60))
        _state = State(initialValue: todo?.state ?? .pending)
        _classSectionID = State(initialValue: todo?.classSectionID)
    }

    private var followedSections: [ClassSectionRecord] {
        model.projection.followedClassSections.keys.compactMap { model.projection.classSections[$0] }
            .sorted { $0.sectionNumber.localizedStandardCompare($1.sectionNumber) == .orderedAscending }
    }

    private var mergeCandidates: [TaskListItem] {
        guard let sectionID = todo?.classSectionID else { return [] }
        return model.taskItems.filter { $0.kind == .shared && $0.classSectionID == sectionID }
    }

    var body: some View {
        NavigationStack {
            Form {
                basicSection
                deadlineSection
                classSectionSection
                if todo != nil { stateSection }
                if let todo { sharingSection(todo) }
            }
            .navigationTitle(todo == nil ? "新建待办" : "编辑待办")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("存储") { save() }
                        .disabled(cleanTitle.isEmpty)
                }
            }
            .onAppear { titleFocused = true }
            .confirmationDialog("发布为共享任务？", isPresented: $confirmingPublish, titleVisibility: .visible) {
                Button("发布") {
                    guard let todo else { return }
                    Task {
                        await model.publishPersonalTodo(todo)
                        dismiss()
                    }
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("标题、截止时间和备注会作为初始共享提案，其他同学可以查看、投票和补充。")
            }
        }
    }

    private var basicSection: some View {
        Section("待办") {
            TextField("标题", text: $title, axis: .vertical)
                .focused($titleFocused)
            TextField("备注（可选）", text: $note, axis: .vertical)
                .lineLimit(3 ... 8)
        }
    }

    private var deadlineSection: some View {
        Section("截止时间") {
            Toggle("设置截止时间", isOn: $hasDeadline)
            if hasDeadline {
                DatePicker("日期与时间", selection: $deadline)
            }
        }
    }

    private var classSectionSection: some View {
        Section {
            Picker("教学班", selection: $classSectionID) {
                Text("不关联教学班").tag(UUIDv7?.none)
                ForEach(followedSections) { section in
                    Text(sectionLabel(section)).tag(Optional(section.id))
                }
            }
        } header: {
            Text("课程关联")
        } footer: {
            Text("关联后可将个人待办发布为该教学班的共享任务。")
        }
    }

    private var stateSection: some View {
        Section("状态") {
            Picker("状态", selection: $state) {
                Label("待完成", systemImage: "circle").tag(TaskProgressState.pending)
                Label("已完成", systemImage: "checkmark.circle").tag(TaskProgressState.completed)
                Label("已忽略", systemImage: "minus.circle").tag(TaskProgressState.ignored)
            }
        }
    }

    private func sharingSection(_ todo: PersonalTodo) -> some View {
        Section {
            Button("发布为新的共享任务") {
                confirmingPublish = true
            }
            .disabled(todo.classSectionID == nil || todo.deadline == nil)

            if !mergeCandidates.isEmpty {
                Picker("合并到共享任务", selection: $mergeTargetID) {
                    Text("选择任务").tag(UUIDv7?.none)
                    ForEach(mergeCandidates) { item in
                        Text(item.title).tag(item.courseTaskID)
                    }
                }
                Button("合并个人内容") {
                    guard let targetID = mergeTargetID else { return }
                    Task {
                        await model.mergePersonalTodo(todo, into: targetID)
                        dismiss()
                    }
                }
                .disabled(mergeTargetID == nil)
            }
        } header: {
            Label("共享", systemImage: "person.2")
        } footer: {
            Text("共享操作使用服务器上已存储的待办版本。请先存储本页修改，再重新打开执行共享。")
        }
    }

    private var cleanTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func sectionLabel(_ section: ClassSectionRecord) -> String {
        let instructors = section.instructors.joined(separator: "、")
        return instructors.isEmpty ? "教学班 \(section.sectionNumber)" : "教学班 \(section.sectionNumber) · \(instructors)"
    }

    private func save() {
        let cleanNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let selectedDeadline = hasDeadline ? deadline : nil
        Task {
            if let todo {
                await model.updatePersonalTodo(
                    todo,
                    title: cleanTitle,
                    deadline: selectedDeadline,
                    note: cleanNote.isEmpty ? nil : cleanNote,
                    state: state,
                    classSectionID: classSectionID
                )
            } else {
                await model.createPersonalTodo(
                    title: cleanTitle,
                    deadline: selectedDeadline,
                    note: cleanNote.isEmpty ? nil : cleanNote,
                    classSectionID: classSectionID
                )
            }
            dismiss()
        }
    }
}

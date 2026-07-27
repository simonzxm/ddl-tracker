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
    @FocusState private var titleFocused: Bool

    init(todo: PersonalTodo? = nil) {
        self.todo = todo
        _title = State(initialValue: todo?.title ?? "")
        _note = State(initialValue: todo?.note ?? "")
        _hasDeadline = State(initialValue: todo?.deadline != nil)
        _deadline = State(initialValue: todo?.deadline ?? Date().addingTimeInterval(24 * 60 * 60))
        _state = State(initialValue: todo?.state ?? .pending)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("待办") {
                    TextField("标题", text: $title, axis: .vertical)
                        .focused($titleFocused)
                    TextField("备注（可选）", text: $note, axis: .vertical)
                        .lineLimit(3 ... 8)
                }

                Section("截止时间") {
                    Toggle("设置截止时间", isOn: $hasDeadline)
                    if hasDeadline {
                        DatePicker("日期与时间", selection: $deadline)
                    }
                }

                if todo != nil {
                    Section("状态") {
                        Picker("状态", selection: $state) {
                            Label("待完成", systemImage: "circle")
                                .tag(TaskProgressState.pending)
                            Label("已完成", systemImage: "checkmark.circle")
                                .tag(TaskProgressState.completed)
                            Label("已忽略", systemImage: "minus.circle")
                                .tag(TaskProgressState.ignored)
                        }
                    }
                }
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
        }
    }

    private var cleanTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
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
                    state: state
                )
            } else {
                await model.createPersonalTodo(
                    title: cleanTitle,
                    deadline: selectedDeadline,
                    note: cleanNote.isEmpty ? nil : cleanNote
                )
            }
            dismiss()
        }
    }
}

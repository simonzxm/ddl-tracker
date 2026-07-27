import DDLTrackerCore
import SwiftUI

struct PrivateTaskDetailsEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let courseTaskID: UUIDv7
    let current: PersonalTaskDetails?
    @State private var title: String
    @State private var note: String
    @State private var hasDeadline: Bool
    @State private var deadline: Date

    init(courseTaskID: UUIDv7, current: PersonalTaskDetails?) {
        self.courseTaskID = courseTaskID
        self.current = current
        _title = State(initialValue: current?.privateTitle ?? "")
        _note = State(initialValue: current?.privateNote ?? "")
        _hasDeadline = State(initialValue: current?.privateDeadline != nil)
        _deadline = State(initialValue: current?.privateDeadline ?? Date().addingTimeInterval(24 * 60 * 60))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("私人标题（可选）", text: $title, axis: .vertical)
                    TextField("私人备注（可选）", text: $note, axis: .vertical)
                        .lineLimit(3 ... 8)
                } header: {
                    Text("只对你可见")
                } footer: {
                    Text("这些内容不会影响其他同学看到的共享任务。")
                }

                Section("私人截止时间") {
                    Toggle("覆盖共享截止时间", isOn: $hasDeadline)
                    if hasDeadline { DatePicker("日期与时间", selection: $deadline) }
                }

                if current != nil {
                    Section {
                        Button("清除所有私人覆盖", role: .destructive) {
                            Task {
                                await model.deletePersonalTaskDetails(courseTaskID: courseTaskID)
                                dismiss()
                            }
                        }
                    }
                }
            }
            .navigationTitle("私人覆盖")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("存储") {
                        Task {
                            let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
                            let cleanNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
                            await model.upsertPersonalTaskDetails(
                                courseTaskID: courseTaskID,
                                privateTitle: cleanTitle.isEmpty ? nil : cleanTitle,
                                privateDeadline: hasDeadline ? deadline : nil,
                                privateNote: cleanNote.isEmpty ? nil : cleanNote
                            )
                            dismiss()
                        }
                    }
                }
            }
        }
    }
}

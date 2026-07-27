import DDLTrackerCore
import SwiftUI

struct ProposalEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let courseTaskID: UUIDv7
    @State private var title = ""
    @State private var deadline = Date().addingTimeInterval(24 * 60 * 60)
    @State private var description = ""
    @State private var evidenceNote = ""
    @State private var evidenceURL = ""
    @FocusState private var titleFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section("任务提案") {
                    TextField("标题", text: $title, axis: .vertical)
                        .focused($titleFocused)
                    DatePicker("截止时间", selection: $deadline)
                    TextField("说明（可选）", text: $description, axis: .vertical)
                        .lineLimit(3 ... 8)
                }
                Section {
                    TextField("证据说明（可选）", text: $evidenceNote, axis: .vertical)
                    TextField("证据链接（可选）", text: $evidenceURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("依据")
                } footer: {
                    Text("可填写课程通知、教师消息或其他可核验来源。")
                }
            }
            .navigationTitle("新提案")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("提交") { submit() }
                        .disabled(cleanTitle.isEmpty)
                }
            }
            .onAppear { titleFocused = true }
        }
    }

    private var cleanTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func submit() {
        Task {
            await model.createTaskProposal(
                courseTaskID: courseTaskID,
                title: cleanTitle,
                deadline: deadline,
                description: optional(description),
                evidenceNote: optional(evidenceNote),
                evidenceURL: optional(evidenceURL)
            )
            dismiss()
        }
    }

    private func optional(_ value: String) -> String? {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? nil : clean
    }
}

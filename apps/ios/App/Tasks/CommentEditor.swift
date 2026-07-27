import DDLTrackerCore
import SwiftUI

struct CommentEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let comment: TaskComment
    @State private var bodyText: String
    @FocusState private var focused: Bool

    init(comment: TaskComment) {
        self.comment = comment
        _bodyText = State(initialValue: comment.body)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("评论", text: $bodyText, axis: .vertical)
                    .lineLimit(4 ... 12)
                    .focused($focused)
            }
            .navigationTitle("编辑评论")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("存储") {
                        Task {
                            await model.editTaskComment(comment, body: cleanBody)
                            dismiss()
                        }
                    }
                    .disabled(cleanBody.isEmpty)
                }
            }
            .onAppear { focused = true }
        }
    }

    private var cleanBody: String {
        bodyText.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

import DDLTrackerCore
import SwiftUI

struct CommentHistoryView: View {
    @Environment(AppModel.self) private var model
    let commentID: UUIDv7
    @State private var revisions: [CommentRevision] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && revisions.isEmpty {
                ProgressView("正在载入历史…")
            } else if revisions.isEmpty {
                ContentUnavailableView("没有修订记录", systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90")
            } else {
                List(revisions, id: \.revision) { revision in
                    VStack(alignment: .leading, spacing: 7) {
                        HStack {
                            Text("版本 \(revision.revision)")
                                .font(.headline)
                            Spacer()
                            Text(revision.createdAt, style: .relative)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text(revision.body)
                    }
                    .padding(.vertical, 3)
                }
            }
        }
        .navigationTitle("评论历史")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert("无法载入历史", isPresented: Binding(
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
            revisions = try await model.api.commentRevisions(commentID: commentID).revisions
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

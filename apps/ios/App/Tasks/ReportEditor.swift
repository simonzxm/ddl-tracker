import DDLTrackerCore
import SwiftUI

struct ReportTarget: Identifiable {
    let id: UUIDv7
    let type: ReportTargetType
    let title: String
}

struct ReportEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let target: ReportTarget
    @State private var reason: ReportReason = .inaccurate
    @State private var details = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("举报对象") {
                    LabeledContent(target.type.displayName, value: target.title)
                }
                Section("原因") {
                    Picker("原因", selection: $reason) {
                        ForEach(ReportReason.allCases, id: \.self) { reason in
                            Text(reason.displayName).tag(reason)
                        }
                    }
                }
                Section {
                    TextField("补充说明（可选）", text: $details, axis: .vertical)
                        .lineLimit(4 ... 10)
                } footer: {
                    Text("请只提交与内容准确性、安全或隐私相关的必要信息。")
                }
            }
            .navigationTitle("举报")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("提交") {
                        Task {
                            let clean = details.trimmingCharacters(in: .whitespacesAndNewlines)
                            await model.createContentReport(
                                targetType: target.type,
                                targetID: target.id,
                                reason: reason,
                                details: clean.isEmpty ? nil : clean
                            )
                            dismiss()
                        }
                    }
                }
            }
        }
    }
}

private extension ReportTargetType {
    var displayName: String {
        switch self {
        case .courseTask: "共享任务"
        case .proposal: "提案"
        case .comment: "评论"
        case .user: "用户"
        }
    }
}

private extension ReportReason {
    var displayName: String {
        switch self {
        case .inaccurate: "信息不准确"
        case .spam: "垃圾内容"
        case .abuse: "辱骂或骚扰"
        case .privacy: "隐私问题"
        case .other: "其他"
        }
    }
}

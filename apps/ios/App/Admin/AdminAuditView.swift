import DDLTrackerCore
import SwiftUI

struct AdminAuditView: View {
    @Environment(AppModel.self) private var model
    @State private var entries: [AdminAuditEntry] = []
    @State private var next: AdminPageCursor?
    @State private var isLoading = false

    var body: some View {
        Group {
            if entries.isEmpty && isLoading {
                ProgressView("正在载入审计记录…")
            } else if entries.isEmpty {
                ContentUnavailableView("没有审计记录", systemImage: "doc.text.magnifyingglass")
            } else {
                List {
                    ForEach(entries) { entry in
                        NavigationLink {
                            AdminAuditDetailView(entry: entry)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(entry.action.replacingOccurrences(of: "_", with: " "))
                                    .font(.headline)
                                HStack {
                                    Text(entry.targetType)
                                    Spacer()
                                    Text(AcademicTime.dateTime(entry.createdAt))
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                if let reason = entry.reason, !reason.isEmpty {
                                    Text(reason)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                            .padding(.vertical, 3)
                        }
                    }

                    if next != nil {
                        Section {
                            Button {
                                Task { await loadMore() }
                            } label: {
                                HStack {
                                    Spacer()
                                    if isLoading { ProgressView() } else { Text("载入更多") }
                                    Spacer()
                                }
                            }
                            .disabled(isLoading)
                        }
                    }
                }
            }
        }
        .navigationTitle("审计记录")
        .task { await reload() }
        .refreshable { await reload() }
    }

    @MainActor
    private func reload() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await model.api.auditEntries()
            entries = page.entries
            next = page.next
        } catch {
            model.alertMessage = adminErrorMessage(error)
        }
    }

    @MainActor
    private func loadMore() async {
        guard let cursor = next, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await model.api.auditEntries(after: cursor)
            entries.append(contentsOf: page.entries.filter { incoming in
                !entries.contains(where: { $0.id == incoming.id })
            })
            next = page.next
        } catch {
            model.alertMessage = adminErrorMessage(error)
        }
    }
}

private struct AdminAuditDetailView: View {
    let entry: AdminAuditEntry

    var body: some View {
        List {
            Section("操作") {
                LabeledContent("动作", value: entry.action)
                LabeledContent("目标类型", value: entry.targetType)
                LabeledContent("时间", value: AcademicTime.dateTime(entry.createdAt))
                if let reason = entry.reason {
                    Text(reason)
                }
            }

            Section("标识符") {
                CopyableIdentifierRow(title: "审计记录", value: entry.id.uuidString)
                if let actorID = entry.actorID {
                    CopyableIdentifierRow(title: "操作者", value: actorID.uuidString)
                }
                if let targetID = entry.targetID {
                    CopyableIdentifierRow(title: "目标", value: targetID.uuidString)
                }
                CopyableIdentifierRow(title: "请求", value: entry.requestID.uuidString)
            }

            Section("结果") {
                Text(entry.result.prettyPrinted)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            }
        }
        .navigationTitle("审计详情")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private extension JSONValue {
    var prettyPrinted: String {
        guard let data = try? JSONCoding.encoder.encode(self),
              let object = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        else { return String(describing: self) }
        return String(decoding: pretty, as: UTF8.self)
    }
}

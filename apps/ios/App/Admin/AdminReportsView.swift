import DDLTrackerCore
import SwiftUI

struct AdminReportsView: View {
    @Environment(AppModel.self) private var model
    @State private var status: ReportStatus? = .open
    @State private var reports: [AdminReport] = []
    @State private var next: AdminPageCursor?
    @State private var isLoading = false

    var body: some View {
        Group {
            if reports.isEmpty && isLoading {
                ProgressView("正在载入举报…")
            } else if reports.isEmpty {
                ContentUnavailableView(
                    status == .open ? "没有待处理举报" : "没有举报记录",
                    systemImage: "checkmark.shield"
                )
            } else {
                List {
                    ForEach(reports) { report in
                        NavigationLink {
                            AdminReportDetailView(report: report) {
                                await reload()
                            }
                        } label: {
                            AdminReportRow(report: report)
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
        .navigationTitle("举报队列")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("状态", selection: $status) {
                        Text("待处理").tag(ReportStatus?.some(.open))
                        Text("已解决").tag(ReportStatus?.some(.resolved))
                        Text("已驳回").tag(ReportStatus?.some(.dismissed))
                        Text("全部").tag(ReportStatus?.none)
                    }
                } label: {
                    Label("筛选", systemImage: "line.3.horizontal.decrease.circle")
                }
            }
        }
        .task(id: status) { await reload() }
        .refreshable { await reload() }
    }

    @MainActor
    private func reload() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await model.api.adminReports(status: status)
            reports = page.reports
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
            let page = try await model.api.adminReports(status: status, after: cursor)
            reports.append(contentsOf: page.reports.filter { incoming in
                !reports.contains(where: { $0.id == incoming.id })
            })
            next = page.next
        } catch {
            model.alertMessage = adminErrorMessage(error)
        }
    }
}

private struct AdminReportRow: View {
    let report: AdminReport

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(report.targetType.adminDisplayName, systemImage: report.targetType.adminSymbol)
                    .font(.headline)
                Spacer()
                Text(report.status.adminDisplayName)
                    .font(.caption.bold())
                    .foregroundStyle(report.status == .open ? .orange : .secondary)
            }
            Text(report.reason.adminDisplayName)
                .font(.subheadline)
            if let details = report.details, !details.isEmpty {
                Text(details)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Text(report.createdAt.formatted(date: .abbreviated, time: .shortened))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }
}

extension ReportTargetType {
    var adminDisplayName: String {
        switch self {
        case .courseTask: "共享任务"
        case .proposal: "提案"
        case .comment: "评论"
        case .user: "用户"
        }
    }

    var adminSymbol: String {
        switch self {
        case .courseTask: "checklist"
        case .proposal: "doc.badge.plus"
        case .comment: "bubble.left"
        case .user: "person.crop.circle.badge.exclamationmark"
        }
    }
}

extension ReportReason {
    var adminDisplayName: String {
        switch self {
        case .inaccurate: "信息不准确"
        case .spam: "垃圾内容"
        case .abuse: "辱骂或骚扰"
        case .privacy: "隐私问题"
        case .other: "其他问题"
        }
    }
}

extension ReportStatus {
    var adminDisplayName: String {
        switch self {
        case .open: "待处理"
        case .resolved: "已解决"
        case .dismissed: "已驳回"
        }
    }
}

func adminErrorMessage(_ error: any Error) -> String {
    (error as? APIError)?.message ?? error.localizedDescription
}

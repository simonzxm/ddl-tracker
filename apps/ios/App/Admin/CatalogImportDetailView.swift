import DDLTrackerCore
import SwiftUI

struct CatalogImportDetailView: View {
    @Environment(AppModel.self) private var model

    let importID: UUIDv7
    let upload: CatalogUploadResponse?
    @State private var status: CatalogImportStatus?
    @State private var isWorking = false
    @State private var confirmDeactivations = false
    @State private var showingCancel = false
    @State private var showingApplyConfirmation = false

    init(upload: CatalogUploadResponse) {
        self.importID = upload.importID
        self.upload = upload
        _status = State(initialValue: nil)
    }

    init(importID: UUIDv7, status: CatalogImportStatus? = nil) {
        self.importID = importID
        self.upload = nil
        _status = State(initialValue: status)
    }

    private var diff: CatalogImportDiff? { status?.diff ?? upload?.diff }
    private var currentState: CatalogImportState? { status?.status }
    private var hasDeactivations: Bool {
        guard let diff else { return false }
        return diff.terms.deactivated > 0
            || diff.courses.deactivated > 0
            || diff.classSections.deactivated > 0
            || !diff.deactivatedClassSectionIDs.isEmpty
    }

    var body: some View {
        List {
            statusSection
            if let upload { uploadSection(upload) }
            if let diff { CatalogDiffSections(diff: diff) }
            actionsSection
        }
        .navigationTitle("导入计划")
        .navigationBarTitleDisplayMode(.inline)
        .task { await refresh() }
        .refreshable { await refresh() }
        .disabled(isWorking)
        .overlay {
            if isWorking {
                ProgressView()
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .sheet(isPresented: $showingCancel) {
            AdminReasonSheet(
                title: "取消目录导入",
                prompt: "填写取消原因；该导入计划将无法再次应用。",
                destructive: true
            ) { reason in
                await cancel(reason: reason)
            }
        }
        .confirmationDialog(
            "应用目录导入？",
            isPresented: $showingApplyConfirmation,
            titleVisibility: .visible
        ) {
            Button("应用导入", role: hasDeactivations ? .destructive : nil) {
                Task { await apply() }
            }
        } message: {
            Text(hasDeactivations
                ? "该计划会停用现有目录记录。应用会在服务端事务中一次完成。"
                : "应用会在服务端事务中一次完成。")
        }
    }

    @ViewBuilder
    private var statusSection: some View {
        Section("状态") {
            LabeledContent("导入 ID") {
                Text(importID.uuidString)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            }
            if let state = currentState {
                LabeledContent("当前状态", value: state.displayName)
            } else {
                LabeledContent("当前状态", value: "正在查询")
            }
            if let status {
                LabeledContent("已接收批次", value: "\(status.receivedBatches) / \(status.totalBatches)")
                LabeledContent("已应用批次", value: "\(status.appliedBatches) / \(status.totalBatches)")
                if let failure = status.failureMessage, !failure.isEmpty {
                    Text(failure)
                        .foregroundStyle(.red)
                }
            }
        }
    }

    @ViewBuilder
    private func uploadSection(_ upload: CatalogUploadResponse) -> some View {
        Section("上传") {
            LabeledContent("文件", value: upload.filename)
            LabeledContent("行数", value: upload.rowCount.formatted())
            LabeledContent("课程", value: upload.courseCount.formatted())
            LabeledContent("教学班", value: upload.classSectionCount.formatted())
            LabeledContent("批次", value: upload.totalBatches.formatted())
            LabeledContent("重复上传", value: upload.replayed ? "是" : "否")
            if !upload.warnings.isEmpty {
                ForEach(upload.warnings, id: \.self) { warning in
                    Label(warning, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    @ViewBuilder
    private var actionsSection: some View {
        if currentState == .planned || currentState == nil {
            Section {
                if hasDeactivations {
                    Toggle("我已审核停用项", isOn: $confirmDeactivations)
                }
                Button("应用目录导入", systemImage: "checkmark.circle") {
                    showingApplyConfirmation = true
                }
                .disabled(hasDeactivations && !confirmDeactivations)
                Button("取消导入", systemImage: "xmark.circle", role: .destructive) {
                    showingCancel = true
                }
            } footer: {
                Text("应用前请核对新增、更新和停用数量。目录导入完成后客户端会通过 catalog revision 重新读取目录。")
            }
        }
    }

    @MainActor
    private func refresh() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            status = try await model.api.catalogImportStatus(importID: importID)
        } catch {
            model.alertMessage = adminErrorMessage(error)
        }
    }

    @MainActor
    private func apply() async {
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await model.api.applyCatalog(
                importID: importID,
                confirmDeactivations: hasDeactivations
            )
            status = try await model.api.catalogImportStatus(importID: importID)
            await model.synchronize()
        } catch {
            model.alertMessage = adminErrorMessage(error)
        }
    }

    @MainActor
    private func cancel(reason: String) async -> Bool {
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await model.api.cancelCatalog(importID: importID, reason: reason)
            status = try await model.api.catalogImportStatus(importID: importID)
            return true
        } catch {
            model.alertMessage = adminErrorMessage(error)
            return false
        }
    }
}

struct CatalogDiffSections: View {
    let diff: CatalogImportDiff

    var body: some View {
        Section("变更摘要") {
            CatalogDiffRow(title: "学期", counts: diff.terms)
            CatalogDiffRow(title: "课程", counts: diff.courses)
            CatalogDiffRow(title: "教学班", counts: diff.classSections)
            LabeledContent("校验和已应用", value: diff.checksumPreviouslyApplied ? "是" : "否")
        }

        if !diff.fieldChanges.isEmpty {
            Section("字段变更") {
                ForEach(diff.fieldChanges.keys.sorted(), id: \.self) { field in
                    LabeledContent(field, value: (diff.fieldChanges[field] ?? 0).formatted())
                }
            }
        }

        if !deactivatedCourses.isEmpty || !deactivatedSections.isEmpty {
            Section {
                ForEach(deactivatedCourses) { course in
                    LabeledContent("课程", value: course.externalCourseCode)
                }
                ForEach(deactivatedSections) { section in
                    LabeledContent("教学班", value: section.externalSectionID)
                }
                if diff.deactivatedClassSectionIDs.count > deactivatedSections.count {
                    LabeledContent("其他教学班 ID", value: (diff.deactivatedClassSectionIDs.count - deactivatedSections.count).formatted())
                }
            } header: {
                Text("将停用")
            } footer: {
                Text("停用不会删除历史共享任务，但这些目录项将不再作为活跃课程展示。")
            }
        }
    }

    private var deactivatedCourses: [DeactivatedCourse] { diff.deactivatedCourses ?? [] }
    private var deactivatedSections: [DeactivatedClassSection] { diff.deactivatedClassSections ?? [] }
}

private struct CatalogDiffRow: View {
    let title: String
    let counts: CatalogDiffCounts

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.headline)
            HStack {
                Text("新增 \(counts.added)")
                Text("更新 \(counts.updated)")
                Text("不变 \(counts.unchanged)")
                if counts.deactivated > 0 {
                    Text("停用 \(counts.deactivated)")
                        .foregroundStyle(.red)
                }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
    }
}

private extension CatalogImportState {
    var displayName: String {
        switch self {
        case .planned: "等待应用"
        case .applied: "已应用"
        case .failed: "失败"
        case .cancelled: "已取消"
        case .expired: "已过期"
        }
    }
}

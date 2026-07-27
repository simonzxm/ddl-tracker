import DDLTrackerCore
import SwiftUI
import UniformTypeIdentifiers

struct CatalogPlanBatchView: View {
    @Environment(AppModel.self) private var model
    @State private var requestFile: ImportedFile?
    @State private var request: CatalogPlanBatchRequest?
    @State private var response: CatalogPlanBatchResponse?
    @State private var selectingFile = false
    @State private var isSubmitting = false

    var body: some View {
        Form {
            Section {
                Button {
                    selectingFile = true
                } label: {
                    HStack {
                        Label(requestFile?.name ?? "选择计划批次 JSON", systemImage: request == nil ? "doc.badge.plus" : "checkmark.circle.fill")
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.bold())
                            .foregroundStyle(.tertiary)
                    }
                }
            } header: {
                Text("请求文件")
            } footer: {
                Text("JSON 必须符合 CatalogPlanBatchRequest 契约。批次顺序、总数、校验和和 finalize 规则仍由服务端验证。")
            }

            if let request {
                Section("批次摘要") {
                    LabeledContent("文件", value: request.filename)
                    LabeledContent("环境", value: request.environment)
                    LabeledContent("行数", value: request.rowCount.formatted())
                    LabeledContent("批次", value: "\(request.batchIndex + 1) / \(request.totalBatches)")
                    LabeledContent("课程", value: request.courses.count.formatted())
                    LabeledContent("教学班", value: request.classSections.count.formatted())
                    LabeledContent("完成计划", value: request.finalize ? "是" : "否")
                }

                Section {
                    Button {
                        Task { await submit(request) }
                    } label: {
                        HStack {
                            Spacer()
                            if isSubmitting { ProgressView() } else { Text("提交批次") }
                            Spacer()
                        }
                    }
                    .disabled(isSubmitting)
                }
            }

            if let response {
                Section("服务端结果") {
                    CopyableIdentifierRow(title: "导入 ID", value: response.importID.uuidString)
                    LabeledContent("已接受", value: response.accepted ? "是" : "否")
                    LabeledContent("已接收批次", value: "\(response.receivedBatches) / \(response.totalBatches)")
                    LabeledContent("计划完整", value: response.planComplete ? "是" : "否")
                    if response.planComplete {
                        NavigationLink("查看导入计划") {
                            CatalogImportDetailView(importID: response.importID)
                        }
                    }
                }

                if let diff = response.diff {
                    CatalogDiffSections(diff: diff)
                }
            }
        }
        .navigationTitle("计划批次")
        .navigationBarTitleDisplayMode(.inline)
        .fileImporter(
            isPresented: $selectingFile,
            allowedContentTypes: [.json, .data],
            allowsMultipleSelection: false
        ) { result in
            importRequest(result)
        }
    }

    private func importRequest(_ result: Result<[URL], any Error>) {
        do {
            let file = try ImportedFile.read(from: try result.get().first)
            guard file.data.count <= 4 * 1024 * 1024 else {
                model.alertMessage = "计划批次 JSON 不能超过 4 MiB。"
                return
            }
            request = try JSONCoding.decoder.decode(CatalogPlanBatchRequest.self, from: file.data)
            requestFile = file
            response = nil
        } catch {
            model.alertMessage = "计划批次文件不符合当前 API 契约。\n\(adminErrorMessage(error))"
        }
    }

    @MainActor
    private func submit(_ request: CatalogPlanBatchRequest) async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            response = try await model.api.planCatalog(request)
        } catch {
            model.alertMessage = adminErrorMessage(error)
        }
    }
}

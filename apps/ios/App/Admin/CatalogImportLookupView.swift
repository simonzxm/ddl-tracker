import DDLTrackerCore
import SwiftUI

struct CatalogImportLookupView: View {
    @Environment(AppModel.self) private var model
    @State private var importID = ""
    @State private var status: CatalogImportStatus?
    @State private var isLoading = false

    var body: some View {
        Form {
            Section {
                TextField("导入 UUID", text: $importID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
            } header: {
                Text("导入标识符")
            } footer: {
                Text("可查询由网页、命令行或其他维护者创建的目录导入。")
            }

            Section {
                Button {
                    Task { await lookup() }
                } label: {
                    HStack {
                        Spacer()
                        if isLoading { ProgressView() } else { Text("查询") }
                        Spacer()
                    }
                }
                .disabled(parsedID == nil || isLoading)
            }

            if let status {
                Section("结果") {
                    LabeledContent("状态", value: status.status.rawValue)
                    LabeledContent("已接收", value: "\(status.receivedBatches) / \(status.totalBatches)")
                    LabeledContent("已应用", value: "\(status.appliedBatches) / \(status.totalBatches)")
                    NavigationLink("查看并管理导入") {
                        CatalogImportDetailView(importID: status.importID, status: status)
                    }
                }
            }
        }
        .navigationTitle("查询导入")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var parsedID: UUIDv7? {
        UUIDv7(importID.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    @MainActor
    private func lookup() async {
        guard let id = parsedID else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            status = try await model.api.catalogImportStatus(importID: id)
        } catch {
            model.alertMessage = adminErrorMessage(error)
        }
    }
}

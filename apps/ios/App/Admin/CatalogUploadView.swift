import DDLTrackerCore
import SwiftUI
import UniformTypeIdentifiers

struct CatalogUploadView: View {
    @Environment(AppModel.self) private var model
    @State private var catalogFile: ImportedFile?
    @State private var manifestFile: ImportedFile?
    @State private var selectingCatalog = false
    @State private var selectingManifest = false
    @State private var uploadResult: CatalogUploadResponse?
    @State private var isUploading = false

    var body: some View {
        Form {
            Section {
                CatalogFileButton(
                    title: "课程目录",
                    guidance: "UTF-8 CSV 的 gzip 文件，文件名必须以 .csv.gz 结尾",
                    symbol: "doc.zipper",
                    file: catalogFile
                ) {
                    selectingCatalog = true
                }

                CatalogFileButton(
                    title: "清单",
                    guidance: "与目录文件匹配的 UTF-8 JSON manifest",
                    symbol: "doc.text",
                    file: manifestFile
                ) {
                    selectingManifest = true
                }
            } header: {
                Text("文件")
            } footer: {
                Text("文件只会在你点击上传后发送。服务端会校验文件名、gzip、JSON、大小、校验和和目录结构。")
            }

            Section {
                Button {
                    Task { await upload() }
                } label: {
                    HStack {
                        Spacer()
                        if isUploading {
                            ProgressView()
                        } else {
                            Text("上传并生成计划")
                        }
                        Spacer()
                    }
                }
                .disabled(catalogFile == nil || manifestFile == nil || isUploading)
            }
        }
        .navigationTitle("上传目录")
        .navigationBarTitleDisplayMode(.inline)
        .fileImporter(
            isPresented: $selectingCatalog,
            allowedContentTypes: [.data],
            allowsMultipleSelection: false,
            onCompletion: importCatalog
        )
        .fileImporter(
            isPresented: $selectingManifest,
            allowedContentTypes: [.json, .data],
            allowsMultipleSelection: false,
            onCompletion: importManifest
        )
        .navigationDestination(isPresented: uploadResultPresented) {
            if let uploadResult {
                CatalogImportDetailView(upload: uploadResult)
            }
        }
    }

    private var uploadResultPresented: Binding<Bool> {
        Binding(
            get: { uploadResult != nil },
            set: { value in
                if !value { uploadResult = nil }
            }
        )
    }

    @MainActor
    private func upload() async {
        guard let catalogFile, let manifestFile else { return }
        isUploading = true
        defer { isUploading = false }
        do {
            uploadResult = try await model.api.uploadCatalog(
                filename: catalogFile.name,
                catalogGzip: catalogFile.data,
                manifest: manifestFile.data
            )
        } catch {
            model.alertMessage = adminErrorMessage(error)
        }
    }

    private func importCatalog(_ result: Result<[URL], any Error>) {
        do {
            let file = try ImportedFile.read(from: try result.get().first)
            guard file.name.lowercased().hasSuffix(".csv.gz") else {
                model.alertMessage = "课程目录文件名必须以 .csv.gz 结尾。"
                return
            }
            guard file.data.count <= 4 * 1024 * 1024 else {
                model.alertMessage = "课程目录 gzip 文件不能超过 4 MiB。"
                return
            }
            catalogFile = file
        } catch {
            model.alertMessage = adminErrorMessage(error)
        }
    }

    private func importManifest(_ result: Result<[URL], any Error>) {
        do {
            let file = try ImportedFile.read(from: try result.get().first)
            guard file.data.count <= 512 * 1024 else {
                model.alertMessage = "Manifest 文件不能超过 512 KiB。"
                return
            }
            _ = try JSONSerialization.jsonObject(with: file.data)
            manifestFile = file
        } catch {
            model.alertMessage = "Manifest 必须是有效的 UTF-8 JSON 文件。"
        }
    }
}

struct ImportedFile: Equatable, Sendable {
    let name: String
    let data: Data

    static func read(from url: URL?) throws -> ImportedFile {
        guard let url else { throw CocoaError(.fileNoSuchFile) }
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        return ImportedFile(name: url.lastPathComponent, data: try Data(contentsOf: url))
    }
}

private struct CatalogFileButton: View {
    let title: String
    let guidance: String
    let symbol: String
    let file: ImportedFile?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                fileIcon
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .foregroundStyle(Color.primary)
                    fileDescription
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(Color.secondary)
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var fileIcon: some View {
        if file == nil {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(Color.secondary)
                .frame(width: 30)
        } else {
            Image(systemName: "checkmark.circle.fill")
                .font(.title2)
                .foregroundStyle(Color.green)
                .frame(width: 30)
        }
    }

    @ViewBuilder
    private var fileDescription: some View {
        if let file {
            Text(file.name)
                .font(.caption)
                .foregroundStyle(Color.secondary)
                .lineLimit(2)
            Text(ByteCountFormatter.string(fromByteCount: Int64(file.data.count), countStyle: .file))
                .font(.caption2)
                .foregroundStyle(Color.secondary)
        } else {
            Text(guidance)
                .font(.caption)
                .foregroundStyle(Color.secondary)
                .lineLimit(2)
        }
    }
}

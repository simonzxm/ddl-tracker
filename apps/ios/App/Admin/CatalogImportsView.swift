import SwiftUI

struct CatalogImportsView: View {
    var body: some View {
        List {
            Section("标准导入") {
                NavigationLink {
                    CatalogUploadView()
                } label: {
                    Label("上传目录文件", systemImage: "square.and.arrow.up")
                }

                NavigationLink {
                    CatalogImportLookupView()
                } label: {
                    Label("查询导入状态", systemImage: "magnifyingglass")
                }
            }

            Section {
                NavigationLink {
                    CatalogPlanBatchView()
                } label: {
                    Label("提交计划批次", systemImage: "shippingbox")
                }
            } header: {
                Text("高级")
            } footer: {
                Text("通常应使用完整 gzip 文件上传。计划批次适用于由受信任工具预先拆分和校验的目录数据。")
            }
        }
        .navigationTitle("目录导入")
    }
}

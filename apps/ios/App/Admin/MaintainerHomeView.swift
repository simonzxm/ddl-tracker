import SwiftUI

struct MaintainerHomeView: View {
    var body: some View {
        List {
            Section("审核") {
                NavigationLink {
                    AdminReportsView()
                } label: {
                    Label("举报队列", systemImage: "exclamationmark.bubble")
                }

                NavigationLink {
                    AdminAuditView()
                } label: {
                    Label("审计记录", systemImage: "doc.text.magnifyingglass")
                }
            }

            Section("管理操作") {
                NavigationLink {
                    AdminOperationsView()
                } label: {
                    Label("内容与账户", systemImage: "wrench.and.screwdriver")
                }

                NavigationLink {
                    CatalogImportsView()
                } label: {
                    Label("课程目录导入", systemImage: "square.and.arrow.down.on.square")
                }
            }
        }
        .navigationTitle("管理")
    }
}

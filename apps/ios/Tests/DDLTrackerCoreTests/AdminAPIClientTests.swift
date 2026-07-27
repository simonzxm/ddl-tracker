import Foundation
import Testing
@testable import DDLTrackerCore

@Test("maintainer API decodes report pages and pagination")
func maintainerAPIDecodesReports() async throws {
    let transport = AdminRecordingTransport(responses: [
        .json(200, #"{"reports":[{"id":"018f0000-0000-7000-8000-000000000001","reporter_id":"018f0000-0000-7000-8000-000000000002","target_type":"comment","target_id":"018f0000-0000-7000-8000-000000000003","reason":"privacy","details":"PII","status":"open","resolution":null,"resolved_by":null,"created_at":"2026-09-01T00:30:00Z","resolved_at":null}],"next":{"created_at":"2026-09-01T00:30:00Z","id":"018f0000-0000-7000-8000-000000000001"}}"#),
    ])
    let client = APIClient(baseURL: URL(string: "https://example.test/api")!, transport: transport, tokenProvider: StaticAccessTokenProvider(token: "token"))
    let page = try await client.adminReports(status: .open, limit: 25)
    #expect(page.reports.count == 1)
    #expect(page.reports[0].targetType == .comment)
    #expect(page.next?.id == id(1))
    let request = try #require(await transport.requests().first)
    #expect(request.url?.path == "/api/v1/admin/reports")
    #expect(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems == [
        URLQueryItem(name: "status", value: "open"),
        URLQueryItem(name: "limit", value: "25"),
    ])
}

@Test("maintainer content actions use typed JSON bodies")
func maintainerContentActionsUseTypedBodies() async throws {
    let transport = AdminRecordingTransport(responses: [
        .json(200, #"{"state":"hidden","revision":4,"changed":true}"#),
    ])
    let client = APIClient(baseURL: URL(string: "https://example.test/api")!, transport: transport, tokenProvider: StaticAccessTokenProvider(token: "token"))
    let result = try await client.setContentHidden(id: id(3), targetType: .comment, hidden: true, reason: "Contains private data")
    #expect(result.state == .hidden)
    #expect(result.revision == 4)
    let request = try #require(await transport.requests().first)
    #expect(request.url?.path == "/api/v1/admin/content/018f0000-0000-7000-8000-000000000003/hide")
    let body = try #require(request.httpBody)
    let object = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
    #expect(object["target_type"] as? String == "comment")
    #expect(object["reason"] as? String == "Contains private data")
}

@Test("catalog upload creates strict multipart fields")
func catalogUploadCreatesMultipartBody() async throws {
    let response = #"{"import_id":"018f0000-0000-7000-8000-000000000001","replayed":false,"filename":"catalog.csv.gz","checksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","manifest_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","row_count":1,"course_count":1,"class_section_count":1,"total_batches":1,"warnings":[],"diff":{"terms":{"added":1,"updated":0,"unchanged":0,"deactivated":0},"courses":{"added":1,"updated":0,"unchanged":0,"deactivated":0},"class_sections":{"added":1,"updated":0,"unchanged":0,"deactivated":0},"field_changes":{},"deactivated_courses":[],"deactivated_class_sections":[],"deactivated_class_section_ids":[],"checksum_previously_applied":false}}"#
    let transport = AdminRecordingTransport(responses: [.json(200, response)])
    let client = APIClient(baseURL: URL(string: "https://example.test/api")!, transport: transport, tokenProvider: StaticAccessTokenProvider(token: "token"))
    let result = try await client.uploadCatalog(filename: "catalog.csv.gz", catalogGzip: Data([0x1f, 0x8b]), manifest: Data(#"{"schema_version":1}"#.utf8))
    #expect(result.filename == "catalog.csv.gz")
    let request = try #require(await transport.requests().first)
    #expect(request.url?.path == "/api/v1/admin/catalog/imports/upload")
    let contentType = try #require(request.value(forHTTPHeaderField: "Content-Type"))
    #expect(contentType.hasPrefix("multipart/form-data; boundary="))
    let body = String(decoding: try #require(request.httpBody), as: UTF8.self)
    #expect(body.contains("name=\"catalog\"; filename=\"catalog.csv.gz\""))
    #expect(body.contains("name=\"manifest\"; filename=\"manifest.json\""))
}

private actor AdminRecordingTransport: HTTPTransport {
    struct Response: Sendable {
        let status: Int
        let data: Data
        static func json(_ status: Int, _ body: String) -> Response { .init(status: status, data: Data(body.utf8)) }
    }
    private var scripted: [Response]
    private var recorded: [URLRequest] = []
    init(responses: [Response]) { scripted = responses }
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        recorded.append(request)
        let response = scripted.removeFirst()
        return (response.data, HTTPURLResponse(url: request.url!, statusCode: response.status, httpVersion: "HTTP/2", headerFields: ["Content-Type": "application/json"])!)
    }
    func requests() -> [URLRequest] { recorded }
}

private func id(_ suffix: Int) -> UUIDv7 {
    UUIDv7(String(format: "018f0000-0000-7000-8000-%012x", suffix))!
}

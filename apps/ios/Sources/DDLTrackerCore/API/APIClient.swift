public import Foundation

public actor APIClient: SyncAPI {
    public static let productionBaseURL = URL(string: "https://api.210023.xyz/api")!
    private let baseURL: URL
    private let transport: any HTTPTransport
    private let tokenProvider: (any AccessTokenProvider)?

    public init(baseURL: URL = productionBaseURL, transport: any HTTPTransport = URLSessionHTTPTransport(), tokenProvider: (any AccessTokenProvider)? = nil) {
        self.baseURL = baseURL; self.transport = transport; self.tokenProvider = tokenProvider
    }

    public func healthLive() async throws -> HealthResponse { try await get("/health/live", authenticated: false) }
    public func healthReady() async throws -> HealthResponse { try await get("/health/ready", authenticated: false) }
    public func requestEmailChallenge(_ request: EmailChallengeRequest) async throws -> EmailChallengeResponse { try await post("/v1/auth/email/challenges", body: request, authenticated: false) }
    public func verifyEmail(_ request: EmailVerificationRequest) async throws -> VerificationResponse { try await post("/v1/auth/email/verifications", body: request, authenticated: false) }
    public func registerAccount(_ request: AccountRegistrationRequest) async throws -> SessionCredential { try await post("/v1/accounts/registrations", body: request, authenticated: false) }
    public func currentUser() async throws -> CurrentUser { try await get("/v1/me") }
    public func deleteAccount() async throws { try await noContent("DELETE", "/v1/me") }
    public func updateProfile(_ request: ProfileUpdateRequest) async throws -> CurrentUser { try await patch("/v1/me/profile", body: request) }
    public func sessions() async throws -> [SessionRecord] { try await get("/v1/sessions", as: SessionListResponse.self).sessions }
    public func revokeAllSessions() async throws { try await noContent("DELETE", "/v1/sessions") }
    public func revokeSession(_ sessionID: UUIDv7) async throws { try await noContent("DELETE", "/v1/sessions/\(sessionID.uuidString)") }
    public func terms() async throws -> [AcademicTerm] { try await get("/v1/terms", as: TermsResponse.self).terms }
    public func courses(termID: UUIDv7) async throws -> [CourseSummary] { try await get("/v1/terms/\(termID.uuidString)/courses", as: CoursesResponse.self).courses }
    public func classSections(courseID: UUIDv7) async throws -> [ClassSectionSummary] { try await get("/v1/courses/\(courseID.uuidString)/class-sections", as: ClassSectionsResponse.self).classSections }
    public func commentRevisions(commentID: UUIDv7, afterRevision: Int? = nil, limit: Int = 100) async throws -> CommentRevisionPage {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let afterRevision { query.append(URLQueryItem(name: "after_revision", value: String(afterRevision))) }
        return try await get("/v1/comments/\(commentID.uuidString)/revisions", query: query)
    }
    public func sync(_ request: SyncRequest) async throws -> SyncResponse { try await post("/v1/sync", body: request) }

    private func get<Response: Decodable>(_ path: String, query: [URLQueryItem] = [], authenticated: Bool = true, as: Response.Type = Response.self) async throws -> Response {
        try await send(method: "GET", path: path, query: query, body: Optional<Data>.none, authenticated: authenticated, as: Response.self)
    }
    private func post<Body: Encodable, Response: Decodable>(_ path: String, body: Body, authenticated: Bool = true) async throws -> Response {
        try await send(method: "POST", path: path, query: [], body: JSONCoding.encoder.encode(body), authenticated: authenticated, as: Response.self)
    }
    private func patch<Body: Encodable, Response: Decodable>(_ path: String, body: Body) async throws -> Response {
        try await send(method: "PATCH", path: path, query: [], body: JSONCoding.encoder.encode(body), authenticated: true, as: Response.self)
    }
    private func noContent(_ method: String, _ path: String) async throws {
        let (data, response) = try await perform(method: method, path: path, query: [], body: nil, authenticated: true)
        try validate(response: response, data: data)
    }
    private func send<Response: Decodable>(method: String, path: String, query: [URLQueryItem], body: Data?, authenticated: Bool, as: Response.Type) async throws -> Response {
        let (data, response) = try await perform(method: method, path: path, query: query, body: body, authenticated: authenticated)
        try validate(response: response, data: data)
        do { return try JSONCoding.decoder.decode(Response.self, from: data) }
        catch { throw error }
    }
    private func perform(method: String, path: String, query: [URLQueryItem], body: Data?, authenticated: Bool) async throws -> (Data, HTTPURLResponse) {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))), resolvingAgainstBaseURL: false) else { throw HTTPClientError.invalidURL }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw HTTPClientError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if authenticated {
            guard let token = try await tokenProvider?.accessToken(), !token.isEmpty else { throw HTTPClientError.missingAccessToken }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return try await transport.data(for: request)
    }
    private func validate(response: HTTPURLResponse, data: Data) throws {
        guard (200 ..< 300).contains(response.statusCode) else {
            if let apiError = try? JSONCoding.decoder.decode(APIError.self, from: data) { throw apiError }
            throw HTTPClientError.invalidResponse(status: response.statusCode)
        }
    }
}

public extension APIClient {
    func bootstrapMaintainer(token: String) async throws -> AdminResult {
        try await post("/v1/admin/bootstrap", body: AdminBootstrapRequest(bootstrapToken: token))
    }

    func planCatalog(_ request: CatalogPlanBatchRequest) async throws -> CatalogPlanBatchResponse {
        try await post("/v1/admin/catalog/imports/plan", body: request)
    }

    func uploadCatalog(filename: String, catalogGzip: Data, manifest: Data) async throws -> CatalogUploadResponse {
        guard filename.lowercased().hasSuffix(".csv.gz"), !filename.contains("\"") && !filename.contains("\r") && !filename.contains("\n") else {
            throw CatalogUploadError.invalidFilename
        }
        let boundary = "DDLTracker-\(UUID().uuidString)"
        var body = Data()
        func append(_ value: String) { body.append(Data(value.utf8)) }
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"catalog\"; filename=\"\(filename)\"\r\n")
        append("Content-Type: application/gzip\r\n\r\n")
        body.append(catalogGzip)
        append("\r\n--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"manifest\"; filename=\"manifest.json\"\r\n")
        append("Content-Type: application/json\r\n\r\n")
        body.append(manifest)
        append("\r\n--\(boundary)--\r\n")

        let url = baseURL.appendingPathComponent("v1/admin/catalog/imports/upload")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        guard let token = try await tokenProvider?.accessToken(), !token.isEmpty else { throw HTTPClientError.missingAccessToken }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await transport.data(for: request)
        try validate(response: response, data: data)
        return try JSONCoding.decoder.decode(CatalogUploadResponse.self, from: data)
    }

    func applyCatalog(importID: UUIDv7, confirmDeactivations: Bool) async throws -> CatalogApplyResponse {
        try await post("/v1/admin/catalog/imports/\(importID.uuidString)/apply-all", body: CatalogApplyAllRequest(confirmDeactivations: confirmDeactivations))
    }

    func cancelCatalog(importID: UUIDv7, reason: String) async throws -> CatalogCancelResponse {
        try await post("/v1/admin/catalog/imports/\(importID.uuidString)/cancel", body: CatalogCancelRequest(reason: reason))
    }

    func catalogImportStatus(importID: UUIDv7) async throws -> CatalogImportStatus {
        try await get("/v1/admin/catalog/imports/\(importID.uuidString)")
    }

    func adminReports(status: ReportStatus? = nil, limit: Int = 50, after: AdminPageCursor? = nil) async throws -> AdminReportPage {
        var query: [URLQueryItem] = []
        if let status { query.append(URLQueryItem(name: "status", value: status.rawValue)) }
        query.append(URLQueryItem(name: "limit", value: String(limit)))
        if let after {
            query.append(URLQueryItem(name: "after_created_at", value: RFC3339.string(from: after.createdAt)))
            query.append(URLQueryItem(name: "after_id", value: after.id.uuidString))
        }
        return try await get("/v1/admin/reports", query: query)
    }

    func resolveReport(id: UUIDv7, status: AdminReportResolutionStatus, resolution: String) async throws -> AdminReportResolutionResponse {
        try await post("/v1/admin/reports/\(id.uuidString)/resolve", body: AdminReportResolutionRequest(status: status, resolution: resolution))
    }

    func setContentHidden(id: UUIDv7, targetType: AdminContentTargetType, hidden: Bool, reason: String) async throws -> AdminContentActionResponse {
        let action = hidden ? "hide" : "restore"
        return try await post("/v1/admin/content/\(id.uuidString)/\(action)", body: AdminContentActionRequest(targetType: targetType, reason: reason))
    }

    func setUserSuspended(id: UUIDv7, suspended: Bool, reason: String) async throws -> AdminResult {
        let action = suspended ? "suspend" : "restore"
        return try await post("/v1/admin/users/\(id.uuidString)/\(action)", body: AdminUserActionRequest(reason: reason))
    }

    func setMaintainerRole(id: UUIDv7, maintainer: Bool, reason: String) async throws -> AdminResult {
        try await post("/v1/admin/users/\(id.uuidString)/roles", body: AdminRoleRequest(maintainer: maintainer, reason: reason))
    }

    func mergeTask(sourceID: UUIDv7, targetID: UUIDv7, reason: String) async throws -> AdminResult {
        try await post("/v1/admin/tasks/\(sourceID.uuidString)/merge", body: AdminTaskMergeRequest(targetTaskID: targetID, reason: reason))
    }

    func auditEntries(limit: Int = 50, after: AdminPageCursor? = nil) async throws -> AdminAuditPage {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let after {
            query.append(URLQueryItem(name: "after_created_at", value: RFC3339.string(from: after.createdAt)))
            query.append(URLQueryItem(name: "after_id", value: after.id.uuidString))
        }
        return try await get("/v1/admin/audit", query: query)
    }
}

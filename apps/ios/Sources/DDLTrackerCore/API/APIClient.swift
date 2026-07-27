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

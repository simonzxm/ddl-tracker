import Foundation
import Testing
@testable import DDLTrackerCore

@Test("student API builds authenticated catalog requests")
func studentAPIBuildsAuthenticatedCatalogRequests() async throws {
    let transport = RecordingTransport(responses: [
        .json(200, #"{"terms":[]}"#),
    ])
    let client = APIClient(
        baseURL: URL(string: "https://example.test/api")!,
        transport: transport,
        tokenProvider: StaticAccessTokenProvider(token: "secret-token")
    )

    let terms = try await client.terms()
    #expect(terms.isEmpty)
    let request = try #require(await transport.requests().first)
    #expect(request.url?.absoluteString == "https://example.test/api/v1/terms")
    #expect(request.httpMethod == "GET")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret-token")
    #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
}

@Test("student API encodes authentication bodies with wire keys")
func studentAPIEncodesAuthenticationBodies() async throws {
    let challengeID = id(1)
    let transport = RecordingTransport(responses: [
        .json(200, #"{"kind":"registration","registration_token":"register","expires_at":"2026-09-01T00:30:00Z"}"#),
    ])
    let client = APIClient(
        baseURL: URL(string: "https://example.test/api")!,
        transport: transport
    )

    let response = try await client.verifyEmail(.init(
        challengeID: challengeID,
        email: "student@smail.nju.edu.cn",
        code: "123456",
        deviceName: "iPhone",
        deviceMetadata: ["platform": .string("iOS")]
    ))
    guard case let .registration(registration) = response else {
        Issue.record("Expected registration response")
        return
    }
    #expect(registration.registrationToken == "register")

    let request = try #require(await transport.requests().first)
    #expect(request.url?.path == "/api/v1/auth/email/verifications")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    let body = try #require(request.httpBody)
    let object = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
    #expect(object["challenge_id"] as? String == challengeID.uuidString)
    #expect(object["device_name"] as? String == "iPhone")
    #expect((object["device_metadata"] as? [String: Any])?["platform"] as? String == "iOS")
}

@Test("student API maps non success responses to APIError")
func studentAPIMapsErrors() async throws {
    let transport = RecordingTransport(responses: [
        .json(409, #"{"code":"revision_conflict","details":{"current_revision":4},"message":"Conflict","retryable":false,"request_id":"018f0000-0000-7000-8000-000000000099"}"#),
    ])
    let client = APIClient(
        baseURL: URL(string: "https://example.test/api")!,
        transport: transport,
        tokenProvider: StaticAccessTokenProvider(token: "token")
    )

    do {
        _ = try await client.updateProfile(.init(
            username: "student",
            displayName: "Student",
            avatarURL: nil,
            bio: nil,
            expectedRevision: 3
        ))
        Issue.record("Expected APIError")
    } catch let error as APIError {
        #expect(error.code == .revisionConflict)
        #expect(error.details["current_revision"] == .integer(4))
    }
}

@Test("student API accepts empty 204 responses")
func studentAPIAcceptsNoContent() async throws {
    let transport = RecordingTransport(responses: [.empty(204)])
    let client = APIClient(
        baseURL: URL(string: "https://example.test/api")!,
        transport: transport,
        tokenProvider: StaticAccessTokenProvider(token: "token")
    )
    try await client.revokeSession(id(22))
    let request = try #require(await transport.requests().first)
    #expect(request.httpMethod == "DELETE")
    #expect(request.url?.path == "/api/v1/sessions/018f0000-0000-7000-8000-000000000016")
}

@Test("API client implements SyncAPI")
func apiClientImplementsSyncAPI() async throws {
    let transport = RecordingTransport(responses: [
        .json(200, #"{"protocol_version":2,"mode":"incremental","request_id":"018f0000-0000-7000-8000-000000000001","operation_results":[],"events":[],"next_cursor":"cursor-2","has_more":false}"#),
    ])
    let client = APIClient(
        baseURL: URL(string: "https://example.test/api")!,
        transport: transport,
        tokenProvider: StaticAccessTokenProvider(token: "token")
    )
    let response = try await client.sync(.incremental(.init(cursor: "cursor-1", operations: [])))
    guard case let .incremental(value) = response else {
        Issue.record("Expected incremental response")
        return
    }
    #expect(value.nextCursor == "cursor-2")
}

private actor RecordingTransport: HTTPTransport {
    struct Response: Sendable {
        let status: Int
        let data: Data

        static func json(_ status: Int, _ body: String) -> Response {
            Response(status: status, data: Data(body.utf8))
        }

        static func empty(_ status: Int) -> Response {
            Response(status: status, data: Data())
        }
    }

    private var scripted: [Response]
    private var recorded: [URLRequest] = []

    init(responses: [Response]) { scripted = responses }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        recorded.append(request)
        let response = scripted.removeFirst()
        return (
            response.data,
            HTTPURLResponse(
                url: request.url!,
                statusCode: response.status,
                httpVersion: "HTTP/2",
                headerFields: ["Content-Type": "application/json"]
            )!
        )
    }

    func requests() -> [URLRequest] { recorded }
}

private func id(_ suffix: Int) -> UUIDv7 {
    UUIDv7(String(format: "018f0000-0000-7000-8000-%012x", suffix))!
}

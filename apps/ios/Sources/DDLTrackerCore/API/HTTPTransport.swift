public import Foundation

public protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionHTTPTransport: HTTPTransport {
    private let session: URLSession
    public init(session: URLSession = .shared) { self.session = session }
    public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw HTTPClientError.nonHTTPResponse }
        return (data, http)
    }
}

public protocol AccessTokenProvider: Sendable { func accessToken() async throws -> String? }
public actor StaticAccessTokenProvider: AccessTokenProvider {
    private var token: String?
    public init(token: String?) { self.token = token }
    public func accessToken() -> String? { token }
    public func setToken(_ token: String?) { self.token = token }
}

public enum HTTPClientError: Error, Equatable, Sendable {
    case nonHTTPResponse
    case invalidURL
    case missingAccessToken
    case invalidResponse(status: Int)
}

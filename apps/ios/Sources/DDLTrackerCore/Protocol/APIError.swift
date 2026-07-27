public enum APIErrorCode: String, Codable, Sendable {
    case accountSuspended = "account_suspended"
    case challengeExpired = "challenge_expired"
    case challengeLocked = "challenge_locked"
    case conflict
    case contentHidden = "content_hidden"
    case cursorExpired = "cursor_expired"
    case dependencyFailed = "dependency_failed"
    case duplicateProposal = "duplicate_proposal"
    case forbidden
    case inactiveTerm = "inactive_term"
    case internalError = "internal_error"
    case invalidRequest = "invalid_request"
    case methodNotAllowed = "method_not_allowed"
    case notFound = "not_found"
    case operationIDReused = "operation_id_reused"
    case payloadTooLarge = "payload_too_large"
    case protocolVersionUnsupported = "protocol_version_unsupported"
    case rateLimited = "rate_limited"
    case registrationRequired = "registration_required"
    case registrationTokenInvalid = "registration_token_invalid"
    case revisionConflict = "revision_conflict"
    case temporarilyUnavailable = "temporarily_unavailable"
    case unauthenticated
    case unsupportedMediaType = "unsupported_media_type"
    case usernameTaken = "username_taken"
}

public struct APIError: Error, Codable, Equatable, Sendable {
    public let code: APIErrorCode
    public let details: [String: JSONValue]
    public let message: String
    public let retryable: Bool
    public let retryAfter: Int?
    public let requestID: UUIDv7

    public init(
        code: APIErrorCode,
        details: [String: JSONValue],
        message: String,
        retryable: Bool,
        retryAfter: Int? = nil,
        requestID: UUIDv7
    ) {
        self.code = code
        self.details = details
        self.message = message
        self.retryable = retryable
        self.retryAfter = retryAfter
        self.requestID = requestID
    }
}

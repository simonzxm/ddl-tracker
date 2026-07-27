public import Foundation

public enum UserRole: String, Codable, Sendable { case maintainer }

public struct CurrentUser: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let username: String
    public let displayName: String
    public let avatarURL: String?
    public let bio: String?
    public let status: UserStatus
    public let profileRevision: Int
    public let roles: [UserRole]

    public init(id: UUIDv7, username: String, displayName: String, avatarURL: String?, bio: String?, status: UserStatus, profileRevision: Int, roles: [UserRole]) {
        self.id = id; self.username = username; self.displayName = displayName; self.avatarURL = avatarURL
        self.bio = bio; self.status = status; self.profileRevision = profileRevision; self.roles = roles
    }

    public var isMaintainer: Bool { roles.contains(.maintainer) }
}

public struct EmailChallengeRequest: Codable, Equatable, Sendable { public let email: String; public init(email: String) { self.email = email } }
public struct EmailChallengeResponse: Codable, Equatable, Sendable { public let challengeID: UUIDv7; public let expiresAt: Date }

public struct EmailVerificationRequest: Codable, Equatable, Sendable {
    public let challengeID: UUIDv7
    public let email: String
    public let code: String
    public let deviceName: String?
    public let deviceMetadata: [String: JSONValue]
    public init(challengeID: UUIDv7, email: String, code: String, deviceName: String?, deviceMetadata: [String: JSONValue] = [:]) {
        self.challengeID = challengeID; self.email = email; self.code = code; self.deviceName = deviceName; self.deviceMetadata = deviceMetadata
    }
}

public struct RegistrationVerification: Codable, Equatable, Sendable { public let registrationToken: String; public let expiresAt: Date }
public struct SessionCredential: Codable, Equatable, Sendable {
    public let accessToken: String
    public let tokenType: String
    public let expiresAt: Date
    public let user: CurrentUser

    public init(accessToken: String, tokenType: String, expiresAt: Date, user: CurrentUser) {
        self.accessToken = accessToken
        self.tokenType = tokenType
        self.expiresAt = expiresAt
        self.user = user
    }
}

public enum VerificationResponse: Codable, Equatable, Sendable {
    case registration(RegistrationVerification)
    case session(SessionCredential)
    private enum Keys: String, CodingKey { case kind }
    private enum Kind: String, Codable { case registration, session }
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .registration: self = .registration(try RegistrationVerification(from: decoder))
        case .session: self = .session(try SessionCredential(from: decoder))
        }
    }
    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        switch self {
        case let .registration(value): try value.encode(to: encoder); try container.encode(Kind.registration, forKey: .kind)
        case let .session(value): try value.encode(to: encoder); try container.encode(Kind.session, forKey: .kind)
        }
    }
}

public struct AccountRegistrationRequest: Codable, Equatable, Sendable {
    public let registrationToken: String
    public let username: String
    public let displayName: String?
    public let deviceName: String?
    public let deviceMetadata: [String: JSONValue]
    public init(registrationToken: String, username: String, displayName: String?, deviceName: String?, deviceMetadata: [String: JSONValue] = [:]) {
        self.registrationToken = registrationToken; self.username = username; self.displayName = displayName
        self.deviceName = deviceName; self.deviceMetadata = deviceMetadata
    }
}

public struct ProfileUpdateRequest: Codable, Equatable, Sendable {
    public let username: String
    public let displayName: String
    public let avatarURL: String?
    public let bio: String?
    public let expectedRevision: Int
    public init(username: String, displayName: String, avatarURL: String?, bio: String?, expectedRevision: Int) {
        self.username = username; self.displayName = displayName; self.avatarURL = avatarURL; self.bio = bio; self.expectedRevision = expectedRevision
    }
}

public struct SessionRecord: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let deviceName: String?
    public let deviceMetadata: [String: JSONValue]
    public let createdAt: Date
    public let lastSeenAt: Date
    public let idleExpiresAt: Date
    public let absoluteExpiresAt: Date
    public let revokedAt: Date?
}
struct SessionListResponse: Codable { let sessions: [SessionRecord] }

public enum AcademicTermStatus: String, Codable, Sendable { case upcoming, inProgress = "in_progress", archived }
public struct AcademicTerm: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let externalCode: String
    public let name: String
    public let startsOn: String?
    public let endsOn: String?
    public let status: AcademicTermStatus
}
struct TermsResponse: Codable { let terms: [AcademicTerm] }

public struct CourseSummary: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let externalCourseCode: String
    public let name: String
    public let credits: String?
}
struct CoursesResponse: Codable { let courses: [CourseSummary] }

public struct ClassSectionSummary: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let externalSectionID: String
    public let sectionNumber: String
    public let departmentCode: String?
    public let departmentName: String?
    public let instructors: [String]
    public let campus: String?
    public let capacity: Int?
    public let scheduleText: String?
    public let active: Bool
    public let revision: Int
}
struct ClassSectionsResponse: Codable { let classSections: [ClassSectionSummary] }

public struct CommentRevision: Codable, Equatable, Sendable {
    public let revision: Int
    public let body: String
    public let authorID: UUIDv7?
    public let createdAt: Date
}
public struct CommentRevisionPage: Codable, Equatable, Sendable {
    public let commentID: UUIDv7
    public let revisions: [CommentRevision]
    public let nextAfterRevision: Int?
}

public struct HealthResponse: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Sendable { case live, ready }
    public let status: Status
}

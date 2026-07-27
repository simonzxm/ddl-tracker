public enum SyncRequestValidationError: Error, Equatable, Sendable {
    case invalidPageLimit(Int)
    case emptyCursor
    case pageTokenRequiresSnapshotToken
}

public struct AccountSnapshotRequest: Equatable, Sendable {
    public let snapshotToken: String?
    public let pageToken: String?
    public let snapshotLimit: Int

    public init(snapshotToken: String?, pageToken: String?, snapshotLimit: Int = 500) {
        self.snapshotToken = snapshotToken
        self.pageToken = pageToken
        self.snapshotLimit = snapshotLimit
    }

    public init(validatingSnapshotToken snapshotToken: String?, pageToken: String?, snapshotLimit: Int = 500) throws {
        try SyncRequestValidation.validate(snapshotToken: snapshotToken, pageToken: pageToken, limit: snapshotLimit)
        self.init(snapshotToken: snapshotToken, pageToken: pageToken, snapshotLimit: snapshotLimit)
    }
}

public struct ClassSectionSnapshotRequest: Equatable, Sendable {
    public let cursor: String
    public let classSectionID: UUIDv7
    public let snapshotToken: String?
    public let pageToken: String?
    public let snapshotLimit: Int

    public init(
        cursor: String,
        classSectionID: UUIDv7,
        snapshotToken: String?,
        pageToken: String?,
        snapshotLimit: Int = 500
    ) {
        self.cursor = cursor
        self.classSectionID = classSectionID
        self.snapshotToken = snapshotToken
        self.pageToken = pageToken
        self.snapshotLimit = snapshotLimit
    }

    public init(
        validatingCursor cursor: String,
        classSectionID: UUIDv7,
        snapshotToken: String?,
        pageToken: String?,
        snapshotLimit: Int = 500
    ) throws {
        try SyncRequestValidation.validate(cursor: cursor)
        try SyncRequestValidation.validate(snapshotToken: snapshotToken, pageToken: pageToken, limit: snapshotLimit)
        self.init(
            cursor: cursor,
            classSectionID: classSectionID,
            snapshotToken: snapshotToken,
            pageToken: pageToken,
            snapshotLimit: snapshotLimit
        )
    }
}

public struct IncrementalSyncRequest: Equatable, Sendable {
    public let cursor: String
    public let eventLimit: Int
    public let operations: [StudentOperation]

    public init(cursor: String, eventLimit: Int = 500, operations: [StudentOperation]) throws {
        try self.init(validatingCursor: cursor, eventLimit: eventLimit, operations: operations)
    }

    public init(validatingCursor cursor: String, eventLimit: Int = 500, operations: [StudentOperation]) throws {
        try SyncRequestValidation.validate(cursor: cursor)
        try SyncRequestValidation.validate(limit: eventLimit)
        try StudentOperationBatch.validate(operations)
        self.cursor = cursor
        self.eventLimit = eventLimit
        self.operations = operations
    }
}

public enum SyncRequest: Codable, Equatable, Sendable {
    case accountSnapshot(AccountSnapshotRequest)
    case classSectionSnapshot(ClassSectionSnapshotRequest)
    case incremental(IncrementalSyncRequest)

    public var mode: SyncMode {
        switch self {
        case .accountSnapshot: .accountSnapshot
        case .classSectionSnapshot: .classSectionSnapshot
        case .incremental: .incremental
        }
    }

    private enum CodingKeys: String, CodingKey {
        case protocolVersion, mode, snapshotToken, pageToken, snapshotLimit
        case operations, cursor, classSectionID, eventLimit
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .protocolVersion)
        guard version == DDLTrackerCore.syncProtocolVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .protocolVersion,
                in: container,
                debugDescription: "Unsupported sync protocol version \(version)."
            )
        }
        let mode = try container.decode(SyncMode.self, forKey: .mode)
        switch mode {
        case .accountSnapshot:
            self = .accountSnapshot(try AccountSnapshotRequest(
                validatingSnapshotToken: container.decodeIfPresent(String.self, forKey: .snapshotToken),
                pageToken: container.decodeIfPresent(String.self, forKey: .pageToken),
                snapshotLimit: container.decode(Int.self, forKey: .snapshotLimit)
            ))
        case .classSectionSnapshot:
            self = .classSectionSnapshot(try ClassSectionSnapshotRequest(
                validatingCursor: container.decode(String.self, forKey: .cursor),
                classSectionID: container.decode(UUIDv7.self, forKey: .classSectionID),
                snapshotToken: container.decodeIfPresent(String.self, forKey: .snapshotToken),
                pageToken: container.decodeIfPresent(String.self, forKey: .pageToken),
                snapshotLimit: container.decode(Int.self, forKey: .snapshotLimit)
            ))
        case .incremental:
            self = .incremental(try IncrementalSyncRequest(
                validatingCursor: container.decode(String.self, forKey: .cursor),
                eventLimit: container.decode(Int.self, forKey: .eventLimit),
                operations: container.decode([StudentOperation].self, forKey: .operations)
            ))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(DDLTrackerCore.syncProtocolVersion, forKey: .protocolVersion)
        try container.encode(mode, forKey: .mode)
        switch self {
        case let .accountSnapshot(value):
            try container.encode(value.snapshotToken, forKey: .snapshotToken)
            try container.encode(value.pageToken, forKey: .pageToken)
            try container.encode(value.snapshotLimit, forKey: .snapshotLimit)
            try container.encode([StudentOperation](), forKey: .operations)
        case let .classSectionSnapshot(value):
            try container.encode(value.cursor, forKey: .cursor)
            try container.encode(value.classSectionID, forKey: .classSectionID)
            try container.encode(value.snapshotToken, forKey: .snapshotToken)
            try container.encode(value.pageToken, forKey: .pageToken)
            try container.encode(value.snapshotLimit, forKey: .snapshotLimit)
            try container.encode([StudentOperation](), forKey: .operations)
        case let .incremental(value):
            try container.encode(value.cursor, forKey: .cursor)
            try container.encode(value.eventLimit, forKey: .eventLimit)
            try container.encode(value.operations, forKey: .operations)
        }
    }
}

private enum SyncRequestValidation {
    static func validate(limit: Int) throws {
        guard (1 ... 500).contains(limit) else {
            throw SyncRequestValidationError.invalidPageLimit(limit)
        }
    }

    static func validate(cursor: String) throws {
        guard !cursor.isEmpty else { throw SyncRequestValidationError.emptyCursor }
    }

    static func validate(snapshotToken: String?, pageToken: String?, limit: Int) throws {
        try validate(limit: limit)
        if pageToken != nil, snapshotToken == nil {
            throw SyncRequestValidationError.pageTokenRequiresSnapshotToken
        }
    }
}

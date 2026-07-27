public import Foundation
public import SwiftData

@Model
public final class StoredClientState {
    @Attribute(.unique) public var key: String
    @Attribute(.externalStorage) public var projectionData: Data
    @Attribute(.externalStorage) public var metadataData: Data
    public var updatedAt: Date

    public init(
        key: String = "primary",
        projectionData: Data,
        metadataData: Data,
        updatedAt: Date = Date()
    ) {
        self.key = key
        self.projectionData = projectionData
        self.metadataData = metadataData
        self.updatedAt = updatedAt
    }
}

@Model
public final class StoredOutboxItem {
    @Attribute(.unique) public var operationID: String
    @Attribute(.externalStorage) public var operationData: Data
    public var statusRawValue: String
    @Attribute(.externalStorage) public var errorData: Data?
    public var attemptCount: Int
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        operationID: String,
        operationData: Data,
        statusRawValue: String,
        errorData: Data? = nil,
        attemptCount: Int = 0,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.operationID = operationID
        self.operationData = operationData
        self.statusRawValue = statusRawValue
        self.errorData = errorData
        self.attemptCount = attemptCount
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

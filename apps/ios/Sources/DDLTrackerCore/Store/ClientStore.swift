public import Foundation
public import SwiftData

public struct SnapshotPageCheckpoint: Codable, Equatable, Sendable {
    public var snapshotToken: String?
    public var pageToken: String?
    public var resumeCursor: String?

    public init(snapshotToken: String?, pageToken: String?, resumeCursor: String? = nil) {
        self.snapshotToken = snapshotToken
        self.pageToken = pageToken
        self.resumeCursor = resumeCursor
    }
}

public struct PersistedSyncMetadata: Codable, Equatable, Sendable {
    public var cursor: String?
    public var accountSnapshot: SnapshotPageCheckpoint?
    public var classSectionSnapshots: [UUIDv7: SnapshotPageCheckpoint]
    public var pendingClassSectionSnapshotIDs: [UUIDv7]

    public init(
        cursor: String? = nil,
        accountSnapshot: SnapshotPageCheckpoint? = nil,
        classSectionSnapshots: [UUIDv7: SnapshotPageCheckpoint] = [:],
        pendingClassSectionSnapshotIDs: [UUIDv7] = []
    ) {
        self.cursor = cursor
        self.accountSnapshot = accountSnapshot
        self.classSectionSnapshots = classSectionSnapshots
        self.pendingClassSectionSnapshotIDs = pendingClassSectionSnapshotIDs
    }
}

public struct ClientStoreSnapshot: Equatable, Sendable {
    public var projection: ClientProjection
    public var metadata: PersistedSyncMetadata

    public init(projection: ClientProjection, metadata: PersistedSyncMetadata) {
        self.projection = projection
        self.metadata = metadata
    }
}

public enum OutboxStatus: String, Codable, Sendable {
    case pending
    case rejected
}

public struct OutboxRecord: Equatable, Sendable {
    public let operation: StudentOperation
    public let status: OutboxStatus
    public let error: OperationError?
    public let attemptCount: Int

    public init(operation: StudentOperation, status: OutboxStatus, error: OperationError?, attemptCount: Int) {
        self.operation = operation
        self.status = status
        self.error = error
        self.attemptCount = attemptCount
    }
}

public actor ClientStore {
    private let context: ModelContext

    public init(container: ModelContainer) throws {
        context = ModelContext(container)
        context.autosaveEnabled = false
        if try context.fetch(FetchDescriptor<StoredClientState>()).isEmpty {
            context.insert(StoredClientState(
                projectionData: try JSONCoding.encoder.encode(ClientProjection()),
                metadataData: try JSONCoding.encoder.encode(PersistedSyncMetadata())
            ))
            try context.save()
        }
    }

    public func snapshot() throws -> ClientStoreSnapshot {
        let state = try storedState()
        return try ClientStoreSnapshot(
            projection: JSONCoding.decoder.decode(ClientProjection.self, from: state.projectionData),
            metadata: JSONCoding.decoder.decode(PersistedSyncMetadata.self, from: state.metadataData)
        )
    }

    public func replaceRemoteState(
        projection: ClientProjection,
        metadata: PersistedSyncMetadata
    ) throws {
        let state = try storedState()
        state.projectionData = try JSONCoding.encoder.encode(projection)
        state.metadataData = try JSONCoding.encoder.encode(metadata)
        state.updatedAt = Date()
        try context.save()
    }


    public func beginAccountSnapshot() throws {
        try replaceRemoteState(
            projection: ClientProjection(),
            metadata: PersistedSyncMetadata(
                cursor: nil,
                accountSnapshot: SnapshotPageCheckpoint(snapshotToken: nil, pageToken: nil)
            )
        )
    }

    @discardableResult
    public func commit(_ response: AccountSnapshotResponse) throws -> ClientStoreSnapshot {
        var current = try snapshot()
        for record in response.records { current.projection.apply(record) }
        if response.snapshotComplete {
            current.metadata.accountSnapshot = nil
            current.metadata.cursor = response.nextCursor
        } else {
            current.metadata.accountSnapshot = SnapshotPageCheckpoint(
                snapshotToken: response.snapshotToken,
                pageToken: response.nextPageToken
            )
        }
        try replaceRemoteState(projection: current.projection, metadata: current.metadata)
        return current
    }

    public func beginClassSectionSnapshot(_ classSectionID: UUIDv7) throws {
        var current = try snapshot()
        current.metadata.classSectionSnapshots[classSectionID] = SnapshotPageCheckpoint(
            snapshotToken: nil,
            pageToken: nil
        )
        if !current.metadata.pendingClassSectionSnapshotIDs.contains(classSectionID) {
            current.metadata.pendingClassSectionSnapshotIDs.append(classSectionID)
        }
        try replaceRemoteState(projection: current.projection, metadata: current.metadata)
    }

    @discardableResult
    public func commit(_ response: ClassSectionSnapshotResponse) throws -> ClientStoreSnapshot {
        var current = try snapshot()
        for record in response.records { current.projection.apply(record) }
        if response.snapshotComplete {
            current.metadata.classSectionSnapshots.removeValue(forKey: response.classSectionID)
            current.metadata.pendingClassSectionSnapshotIDs.removeAll { $0 == response.classSectionID }
            if let resumeCursor = response.resumeCursor { current.metadata.cursor = resumeCursor }
        } else {
            current.metadata.classSectionSnapshots[response.classSectionID] = SnapshotPageCheckpoint(
                snapshotToken: response.snapshotToken,
                pageToken: response.nextPageToken,
                resumeCursor: response.resumeCursor
            )
        }
        try replaceRemoteState(projection: current.projection, metadata: current.metadata)
        return current
    }

    public func effectiveSnapshot(now: Date = Date(), currentUserID: UUIDv7? = nil) throws -> ClientStoreSnapshot {
        var current = try snapshot()
        for operation in try pendingOperations() {
            current.projection.applyOptimistically(operation, now: now, currentUserID: currentUserID)
        }
        return current
    }

    public func retry(operationID: UUIDv7) throws {
        guard let item = try context.fetch(FetchDescriptor<StoredOutboxItem>()).first(where: { $0.operationID == operationID.uuidString }) else { return }
        item.statusRawValue = OutboxStatus.pending.rawValue
        item.errorData = nil
        item.updatedAt = Date()
        try context.save()
    }

    public func discard(operationID: UUIDv7) throws {
        guard let item = try context.fetch(FetchDescriptor<StoredOutboxItem>()).first(where: { $0.operationID == operationID.uuidString }) else { return }
        context.delete(item)
        try context.save()
    }

    public func enqueue(_ operation: StudentOperation) throws {
        let items = try context.fetch(FetchDescriptor<StoredOutboxItem>())
        guard !items.contains(where: { $0.operationID == operation.operationID.uuidString }) else { return }
        context.insert(StoredOutboxItem(
            operationID: operation.operationID.uuidString,
            operationData: try JSONCoding.encoder.encode(operation),
            statusRawValue: OutboxStatus.pending.rawValue
        ))
        try context.save()
    }

    public func pendingOperations(limit: Int = StudentOperationBatch.maximumCount) throws -> [StudentOperation] {
        try outboxRecords()
            .filter { $0.status == .pending }
            .prefix(limit)
            .map(\.operation)
    }

    public func outboxRecords() throws -> [OutboxRecord] {
        let descriptor = FetchDescriptor<StoredOutboxItem>(
            sortBy: [SortDescriptor(\StoredOutboxItem.createdAt)]
        )
        return try context.fetch(descriptor).map { item in
            OutboxRecord(
                operation: try JSONCoding.decoder.decode(StudentOperation.self, from: item.operationData),
                status: OutboxStatus(rawValue: item.statusRawValue) ?? .rejected,
                error: try item.errorData.map { try JSONCoding.decoder.decode(OperationError.self, from: $0) },
                attemptCount: item.attemptCount
            )
        }
    }

    @discardableResult
    public func commit(_ response: IncrementalSyncResponse) throws -> ClientStoreSnapshot {
        var current = try snapshot()
        for event in response.events { current.projection.apply(event) }
        current.metadata.cursor = response.nextCursor
        let items = try context.fetch(FetchDescriptor<StoredOutboxItem>())

        for result in response.operationResults {
            guard let item = items.first(where: { $0.operationID == result.operationID.uuidString }) else { continue }
            switch result.status {
            case .applied, .replayed:
                context.delete(item)
                if let followUp = result.followUp,
                   !current.metadata.pendingClassSectionSnapshotIDs.contains(followUp.classSectionID) {
                    current.metadata.pendingClassSectionSnapshotIDs.append(followUp.classSectionID)
                }
            case .rejected, .dependencyFailed:
                item.statusRawValue = OutboxStatus.rejected.rawValue
                item.errorData = try result.error.map { try JSONCoding.encoder.encode($0) }
                item.updatedAt = Date()
            }
        }

        let state = try storedState()
        state.projectionData = try JSONCoding.encoder.encode(current.projection)
        state.metadataData = try JSONCoding.encoder.encode(current.metadata)
        state.updatedAt = Date()
        try context.save()
        return current
    }

    public func resetRemoteState() throws {
        try replaceRemoteState(projection: ClientProjection(), metadata: PersistedSyncMetadata())
    }

    public func clearAll() throws {
        for item in try context.fetch(FetchDescriptor<StoredOutboxItem>()) { context.delete(item) }
        try resetRemoteState()
    }

    private func storedState() throws -> StoredClientState {
        guard let state = try context.fetch(FetchDescriptor<StoredClientState>()).first else {
            throw CocoaError(.fileNoSuchFile)
        }
        return state
    }
}

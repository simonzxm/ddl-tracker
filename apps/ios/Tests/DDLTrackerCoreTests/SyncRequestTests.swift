import Foundation
import Testing
@testable import DDLTrackerCore

@Test("operation batches accept ordered dependencies")
func operationBatchesAcceptOrderedDependencies() throws {
    let first = follow(operationID: id(1), sectionID: id(101))
    let second = follow(operationID: id(2), sectionID: id(102), dependsOn: [id(1)])
    try StudentOperationBatch.validate([first, second])
}

@Test("operation batches reject invalid identities and dependency order")
func operationBatchesRejectInvalidIdentities() {
    let duplicate = follow(operationID: id(1), sectionID: id(101))
    #expect(throws: StudentOperationBatchError.duplicateOperationID(id(1))) {
        try StudentOperationBatch.validate([duplicate, duplicate])
    }
    let forward = follow(operationID: id(2), sectionID: id(102), dependsOn: [id(3)])
    #expect(throws: StudentOperationBatchError.dependencyMustReferenceEarlierOperation(id(3))) {
        try StudentOperationBatch.validate([forward])
    }
    let repeated = follow(operationID: id(4), sectionID: id(104), dependsOn: [id(1), id(1)])
    #expect(throws: StudentOperationBatchError.duplicateDependency(id(1))) {
        try StudentOperationBatch.validate([duplicate, repeated])
    }
    let reused = follow(operationID: id(5), sectionID: id(5))
    #expect(throws: StudentOperationBatchError.operationIDReusedAsEntityID(id(5))) {
        try StudentOperationBatch.validate([reused])
    }
}

@Test("sync requests encode strict mode envelopes")
func syncRequestsEncodeModes() throws {
    let account = SyncRequest.accountSnapshot(.init(snapshotToken: nil, pageToken: nil, snapshotLimit: 200))
    let section = SyncRequest.classSectionSnapshot(.init(cursor: "cursor", classSectionID: id(101), snapshotToken: nil, pageToken: nil, snapshotLimit: 100))
    let operation = follow(operationID: id(1), sectionID: id(101))
    let incremental = try SyncRequest.incremental(.init(cursor: "cursor", eventLimit: 500, operations: [operation]))

    for (request, mode) in [(account, "account_snapshot"), (section, "class_section_snapshot"), (incremental, "incremental")] {
        let object = try #require(JSONSerialization.jsonObject(with: JSONCoding.encoder.encode(request)) as? [String: Any])
        #expect(object["protocol_version"] as? Int == 2)
        #expect(object["mode"] as? String == mode)
    }
    let accountObject = try #require(JSONSerialization.jsonObject(with: JSONCoding.encoder.encode(account)) as? [String: Any])
    #expect((accountObject["operations"] as? [Any])?.isEmpty == true)
}

@Test("sync request constructors reject invalid limits")
func syncRequestConstructorsRejectInvalidLimits() {
    #expect(throws: SyncRequestValidationError.invalidPageLimit(0)) {
        _ = try AccountSnapshotRequest(validatingSnapshotToken: nil, pageToken: nil, snapshotLimit: 0)
    }
    #expect(throws: SyncRequestValidationError.invalidPageLimit(501)) {
        _ = try IncrementalSyncRequest(validatingCursor: "cursor", eventLimit: 501, operations: [])
    }
}

private func follow(operationID: UUIDv7, sectionID: UUIDv7, dependsOn: [UUIDv7] = []) -> StudentOperation {
    .followClassSection(.init(operationID: operationID, dependsOn: dependsOn, payload: .init(classSectionID: sectionID)))
}

private func id(_ suffix: Int) -> UUIDv7 {
    UUIDv7(String(format: "018f0000-0000-7000-8000-%012x", suffix))!
}

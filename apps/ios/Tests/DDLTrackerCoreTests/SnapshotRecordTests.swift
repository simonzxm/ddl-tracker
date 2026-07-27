import Foundation
import Testing
@testable import DDLTrackerCore

private struct SnapshotVector: Decodable {
    let protocolVersion: Int
    let records: [SnapshotRecord]
}

@Test("all official snapshot records decode as strict tagged values")
func officialSnapshotRecordsDecode() throws {
    let url = try #require(Bundle.module.url(forResource: "snapshot-records-v2", withExtension: "json"))
    let vector = try JSONCoding.decoder.decode(SnapshotVector.self, from: Data(contentsOf: url))
    #expect(vector.protocolVersion == 2)
    #expect(vector.records.count == 16)
    #expect(Set(vector.records.map(\.kind)) == Set(SnapshotRecord.Kind.allCases))
    let encoded = try JSONCoding.encoder.encode(vector.records)
    let roundTrip = try JSONCoding.decoder.decode([SnapshotRecord].self, from: encoded)
    #expect(roundTrip == vector.records)
}

@Test("snapshot records reject unknown schema versions")
func snapshotRecordsRejectUnknownVersions() {
    let data = Data(#"{"record_type":"catalog_revision","schema_version":2,"payload":{"revision":7,"updated_at":"2026-09-01T00:30:00Z"}}"#.utf8)
    #expect(throws: DecodingError.self) {
        try JSONCoding.decoder.decode(SnapshotRecord.self, from: data)
    }
}

@Test("snapshot records reject unknown discriminators")
func snapshotRecordsRejectUnknownKinds() {
    let data = Data(#"{"record_type":"mystery","schema_version":1,"payload":{}}"#.utf8)
    #expect(throws: DecodingError.self) {
        try JSONCoding.decoder.decode(SnapshotRecord.self, from: data)
    }
}

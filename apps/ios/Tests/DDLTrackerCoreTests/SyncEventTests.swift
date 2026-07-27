import Foundation
import Testing
@testable import DDLTrackerCore

private struct EventVector: Decodable {
    let protocolVersion: Int
    let events: [SyncEvent]
}

@Test("all official sync events decode as strict tagged values")
func officialSyncEventsDecode() throws {
    let url = try #require(Bundle.module.url(forResource: "sync-events-v2", withExtension: "json"))
    let vector = try JSONCoding.decoder.decode(EventVector.self, from: Data(contentsOf: url))
    #expect(vector.protocolVersion == 2)
    #expect(vector.events.count == 28)
    #expect(Set(vector.events.map(\.kind)) == Set(SyncEvent.Kind.allCases))
    let encoded = try JSONCoding.encoder.encode(vector.events)
    let roundTrip = try JSONCoding.decoder.decode([SyncEvent].self, from: encoded)
    #expect(roundTrip == vector.events)
}

@Test("sync events reject unknown schema versions")
func syncEventsRejectUnknownVersions() {
    let data = Data(#"{"event_id":"018f0000-0000-7000-8000-000000000101","schema_version":1,"type":"catalog_revision_changed","occurred_at":"2026-09-01T00:30:00Z","payload":{"revision":7,"updated_at":"2026-09-01T00:30:00Z"}}"#.utf8)
    #expect(throws: DecodingError.self) {
        try JSONCoding.decoder.decode(SyncEvent.self, from: data)
    }
}

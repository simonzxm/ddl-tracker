import Foundation
import Testing
@testable import DDLTrackerCore

@Test("official sync responses decode by mode")
func officialSyncResponsesDecode() throws {
    let url = try #require(Bundle.module.url(forResource: "sync-responses-v2", withExtension: "json"))
    let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let responses = try #require(root["responses"] as? [[String: Any]])
    let decoded = try responses.map { entry in
        let value = try #require(entry["value"])
        return try JSONCoding.decoder.decode(
            SyncResponse.self,
            from: JSONSerialization.data(withJSONObject: value)
        )
    }
    #expect(decoded.count == 5)
    #expect(decoded.map(\.mode) == [
        .accountSnapshot,
        .accountSnapshot,
        .accountSnapshot,
        .classSectionSnapshot,
        .incremental,
    ])

    guard case let .incremental(response) = decoded.last else {
        Issue.record("Expected incremental response")
        return
    }
    #expect(response.operationResults.map(\.status) == [.applied, .replayed, .rejected, .dependencyFailed])
    #expect(response.events.count == 1)
    #expect(response.nextCursor == "cursor-next")
}

@Test("sync responses reject unsupported protocol versions")
func syncResponsesRejectUnsupportedProtocol() throws {
    let url = try #require(Bundle.module.url(forResource: "sync-responses-v2", withExtension: "json"))
    let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let invalid = try #require(root["invalid_responses"] as? [[String: Any]])
    let value = try #require(invalid.first?["value"])
    let data = try JSONSerialization.data(withJSONObject: value)
    #expect(throws: DecodingError.self) {
        try JSONCoding.decoder.decode(SyncResponse.self, from: data)
    }
}

@Test("cursor expired API error remains structured")
func cursorExpiredErrorDecodes() throws {
    let url = try #require(Bundle.module.url(forResource: "sync-responses-v2", withExtension: "json"))
    let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let errors = try #require(root["errors"] as? [[String: Any]])
    let value = try #require(errors.first?["value"])
    let error = try JSONCoding.decoder.decode(
        APIError.self,
        from: JSONSerialization.data(withJSONObject: value)
    )
    #expect(error.code == .cursorExpired)
    #expect(error.details["minimum_sequence"] == .integer(42))
    #expect(error.retryable == false)
}

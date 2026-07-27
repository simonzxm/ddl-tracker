import Foundation
import Testing
@testable import DDLTrackerCore

@Test("UUIDv7 generator returns canonical version seven identifiers")
func uuidV7IsCanonical() {
    let value = UUIDv7.generate()
    #expect(value.uuidString == value.uuidString.lowercased())
    #expect(value.uuidString.count == 36)
    #expect(value.uuidString[value.uuidString.index(value.uuidString.startIndex, offsetBy: 14)] == "7")
    let variant = value.uuidString[value.uuidString.index(value.uuidString.startIndex, offsetBy: 19)]
    #expect(["8", "9", "a", "b"].contains(String(variant)))
}

@Test("RFC3339 coding accepts fractional and whole seconds")
func rfc3339CodingAcceptsServerDates() throws {
    struct Envelope: Codable, Equatable { let value: Date }
    let decoder = JSONCoding.decoder
    let whole = try decoder.decode(Envelope.self, from: Data(#"{"value":"2026-09-01T00:30:00Z"}"#.utf8))
    let fractional = try decoder.decode(Envelope.self, from: Data(#"{"value":"2026-09-01T00:30:00.123Z"}"#.utf8))
    #expect(abs(fractional.value.timeIntervalSince(whole.value) - 0.123) < 0.000_001)
    let encoded = try JSONCoding.encoder.encode(fractional)
    let roundTrip = try decoder.decode(Envelope.self, from: encoded)
    #expect(abs(roundTrip.value.timeIntervalSince(fractional.value)) < 0.001)
}

@Test("JSONValue round trips nested API details")
func jsonValueRoundTrips() throws {
    let source = Data(#"{"code":"revision_conflict","details":{"current_revision":2,"retry":false,"ids":["a",null]}}"#.utf8)
    let decoded = try JSONCoding.decoder.decode([String: JSONValue].self, from: source)
    let encoded = try JSONCoding.encoder.encode(decoded)
    let again = try JSONCoding.decoder.decode([String: JSONValue].self, from: encoded)
    #expect(again == decoded)
}

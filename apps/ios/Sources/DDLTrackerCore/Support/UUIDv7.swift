public import Foundation

public struct UUIDv7: Codable, Hashable, Comparable, Sendable, CustomStringConvertible {
    public let uuidString: String

    public init?(_ value: String) {
        let normalized = value.lowercased()
        guard UUID(uuidString: normalized) != nil,
              normalized.count == 36,
              normalized[normalized.index(normalized.startIndex, offsetBy: 14)] == "7",
              "89ab".contains(normalized[normalized.index(normalized.startIndex, offsetBy: 19)])
        else { return nil }
        uuidString = normalized
    }

    public static func generate(now: Date = Date()) -> UUIDv7 {
        let milliseconds = UInt64(max(0, now.timeIntervalSince1970 * 1_000))
        var random = SystemRandomNumberGenerator()
        var bytes = (0 ..< 16).map { _ in UInt8.random(in: .min ... .max, using: &random) }
        bytes[0] = UInt8((milliseconds >> 40) & 0xff)
        bytes[1] = UInt8((milliseconds >> 32) & 0xff)
        bytes[2] = UInt8((milliseconds >> 24) & 0xff)
        bytes[3] = UInt8((milliseconds >> 16) & 0xff)
        bytes[4] = UInt8((milliseconds >> 8) & 0xff)
        bytes[5] = UInt8(milliseconds & 0xff)
        bytes[6] = (bytes[6] & 0x0f) | 0x70
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        let value = [
            bytes[0 ..< 4].hex,
            bytes[4 ..< 6].hex,
            bytes[6 ..< 8].hex,
            bytes[8 ..< 10].hex,
            bytes[10 ..< 16].hex,
        ].joined(separator: "-")
        return UUIDv7(value)!
    }

    public static func < (lhs: UUIDv7, rhs: UUIDv7) -> Bool {
        lhs.uuidString < rhs.uuidString
    }

    public var description: String { uuidString }

    public init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        guard let uuid = UUIDv7(value) else {
            throw DecodingError.dataCorruptedError(
                in: try decoder.singleValueContainer(),
                debugDescription: "Expected a canonical UUIDv7 string."
            )
        }
        self = uuid
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(uuidString)
    }
}

private extension Collection where Element == UInt8 {
    var hex: String {
        map { String(format: "%02x", $0) }.joined()
    }
}

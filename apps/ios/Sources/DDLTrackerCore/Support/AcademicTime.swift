public import Foundation

public enum AcademicTime {
    public static let timeZone = TimeZone(identifier: "Asia/Shanghai")
        ?? TimeZone(secondsFromGMT: 8 * 60 * 60)
        ?? .gmt

    public static func dateTime(_ date: Date) -> String {
        date.formatted(
            Date.FormatStyle(
                date: .abbreviated,
                time: .shortened,
                timeZone: timeZone
            )
        )
    }

    public static func time(_ date: Date) -> String {
        date.formatted(
            Date.FormatStyle(
                date: .omitted,
                time: .shortened,
                timeZone: timeZone
            )
        )
    }
}

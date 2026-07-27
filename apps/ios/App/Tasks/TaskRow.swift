import DDLTrackerCore
import SwiftUI

struct TaskRow: View {
    let item: TaskListItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: stateSymbol)
                .foregroundStyle(stateColor)
                .font(.title3)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text(item.title)
                    .font(.headline)
                    .strikethrough(item.state == .completed)
                    .foregroundStyle(item.state == .ignored ? .secondary : .primary)

                if let deadline = item.deadline {
                    Label {
                        Text(AcademicTime.dateTime(deadline))
                    } icon: {
                        Image(systemName: "calendar")
                    }
                    .font(.subheadline)
                    .foregroundStyle(deadline < Date() && item.state == .pending ? .red : .secondary)
                }

                if let note = item.note, !note.isEmpty {
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                HStack(spacing: 7) {
                    Label(item.kind == .shared ? "共享" : "个人", systemImage: item.kind == .shared ? "person.2" : "lock")
                    if let confidence = item.confidence {
                        Text(confidence.displayName)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var stateSymbol: String {
        switch item.state {
        case .pending: "circle"
        case .completed: "checkmark.circle.fill"
        case .ignored: "minus.circle.fill"
        }
    }

    private var stateColor: Color {
        switch item.state {
        case .pending: .secondary
        case .completed: .green
        case .ignored: .secondary
        }
    }
}

private extension ProposalConfidence {
    var displayName: String {
        switch self {
        case .pendingVerification: "待验证"
        case .disputed: "有争议"
        case .supported: "可信"
        }
    }
}

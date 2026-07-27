public import Foundation

public struct ProposalRankingInput: Equatable, Sendable {
    public let id: UUIDv7
    public let up: Int
    public let down: Int
    public let createdAt: Date

    public init(id: UUIDv7, up: Int, down: Int, createdAt: Date) {
        self.id = id
        self.up = up
        self.down = down
        self.createdAt = createdAt
    }
}

public struct RankedProposal: Equatable, Sendable {
    public let id: UUIDv7
    public let up: Int
    public let down: Int
    public let createdAt: Date
    public let score: Double

    public init(id: UUIDv7, up: Int, down: Int, createdAt: Date, score: Double) {
        self.id = id
        self.up = up
        self.down = down
        self.createdAt = createdAt
        self.score = score
    }
}

public enum ProposalConfidence: String, Codable, Sendable {
    case pendingVerification = "pending_verification"
    case disputed
    case supported
}

public enum ProposalRankingError: Error, Equatable, Sendable {
    case negativeVoteCount
    case invalidZScore
}

public enum ProposalRanker {
    public static let version = 1
    public static let z = 1.96

    public static func wilsonScore(up: Int, down: Int, z: Double = z) throws -> Double {
        guard up >= 0, down >= 0 else { throw ProposalRankingError.negativeVoteCount }
        guard z.isFinite, z > 0 else { throw ProposalRankingError.invalidZScore }
        let total = up + down
        guard total > 0 else { return 0 }
        let totalValue = Double(total)
        let proportion = Double(up) / totalValue
        let zSquared = z * z
        let numerator = proportion
            + zSquared / (2 * totalValue)
            - z * sqrt((proportion * (1 - proportion) + zSquared / (4 * totalValue)) / totalValue)
        let denominator = 1 + zSquared / totalValue
        return max(0, numerator / denominator)
    }

    public static func rank(_ proposals: [ProposalRankingInput]) throws -> [RankedProposal] {
        try proposals.map { proposal in
            RankedProposal(
                id: proposal.id,
                up: proposal.up,
                down: proposal.down,
                createdAt: proposal.createdAt,
                score: try wilsonScore(up: proposal.up, down: proposal.down)
            )
        }.sorted { left, right in
            if left.score != right.score { return left.score > right.score }
            let leftTotal = left.up + left.down
            let rightTotal = right.up + right.down
            if leftTotal != rightTotal { return leftTotal > rightTotal }
            if left.createdAt != right.createdAt { return left.createdAt < right.createdAt }
            return left.id < right.id
        }
    }

    public static func confidence(
        leader: RankedProposal,
        runnerUp: RankedProposal?
    ) -> ProposalConfidence {
        let total = leader.up + leader.down
        if total < 3 { return .pendingVerification }
        if leader.down * 3 >= total { return .disputed }
        if let runnerUp, runnerUp.score > leader.score - 0.05 { return .disputed }
        return .supported
    }
}

import Foundation
import Testing
@testable import DDLTrackerCore

private struct RankingVector: Decodable {
    struct Case: Decodable {
        let up: Int
        let down: Int
        let score: Double
    }
    let schemaVersion: Int
    let z: Double
    let cases: [Case]
}

@Test("Wilson ranking matches official vectors")
func wilsonRankingMatchesOfficialVectors() throws {
    let url = try #require(Bundle.module.url(forResource: "ranking-v1", withExtension: "json"))
    let vectors = try JSONCoding.decoder.decode(RankingVector.self, from: Data(contentsOf: url))
    #expect(vectors.schemaVersion == ProposalRanker.version)
    for vector in vectors.cases {
        let score = try ProposalRanker.wilsonScore(up: vector.up, down: vector.down, z: vectors.z)
        #expect(abs(score - vector.score) < 0.000_000_000_001)
    }
}

@Test("proposal ranking uses official tie breaks")
func proposalRankingUsesOfficialTieBreaks() throws {
    let values = [
        input("018f0000-0000-7000-8000-000000000004", 4, 0, "2026-07-19T00:00:00Z"),
        input("018f0000-0000-7000-8000-000000000003", 3, 0, "2026-07-18T00:00:00Z"),
        input("018f0000-0000-7000-8000-000000000002", 3, 0, "2026-07-18T00:00:00Z"),
        input("018f0000-0000-7000-8000-000000000001", 2, 0, "2026-07-17T00:00:00Z"),
        input("018f0000-0000-7000-8000-000000000006", 0, 1, "2026-07-16T00:00:00Z"),
        input("018f0000-0000-7000-8000-000000000005", 0, 2, "2026-07-19T00:00:00Z"),
    ]
    let ids = try ProposalRanker.rank(values).map(\.id.uuidString)
    #expect(ids == [
        "018f0000-0000-7000-8000-000000000004",
        "018f0000-0000-7000-8000-000000000002",
        "018f0000-0000-7000-8000-000000000003",
        "018f0000-0000-7000-8000-000000000001",
        "018f0000-0000-7000-8000-000000000005",
        "018f0000-0000-7000-8000-000000000006",
    ])
}

@Test("proposal confidence follows verification and dispute rules")
func proposalConfidenceRules() {
    #expect(ProposalRanker.confidence(leader: ranked(up: 2), runnerUp: nil) == .pendingVerification)
    #expect(ProposalRanker.confidence(leader: ranked(up: 2, down: 1), runnerUp: nil) == .disputed)
    #expect(ProposalRanker.confidence(leader: ranked(score: 0.5), runnerUp: ranked(score: 0.451)) == .disputed)
    #expect(ProposalRanker.confidence(leader: ranked(score: 0.5), runnerUp: ranked(score: 0.45)) == .supported)
    #expect(ProposalRanker.confidence(leader: ranked(score: 0.5), runnerUp: nil) == .supported)
}

private func input(_ id: String, _ up: Int, _ down: Int, _ date: String) -> ProposalRankingInput {
    ProposalRankingInput(
        id: UUIDv7(id)!,
        up: up,
        down: down,
        createdAt: RFC3339.date(from: date)!
    )
}

private func ranked(up: Int = 3, down: Int = 0, score: Double = 0.5) -> RankedProposal {
    RankedProposal(
        id: UUIDv7("018f0000-0000-7000-8000-000000000000")!,
        up: up,
        down: down,
        createdAt: RFC3339.date(from: "2026-07-19T00:00:00Z")!,
        score: score
    )
}

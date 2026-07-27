import Foundation
import Testing
@testable import DDLTrackerCore

@Test("official snapshot rebuilds the local projection")
func officialSnapshotRebuildsProjection() throws {
    let url = try #require(Bundle.module.url(forResource: "snapshot-records-v2", withExtension: "json"))
    let object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let recordsObject = try #require(object["records"])
    let records = try JSONCoding.decoder.decode(
        [SnapshotRecord].self,
        from: JSONSerialization.data(withJSONObject: recordsObject)
    )
    var projection = ClientProjection()
    for record in records { projection.apply(record) }

    #expect(projection.catalogRevision?.revision == 7)
    #expect(projection.publicUsers.count == 1)
    #expect(projection.followedClassSections.count == 1)
    #expect(projection.classSections.count == 1)
    #expect(projection.courseTasks.count == 1)
    #expect(projection.taskProposals.count == 1)
    #expect(projection.personalTodos.count == 1)
    #expect(projection.taskComments.count == 1)
    #expect(projection.reporterReports.count == 1)
}

@Test("revision monotonicity and tombstones prevent stale resurrection")
func revisionMonotonicityAndTombstones() {
    let taskID = id(1)
    let sectionID = id(2)
    let old = task(id: taskID, sectionID: sectionID, revision: 1)
    let current = task(id: taskID, sectionID: sectionID, revision: 2)
    let restored = task(id: taskID, sectionID: sectionID, revision: 4)
    var projection = ClientProjection()

    projection.apply(.courseTask(current))
    projection.apply(.courseTask(old))
    #expect(projection.courseTasks[taskID]?.revision == 2)

    projection.apply(.contentTombstone(.init(entityType: .courseTask, entityID: taskID, state: .hidden, revision: 3)))
    #expect(projection.courseTasks[taskID] == nil)
    projection.apply(.courseTask(current))
    #expect(projection.courseTasks[taskID] == nil)
    projection.apply(.courseTask(restored))
    #expect(projection.courseTasks[taskID]?.revision == 4)
    #expect(projection.contentTombstones[.init(type: .courseTask, id: taskID)] == nil)
}

@Test("duplicate events are idempotent")
func duplicateEventsAreIdempotent() throws {
    let url = try #require(Bundle.module.url(forResource: "sync-events-v2", withExtension: "json"))
    let object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let eventsObject = try #require(object["events"])
    let events = try JSONCoding.decoder.decode(
        [SyncEvent].self,
        from: JSONSerialization.data(withJSONObject: eventsObject)
    )
    var projection = ClientProjection()
    projection.apply(events[0])
    projection.apply(events[0])
    #expect(projection.processedEventIDs == [events[0].eventID])
    #expect(projection.followedClassSections.count == 1)
}

@Test("redirect resolution follows chains and rejects cycles")
func redirectResolution() throws {
    let first = id(1)
    let second = id(2)
    let third = id(3)
    let now = Date(timeIntervalSince1970: 1)
    var projection = ClientProjection()
    projection.apply(.proposalRedirect(.init(sourceProposalID: first, canonicalProposalID: second, revision: 1, createdAt: now)))
    projection.apply(.proposalRedirect(.init(sourceProposalID: second, canonicalProposalID: third, revision: 1, createdAt: now)))
    #expect(try projection.canonicalProposalID(for: first) == third)
    projection.apply(.proposalRedirect(.init(sourceProposalID: third, canonicalProposalID: first, revision: 1, createdAt: now)))
    #expect(throws: ProjectionResolutionError.redirectCycle) {
        try projection.canonicalProposalID(for: first)
    }
}

private func task(id: UUIDv7, sectionID: UUIDv7, revision: Int) -> CourseTask {
    CourseTask(
        id: id,
        classSectionID: sectionID,
        createdBy: nil,
        state: .visible,
        revision: revision,
        createdAt: Date(timeIntervalSince1970: 1),
        updatedAt: Date(timeIntervalSince1970: Double(revision))
    )
}

private func id(_ suffix: Int) -> UUIDv7 {
    UUIDv7(String(format: "018f0000-0000-7000-8000-%012x", suffix))!
}

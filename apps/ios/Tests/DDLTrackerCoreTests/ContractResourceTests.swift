import Foundation
import Testing
@testable import DDLTrackerCore

@Test("bundled OpenAPI matches client contract")
func bundledOpenAPIMatchesClientContract() throws {
    let url = try #require(Bundle.module.url(forResource: "openapi", withExtension: "json"))
    let data = try Data(contentsOf: url)
    let document = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let info = try #require(document["info"] as? [String: Any])
    #expect(info["version"] as? String == DDLTrackerCore.apiContractVersion)
    let paths = try #require(document["paths"] as? [String: Any])
    #expect(paths["/v1/sync"] != nil)
    #expect(paths["/v1/auth/email/challenges"] != nil)
}

@Test("official protocol vectors are bundled")
func officialProtocolVectorsAreBundled() throws {
    for name in [
        "api-compatibility-v2.0",
        "ranking-v1",
        "snapshot-records-v2",
        "sync-events-v2",
        "sync-responses-v2",
    ] {
        #expect(Bundle.module.url(forResource: name, withExtension: "json") != nil)
    }
}

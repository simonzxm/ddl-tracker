import Testing
@testable import DDLTrackerCore

@Test("client targets the deployed contract")
func clientTargetsDeployedContract() {
    #expect(DDLTrackerCore.apiContractVersion == "2.0.0")
    #expect(DDLTrackerCore.syncProtocolVersion == 2)
}

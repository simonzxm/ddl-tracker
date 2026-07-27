import Foundation
import Testing
@testable import DDLTrackerCore

@Test("Keychain session vault saves loads and deletes credentials")
func keychainSessionVaultRoundTrip() async throws {
    let service = "xyz.210023.ddltracker.tests.\(UUID().uuidString)"
    let vault = KeychainSessionVault(service: service, account: "session")
    defer { Task { try? await vault.delete() } }
    let credential = sampleCredential(expiresAt: Date().addingTimeInterval(3_600))

    try await vault.save(credential)
    let loaded = try #require(try await vault.load())
    #expect(loaded.accessToken == credential.accessToken)
    #expect(loaded.user == credential.user)
    #expect(abs(loaded.expiresAt.timeIntervalSince(credential.expiresAt)) < 0.001)
    #expect(try await vault.accessToken() == credential.accessToken)

    try await vault.delete()
    #expect(try await vault.load() == nil)
    #expect(try await vault.accessToken() == nil)
}

@Test("Keychain session vault does not return expired access tokens")
func keychainSessionVaultRejectsExpiredToken() async throws {
    let service = "xyz.210023.ddltracker.tests.\(UUID().uuidString)"
    let vault = KeychainSessionVault(service: service, account: "session")
    defer { Task { try? await vault.delete() } }
    try await vault.save(sampleCredential(expiresAt: Date().addingTimeInterval(-1)))
    #expect(try await vault.load() != nil)
    #expect(try await vault.accessToken() == nil)
}

private func sampleCredential(expiresAt: Date) -> SessionCredential {
    SessionCredential(
        accessToken: "access-token",
        tokenType: "Bearer",
        expiresAt: expiresAt,
        user: CurrentUser(
            id: UUIDv7("018f0000-0000-7000-8000-000000000001")!,
            username: "student",
            displayName: "Student",
            avatarURL: nil,
            bio: nil,
            status: .active,
            profileRevision: 1,
            roles: []
        )
    )
}

import DDLTrackerCore
import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case launching
        case signedOut
        case signedIn
        case unavailable(String)
    }

    enum Connectivity: Equatable {
        case unknown
        case online
        case offline
    }

    enum AuthStage: Equatable {
        case email
        case code(challengeID: UUIDv7, email: String, expiresAt: Date)
        case registration(token: String, email: String, expiresAt: Date)
    }

    var phase: Phase
    var connectivity: Connectivity = .unknown
    var authStage: AuthStage = .email
    var isAuthenticating = false
    var currentUser: CurrentUser?
    var projection = ClientProjection()
    var taskItems: [TaskListItem] = []
    var outbox: [OutboxRecord] = []
    var isSyncing = false
    var lastSyncedAt: Date?
    var alertMessage: String?

    @ObservationIgnored let vault: KeychainSessionVault
    @ObservationIgnored let api: APIClient
    @ObservationIgnored private let store: ClientStore?
    @ObservationIgnored private let syncEngine: SyncEngine?
    @ObservationIgnored private let previewMode: Bool
    @ObservationIgnored private var refreshedCatalogRevision: Int?

    static func live() -> AppModel {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-preview") {
            return preview()
        }
#endif
        let vault = KeychainSessionVault()
        let api = APIClient(tokenProvider: vault)
        do {
            let store = try ClientStore.live()
            return AppModel(
                phase: .launching,
                vault: vault,
                api: api,
                store: store,
                syncEngine: SyncEngine(api: api, store: store)
            )
        } catch {
            return AppModel(
                phase: .unavailable("无法打开本地数据库。\n\(error.localizedDescription)"),
                vault: vault,
                api: api,
                store: nil,
                syncEngine: nil
            )
        }
    }

    init(
        phase: Phase,
        vault: KeychainSessionVault,
        api: APIClient,
        store: ClientStore?,
        syncEngine: SyncEngine?,
        previewMode: Bool = false
    ) {
        self.phase = phase
        self.vault = vault
        self.api = api
        self.store = store
        self.syncEngine = syncEngine
        self.previewMode = previewMode
    }

    func launch() async {
        guard !previewMode else { return }
        if case .unavailable = phase { return }
        guard let store else { return }

        let credential: SessionCredential?
        do {
            credential = try await vault.load()
        } catch {
            try? await vault.delete()
            currentUser = nil
            phase = .signedOut
            return
        }

        guard let credential,
              credential.expiresAt > Date(),
              (try? await vault.accessToken()) != nil else {
            try? await vault.delete()
            phase = .signedOut
            return
        }

        do {
            currentUser = credential.user
            phase = .signedIn
            try await reloadLocal(from: store)
            await refreshCurrentUser()
            await synchronize()
        } catch {
            currentUser = nil
            phase = .signedOut
            alertMessage = userMessage(for: error)
        }
    }

    func requestLoginCode(email rawEmail: String) async {
        let email = rawEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !email.isEmpty, !isAuthenticating else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            let response = try await api.requestEmailChallenge(.init(email: email))
            authStage = .code(challengeID: response.challengeID, email: email, expiresAt: response.expiresAt)
            connectivity = .online
        } catch {
            alertMessage = userMessage(for: error)
        }
    }

    func verifyLoginCode(_ rawCode: String) async {
        guard case let .code(challengeID, email, _) = authStage, !isAuthenticating else { return }
        let code = rawCode.filter(\.isNumber)
        guard code.count == 6 else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            let response = try await api.verifyEmail(.init(
                challengeID: challengeID,
                email: email,
                code: code,
                deviceName: deviceName,
                deviceMetadata: deviceMetadata
            ))
            switch response {
            case let .session(credential):
                try await acceptSession(credential)
            case let .registration(value):
                authStage = .registration(token: value.registrationToken, email: email, expiresAt: value.expiresAt)
            }
            connectivity = .online
        } catch {
            alertMessage = userMessage(for: error)
        }
    }

    func registerAccount(username rawUsername: String, displayName rawDisplayName: String) async {
        guard case let .registration(token, _, _) = authStage, !isAuthenticating else { return }
        let username = rawUsername.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let displayName = rawDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !username.isEmpty else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            let credential = try await api.registerAccount(.init(
                registrationToken: token,
                username: username,
                displayName: displayName.isEmpty ? nil : displayName,
                deviceName: deviceName,
                deviceMetadata: deviceMetadata
            ))
            try await acceptSession(credential)
            connectivity = .online
        } catch {
            alertMessage = userMessage(for: error)
        }
    }

    func resetAuthentication() {
        authStage = .email
        isAuthenticating = false
    }

    func acceptSession(_ credential: SessionCredential) async throws {
        guard let store else { throw AppModelError.storeUnavailable }
        try await store.clearAll()
        try await vault.save(credential)
        currentUser = credential.user
        phase = .signedIn
        try await reloadLocal(from: store)
        await synchronize()
    }

    func signOut(revokeAll: Bool = false) async {
        if revokeAll { try? await api.revokeAllSessions() }
        try? await vault.delete()
        if let store { try? await store.clearAll() }
        currentUser = nil
        projection = ClientProjection()
        taskItems = []
        outbox = []
        phase = .signedOut
        authStage = .email
        connectivity = .unknown
        lastSyncedAt = nil
    }

    func updateProfile(
        username: String,
        displayName: String,
        avatarURL: String?,
        bio: String?
    ) async throws {
        guard let user = currentUser else { throw AppModelError.storeUnavailable }
        let updated = try await api.updateProfile(.init(
            username: username,
            displayName: displayName,
            avatarURL: avatarURL,
            bio: bio,
            expectedRevision: user.profileRevision
        ))
        currentUser = updated
        if let credential = try await vault.load() {
            try await vault.save(SessionCredential(
                accessToken: credential.accessToken,
                tokenType: credential.tokenType,
                expiresAt: credential.expiresAt,
                user: updated
            ))
        }
    }

    func deleteAccount() async throws {
        try await api.deleteAccount()
        await signOut()
    }

    func refreshCurrentUser() async {
        guard phase == .signedIn else { return }
        do {
            currentUser = try await api.currentUser()
            connectivity = .online
        } catch let error as APIError where error.code == .unauthenticated {
            await signOut()
        } catch {
            if error is URLError { connectivity = .offline }
        }
    }

    func synchronize() async {
        guard !previewMode else { return }
        guard phase == .signedIn, let store, let syncEngine, !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            _ = try await syncEngine.synchronize()
            try await reloadLocal(from: store)
            await refreshCatalogIfNeeded(from: store)
            connectivity = .online
            lastSyncedAt = Date()
        } catch let error as APIError where error.code == .unauthenticated {
            await signOut()
        } catch {
            if error is URLError {
                connectivity = .offline
                try? await reloadLocal(from: store)
            } else {
                alertMessage = userMessage(for: error)
            }
        }
    }

    func reloadLocal() async {
        guard let store else { return }
        do { try await reloadLocal(from: store) }
        catch { alertMessage = userMessage(for: error) }
    }

    func enqueue(_ operation: StudentOperation) async {
        guard let store else { return }
        do {
            try await store.enqueue(operation)
            try await reloadLocal(from: store)
            await synchronize()
        } catch {
            alertMessage = userMessage(for: error)
        }
    }

    func retry(_ operationID: UUIDv7) async {
        guard let store else { return }
        do {
            try await store.retry(operationID: operationID)
            try await reloadLocal(from: store)
            await synchronize()
        } catch { alertMessage = userMessage(for: error) }
    }

    func discard(_ operationID: UUIDv7) async {
        guard let store else { return }
        do {
            try await store.discard(operationID: operationID)
            try await reloadLocal(from: store)
        } catch { alertMessage = userMessage(for: error) }
    }

    private func refreshCatalogIfNeeded(from store: ClientStore) async {
        guard let revision = projection.catalogRevision?.revision,
              refreshedCatalogRevision != revision else { return }

        let followedIDs = Set(projection.followedClassSections.keys)
        let existingSections = projection.classSections
        let courseIDs = Set(followedIDs.compactMap { existingSections[$0]?.courseID })
        guard !courseIDs.isEmpty || followedIDs.isEmpty else { return }

        do {
            var refreshed: [ClassSectionRecord] = []
            let now = Date()
            for courseID in courseIDs.sorted() {
                let summaries = try await api.classSections(courseID: courseID)
                for summary in summaries where followedIDs.contains(summary.id) {
                    let existing = existingSections[summary.id]
                    refreshed.append(ClassSectionRecord(
                        id: summary.id,
                        courseID: courseID,
                        externalSectionID: summary.externalSectionID,
                        sectionNumber: summary.sectionNumber,
                        departmentCode: summary.departmentCode,
                        departmentName: summary.departmentName,
                        instructors: summary.instructors,
                        campus: summary.campus,
                        capacity: summary.capacity,
                        scheduleText: summary.scheduleText,
                        active: summary.active,
                        revision: summary.revision,
                        createdAt: existing?.createdAt ?? now,
                        updatedAt: now
                    ))
                }
            }
            try await store.refreshClassSections(refreshed)
            refreshedCatalogRevision = revision
            try await reloadLocal(from: store)
        } catch {
            if !(error is URLError) {
                alertMessage = userMessage(for: error)
            }
        }
    }

    private func reloadLocal(from store: ClientStore) async throws {
        let snapshot = try await store.effectiveSnapshot(currentUserID: currentUser?.id)
        projection = snapshot.projection
        taskItems = try snapshot.projection.taskListItems()
        outbox = try await store.outboxRecords()
    }

    private func userMessage(for error: any Error) -> String {
        if let apiError = error as? APIError { return apiError.message }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost: return "当前处于离线状态，修改会在联网后同步。"
            default: return "网络请求失败，请稍后重试。"
            }
        }
        return error.localizedDescription
    }

    var deviceName: String { UIDevice.current.name }
    var deviceMetadata: [String: JSONValue] {
        [
            "platform": .string("iOS"),
            "system_version": .string(UIDevice.current.systemVersion),
            "model": .string(UIDevice.current.model),
        ]
    }
}

enum AppModelError: Error { case storeUnavailable }

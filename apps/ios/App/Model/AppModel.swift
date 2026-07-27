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

    var phase: Phase
    var connectivity: Connectivity = .unknown
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

    static func live() -> AppModel {
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

    private init(
        phase: Phase,
        vault: KeychainSessionVault,
        api: APIClient,
        store: ClientStore?,
        syncEngine: SyncEngine?
    ) {
        self.phase = phase
        self.vault = vault
        self.api = api
        self.store = store
        self.syncEngine = syncEngine
    }

    func launch() async {
        if case .unavailable = phase { return }
        guard let store else { return }
        do {
            guard let credential = try await vault.load(),
                  credential.expiresAt > Date(),
                  try await vault.accessToken() != nil else {
                try? await vault.delete()
                phase = .signedOut
                return
            }
            currentUser = credential.user
            phase = .signedIn
            try await reloadLocal(from: store)
            await refreshCurrentUser()
            await synchronize()
        } catch {
            phase = .signedOut
            alertMessage = userMessage(for: error)
        }
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
        connectivity = .unknown
        lastSyncedAt = nil
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
        guard phase == .signedIn, let store, let syncEngine, !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            _ = try await syncEngine.synchronize()
            try await reloadLocal(from: store)
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

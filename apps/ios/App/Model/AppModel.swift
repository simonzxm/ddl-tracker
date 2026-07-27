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

#if DEBUG
    private static func preview() -> AppModel {
        let vault = KeychainSessionVault(service: "xyz.210023.ddltracker.ui-preview")
        let api = APIClient(tokenProvider: vault)
        let model = AppModel(
            phase: .signedIn,
            vault: vault,
            api: api,
            store: nil,
            syncEngine: nil,
            previewMode: true
        )

        let now = Date()
        let userID = previewID(1)
        let sectionID = previewID(10)
        let courseID = previewID(11)
        let sharedTaskID = previewID(20)
        let proposalID = previewID(21)
        let personalTodoID = previewID(30)
        let completedTodoID = previewID(31)
        let reportID = previewID(40)

        model.currentUser = CurrentUser(
            id: userID,
            username: "student",
            displayName: "南京大学学生",
            avatarURL: nil,
            bio: "按时完成每一项课程任务。",
            status: .active,
            profileRevision: 4,
            roles: [.maintainer]
        )
        model.connectivity = .online
        model.lastSyncedAt = now.addingTimeInterval(-95)

        var projection = ClientProjection()
        projection.followedClassSections[sectionID] = FollowedClassSection(
            classSectionID: sectionID,
            followedAt: now.addingTimeInterval(-86_400 * 20)
        )
        projection.classSections[sectionID] = ClassSectionRecord(
            id: sectionID,
            courseID: courseID,
            externalSectionID: "2026-ALG-01",
            sectionNumber: "01",
            departmentCode: "CS",
            departmentName: "计算机科学与技术系",
            instructors: ["陈老师"],
            campus: "仙林校区",
            capacity: 80,
            scheduleText: "周二 3–4 节 · 逸夫楼 B201",
            active: true,
            revision: 3,
            createdAt: now.addingTimeInterval(-86_400 * 40),
            updatedAt: now.addingTimeInterval(-3_600)
        )
        projection.courseTasks[sharedTaskID] = CourseTask(
            id: sharedTaskID,
            classSectionID: sectionID,
            createdBy: userID,
            state: .visible,
            revision: 2,
            createdAt: now.addingTimeInterval(-86_400 * 2),
            updatedAt: now.addingTimeInterval(-3_600)
        )
        projection.taskProposals[proposalID] = TaskProposal(
            id: proposalID,
            courseTaskID: sharedTaskID,
            authorID: userID,
            title: "线性代数习题 4",
            deadline: now.addingTimeInterval(3_600 * 6),
            description: "完成第 4 章全部习题，并上传 PDF。",
            evidenceNote: "课程群公告",
            evidenceURL: nil,
            contentFingerprint: "ui-preview-proposal",
            state: .visible,
            revision: 2,
            createdAt: now.addingTimeInterval(-86_400)
        )
        projection.proposalVoteTotals[proposalID] = ProposalVoteTotals(
            proposalID: proposalID,
            up: 18,
            down: 1,
            updatedAt: now.addingTimeInterval(-600),
            revision: 7
        )
        projection.reporterReports[reportID] = ReporterContentReport(
            reportID: reportID,
            targetType: .comment,
            targetID: previewID(41),
            reason: .privacy,
            details: "评论包含个人联系方式。",
            status: .resolved,
            resolution: "相关评论已隐藏。",
            createdAt: now.addingTimeInterval(-86_400 * 3),
            resolvedAt: now.addingTimeInterval(-86_400 * 2)
        )
        model.projection = projection

        model.taskItems = [
            TaskListItem(
                id: sharedTaskID,
                kind: .shared,
                classSectionID: sectionID,
                courseTaskID: sharedTaskID,
                personalTodoID: nil,
                canonicalProposalID: proposalID,
                title: "线性代数习题 4",
                deadline: now.addingTimeInterval(3_600 * 6),
                note: "完成第 4 章全部习题，并上传 PDF。",
                state: .pending,
                confidence: .supported
            ),
            TaskListItem(
                id: personalTodoID,
                kind: .personal,
                classSectionID: nil,
                courseTaskID: nil,
                personalTodoID: personalTodoID,
                canonicalProposalID: nil,
                title: "整理数据库课程笔记",
                deadline: now.addingTimeInterval(86_400),
                note: "复习事务隔离级别。",
                state: .pending,
                confidence: nil
            ),
            TaskListItem(
                id: completedTodoID,
                kind: .personal,
                classSectionID: sectionID,
                courseTaskID: nil,
                personalTodoID: completedTodoID,
                canonicalProposalID: nil,
                title: "提交实验室安全测验",
                deadline: now.addingTimeInterval(-86_400),
                note: nil,
                state: .completed,
                confidence: nil
            ),
        ]

        let pendingOperation = StudentOperation.followClassSection(.init(
            operationID: previewID(50),
            payload: .init(classSectionID: previewID(51))
        ))
        model.outbox = [
            OutboxRecord(
                operation: pendingOperation,
                status: .pending,
                error: nil,
                attemptCount: 0
            ),
        ]
        return model
    }

    private static func previewID(_ suffix: Int) -> UUIDv7 {
        UUIDv7(String(format: "018f0000-0000-7000-8000-%012x", suffix))!
    }
#endif

    private init(
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

    func followClassSection(_ classSectionID: UUIDv7) async {
        guard projection.followedClassSections[classSectionID] == nil else { return }
        await enqueue(.followClassSection(.init(
            operationID: UUIDv7.generate(),
            payload: .init(classSectionID: classSectionID)
        )))
    }

    func unfollowClassSection(_ classSectionID: UUIDv7) async {
        guard projection.followedClassSections[classSectionID] != nil else { return }
        await enqueue(.unfollowClassSection(.init(
            operationID: UUIDv7.generate(),
            payload: .init(classSectionID: classSectionID)
        )))
    }

    func upsertPersonalTaskDetails(
        courseTaskID: UUIDv7,
        privateTitle: String?,
        privateDeadline: Date?,
        privateNote: String?
    ) async {
        let revision = projection.personalTaskDetails[courseTaskID]?.revision ?? 0
        await enqueue(.upsertPersonalTaskDetails(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                courseTaskID: courseTaskID,
                privateTitle: privateTitle,
                privateDeadline: privateDeadline,
                privateNote: privateNote,
                expectedRevision: revision
            )
        )))
    }

    func deletePersonalTaskDetails(courseTaskID: UUIDv7) async {
        guard let details = projection.personalTaskDetails[courseTaskID] else { return }
        await enqueue(.deletePersonalTaskDetails(.init(
            operationID: UUIDv7.generate(),
            payload: .init(courseTaskID: courseTaskID, expectedRevision: details.revision)
        )))
    }

    func createSharedTask(
        classSectionID: UUIDv7,
        title: String,
        deadline: Date,
        description: String?,
        evidenceNote: String?,
        evidenceURL: String?
    ) async {
        await enqueue(.createCourseTaskWithInitialProposal(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                courseTaskID: UUIDv7.generate(),
                classSectionID: classSectionID,
                proposalID: UUIDv7.generate(),
                proposal: .init(
                    title: title,
                    deadline: deadline,
                    description: description,
                    evidenceNote: evidenceNote,
                    evidenceURL: evidenceURL
                )
            )
        )))
    }

    func createTaskProposal(
        courseTaskID: UUIDv7,
        title: String,
        deadline: Date,
        description: String?,
        evidenceNote: String?,
        evidenceURL: String?
    ) async {
        await enqueue(.createTaskProposal(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                courseTaskID: courseTaskID,
                proposalID: UUIDv7.generate(),
                proposal: .init(
                    title: title,
                    deadline: deadline,
                    description: description,
                    evidenceNote: evidenceNote,
                    evidenceURL: evidenceURL
                )
            )
        )))
    }

    func setAccuracyVote(proposalID: UUIDv7, value: AccuracyVoteValue) async {
        await enqueue(.setAccuracyVote(.init(
            operationID: UUIDv7.generate(),
            payload: .init(proposalID: proposalID, value: value)
        )))
    }

    func createTaskComment(courseTaskID: UUIDv7, body: String) async {
        await enqueue(.createTaskComment(.init(
            operationID: UUIDv7.generate(),
            payload: .init(commentID: UUIDv7.generate(), courseTaskID: courseTaskID, body: body)
        )))
    }

    func editTaskComment(_ comment: TaskComment, body: String) async {
        await enqueue(.editTaskComment(.init(
            operationID: UUIDv7.generate(),
            payload: .init(commentID: comment.id, body: body, expectedRevision: comment.revision)
        )))
    }

    func deleteTaskComment(_ comment: TaskComment) async {
        await enqueue(.deleteTaskComment(.init(
            operationID: UUIDv7.generate(),
            payload: .init(commentID: comment.id, expectedRevision: comment.revision)
        )))
    }

    func createContentReport(
        targetType: ReportTargetType,
        targetID: UUIDv7,
        reason: ReportReason,
        details: String?
    ) async {
        await enqueue(.createContentReport(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                reportID: UUIDv7.generate(),
                targetType: targetType,
                targetID: targetID,
                reason: reason,
                details: details
            )
        )))
    }

    func publishPersonalTodo(_ todo: PersonalTodo) async {
        guard let classSectionID = todo.classSectionID, let deadline = todo.deadline else { return }
        await enqueue(.publishPersonalTodoAsCourseTask(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                personalTodoID: todo.id,
                expectedPersonalTodoRevision: todo.revision,
                courseTaskID: UUIDv7.generate(),
                classSectionID: classSectionID,
                proposalID: UUIDv7.generate(),
                proposal: .init(
                    title: todo.title,
                    deadline: deadline,
                    description: todo.note,
                    evidenceNote: nil,
                    evidenceURL: nil
                )
            )
        )))
    }

    func mergePersonalTodo(_ todo: PersonalTodo, into courseTaskID: UUIDv7) async {
        await enqueue(.mergePersonalTodoIntoCourseTask(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                personalTodoID: todo.id,
                courseTaskID: courseTaskID,
                expectedPersonalTodoRevision: todo.revision,
                expectedDetailsRevision: projection.personalTaskDetails[courseTaskID]?.revision ?? 0,
                expectedStateRevision: projection.personalTaskStates[courseTaskID]?.revision ?? 0
            )
        )))
    }

    func publishPersonalTaskDetails(_ details: PersonalTaskDetails) async {
        guard let title = details.privateTitle, let deadline = details.privateDeadline else { return }
        await enqueue(.publishPersonalTaskDetailsAsProposal(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                courseTaskID: details.courseTaskID,
                proposalID: UUIDv7.generate(),
                expectedDetailsRevision: details.revision,
                proposal: .init(
                    title: title,
                    deadline: deadline,
                    description: details.privateNote,
                    evidenceNote: nil,
                    evidenceURL: nil
                )
            )
        )))
    }

    func createPersonalTodo(
        title: String,
        deadline: Date?,
        note: String?,
        classSectionID: UUIDv7? = nil
    ) async {
        let operation = StudentOperation.createPersonalTodo(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                personalTodoID: UUIDv7.generate(),
                classSectionID: classSectionID,
                title: title,
                deadline: deadline,
                note: note,
                state: .pending
            )
        ))
        await enqueue(operation)
    }

    func updatePersonalTodo(
        _ todo: PersonalTodo,
        title: String,
        deadline: Date?,
        note: String?,
        state: TaskProgressState,
        classSectionID: UUIDv7?
    ) async {
        let operation = StudentOperation.updatePersonalTodo(.init(
            operationID: UUIDv7.generate(),
            payload: .init(
                personalTodoID: todo.id,
                classSectionID: classSectionID,
                title: title,
                deadline: deadline,
                note: note,
                state: state,
                expectedRevision: todo.revision
            )
        ))
        await enqueue(operation)
    }

    func deletePersonalTodo(_ todo: PersonalTodo) async {
        await enqueue(.deletePersonalTodo(.init(
            operationID: UUIDv7.generate(),
            payload: .init(personalTodoID: todo.id, expectedRevision: todo.revision)
        )))
    }

    func setTaskState(_ item: TaskListItem, state: TaskProgressState) async {
        if let todoID = item.personalTodoID, let todo = projection.personalTodos[todoID] {
            await updatePersonalTodo(
                todo,
                title: todo.title,
                deadline: todo.deadline,
                note: todo.note,
                state: state,
                classSectionID: todo.classSectionID
            )
            return
        }
        guard let taskID = item.courseTaskID else { return }
        let revision = projection.personalTaskStates[taskID]?.revision ?? 0
        await enqueue(.setPersonalTaskState(.init(
            operationID: UUIDv7.generate(),
            payload: .init(courseTaskID: taskID, state: state, expectedRevision: revision)
        )))
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

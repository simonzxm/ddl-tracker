import DDLTrackerCore
import Foundation

#if DEBUG
extension AppModel {
static func preview() -> AppModel {
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
}
#endif

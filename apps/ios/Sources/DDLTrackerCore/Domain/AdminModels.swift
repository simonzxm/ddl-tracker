public import Foundation

public struct AdminResult: Codable, Equatable, Sendable {
    public let values: [String: JSONValue]
    public init(values: [String: JSONValue]) { self.values = values }
    public init(from decoder: any Decoder) throws { values = try decoder.singleValueContainer().decode([String: JSONValue].self) }
    public func encode(to encoder: any Encoder) throws { var container = encoder.singleValueContainer(); try container.encode(values) }
}

public struct AdminBootstrapRequest: Codable, Equatable, Sendable {
    public let bootstrapToken: String
    public init(bootstrapToken: String) { self.bootstrapToken = bootstrapToken }
}

public enum AdminContentTargetType: String, Codable, CaseIterable, Sendable {
    case courseTask = "course_task"
    case proposal
    case comment
}

public struct AdminContentActionRequest: Codable, Equatable, Sendable {
    public let targetType: AdminContentTargetType
    public let reason: String
    public init(targetType: AdminContentTargetType, reason: String) { self.targetType = targetType; self.reason = reason }
}

public struct AdminContentActionResponse: Codable, Equatable, Sendable {
    public let state: ContentState
    public let revision: Int
    public let changed: Bool
}

public struct AdminUserActionRequest: Codable, Equatable, Sendable {
    public let reason: String
    public init(reason: String) { self.reason = reason }
}

public struct AdminRoleRequest: Codable, Equatable, Sendable {
    public let maintainer: Bool
    public let reason: String
    public init(maintainer: Bool, reason: String) { self.maintainer = maintainer; self.reason = reason }
}

public struct AdminTaskMergeRequest: Codable, Equatable, Sendable {
    public let targetTaskID: UUIDv7
    public let reason: String
    public init(targetTaskID: UUIDv7, reason: String) { self.targetTaskID = targetTaskID; self.reason = reason }
}

public enum AdminReportResolutionStatus: String, Codable, Sendable { case resolved, dismissed }
public struct AdminReportResolutionRequest: Codable, Equatable, Sendable {
    public let status: AdminReportResolutionStatus
    public let resolution: String
    public init(status: AdminReportResolutionStatus, resolution: String) { self.status = status; self.resolution = resolution }
}
public struct AdminReportResolutionResponse: Codable, Equatable, Sendable { public let status: AdminReportResolutionStatus }

public struct AdminPageCursor: Codable, Equatable, Sendable {
    public let createdAt: Date
    public let id: UUIDv7
}

public struct AdminReport: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let reporterID: UUIDv7
    public let targetType: ReportTargetType
    public let targetID: UUIDv7
    public let reason: ReportReason
    public let details: String?
    public let status: ReportStatus
    public let resolution: String?
    public let resolvedBy: UUIDv7?
    public let createdAt: Date
    public let resolvedAt: Date?
}
public struct AdminReportPage: Codable, Equatable, Sendable {
    public let reports: [AdminReport]
    public let next: AdminPageCursor?
}

public struct AdminAuditEntry: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let actorID: UUIDv7?
    public let action: String
    public let targetType: String
    public let targetID: UUIDv7?
    public let reason: String?
    public let result: JSONValue
    public let requestID: UUIDv7
    public let createdAt: Date
}
public struct AdminAuditPage: Codable, Equatable, Sendable {
    public let entries: [AdminAuditEntry]
    public let next: AdminPageCursor?
}

public struct CatalogDiffCounts: Codable, Equatable, Sendable {
    public let added: Int
    public let updated: Int
    public let unchanged: Int
    public let deactivated: Int
}
public struct DeactivatedCourse: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let externalCourseCode: String
}
public struct DeactivatedClassSection: Codable, Equatable, Sendable, Identifiable {
    public let id: UUIDv7
    public let externalSectionID: String
}
public struct CatalogImportDiff: Codable, Equatable, Sendable {
    public let terms: CatalogDiffCounts
    public let courses: CatalogDiffCounts
    public let classSections: CatalogDiffCounts
    public let fieldChanges: [String: Int]
    public let deactivatedCourses: [DeactivatedCourse]?
    public let deactivatedClassSections: [DeactivatedClassSection]?
    public let deactivatedClassSectionIDs: [UUIDv7]
    public let checksumPreviouslyApplied: Bool
}

public struct CatalogTermInput: Codable, Equatable, Sendable {
    public let externalCode: String
    public let displayName: String
    public let startsOn: String?
    public let endsOn: String?
    public let timeZone: String
    public init(externalCode: String, displayName: String, startsOn: String?, endsOn: String?, timeZone: String = "Asia/Shanghai") {
        self.externalCode = externalCode; self.displayName = displayName; self.startsOn = startsOn; self.endsOn = endsOn; self.timeZone = timeZone
    }
}
public struct CatalogCourseInput: Codable, Equatable, Sendable {
    public let externalCourseCode: String
    public let name: String
    public let credits: String?
    public init(externalCourseCode: String, name: String, credits: String?) { self.externalCourseCode = externalCourseCode; self.name = name; self.credits = credits }
}
public struct CatalogClassSectionInput: Codable, Equatable, Sendable {
    public let externalSectionID: String
    public let externalCourseCode: String
    public let name: String
    public let sectionNumber: String
    public let departmentCode: String?
    public let departmentName: String?
    public let instructors: [String]
    public let campusCode: String?
    public let campusName: String?
    public let capacity: Int?
    public let scheduleText: String
    public let weeksText: String
    public let weekdayText: String
    public let periodsText: String
    public let roomText: String
    public let buildingCode: String?
    public let buildingName: String?
    public let sourcePayload: [String: JSONValue]
    public init(externalSectionID: String, externalCourseCode: String, name: String, sectionNumber: String, departmentCode: String?, departmentName: String?, instructors: [String], campusCode: String?, campusName: String?, capacity: Int?, scheduleText: String, weeksText: String, weekdayText: String, periodsText: String, roomText: String, buildingCode: String?, buildingName: String?, sourcePayload: [String: JSONValue]) {
        self.externalSectionID = externalSectionID; self.externalCourseCode = externalCourseCode; self.name = name; self.sectionNumber = sectionNumber
        self.departmentCode = departmentCode; self.departmentName = departmentName; self.instructors = instructors; self.campusCode = campusCode
        self.campusName = campusName; self.capacity = capacity; self.scheduleText = scheduleText; self.weeksText = weeksText
        self.weekdayText = weekdayText; self.periodsText = periodsText; self.roomText = roomText; self.buildingCode = buildingCode
        self.buildingName = buildingName; self.sourcePayload = sourcePayload
    }
}
public struct CatalogPlanBatchRequest: Codable, Equatable, Sendable {
    public let importID: UUIDv7?
    public let filename: String
    public let checksum: String
    public let headerHash: String
    public let manifestHash: String
    public let environment: String
    public let manifest: [String: JSONValue]
    public let term: CatalogTermInput
    public let rowCount: Int
    public let batchIndex: Int
    public let totalBatches: Int
    public let finalize: Bool
    public let courses: [CatalogCourseInput]
    public let classSections: [CatalogClassSectionInput]
    public init(importID: UUIDv7?, filename: String, checksum: String, headerHash: String, manifestHash: String, environment: String, manifest: [String: JSONValue], term: CatalogTermInput, rowCount: Int, batchIndex: Int, totalBatches: Int, finalize: Bool, courses: [CatalogCourseInput], classSections: [CatalogClassSectionInput]) {
        self.importID = importID; self.filename = filename; self.checksum = checksum; self.headerHash = headerHash; self.manifestHash = manifestHash
        self.environment = environment; self.manifest = manifest; self.term = term; self.rowCount = rowCount; self.batchIndex = batchIndex
        self.totalBatches = totalBatches; self.finalize = finalize; self.courses = courses; self.classSections = classSections
    }
}
public struct CatalogPlanBatchResponse: Codable, Equatable, Sendable {
    public let importID: UUIDv7
    public let batchIndex: Int
    public let accepted: Bool
    public let receivedBatches: Int
    public let totalBatches: Int
    public let planComplete: Bool
    public let diff: CatalogImportDiff?
}
public struct CatalogUploadResponse: Codable, Equatable, Sendable {
    public let importID: UUIDv7
    public let replayed: Bool
    public let filename: String
    public let checksum: String
    public let manifestHash: String
    public let rowCount: Int
    public let courseCount: Int
    public let classSectionCount: Int
    public let totalBatches: Int
    public let warnings: [String]
    public let diff: CatalogImportDiff
}
public struct CatalogApplyAllRequest: Codable, Equatable, Sendable {
    public let confirmDeactivations: Bool
    public init(confirmDeactivations: Bool) { self.confirmDeactivations = confirmDeactivations }
}
public struct CatalogApplyResponse: Codable, Equatable, Sendable {
    public let importID: UUIDv7
    public let replayed: Bool
    public let appliedBatches: Int
    public let totalBatches: Int
    public let complete: Bool
}
public struct CatalogCancelRequest: Codable, Equatable, Sendable {
    public let reason: String
    public init(reason: String) { self.reason = reason }
}
public struct CatalogCancelResponse: Codable, Equatable, Sendable {
    public let importID: UUIDv7
    public let status: String
    public let replayed: Bool
}
public enum CatalogImportState: String, Codable, Sendable { case planned, applied, failed, cancelled, expired }
public struct CatalogImportStatus: Codable, Equatable, Sendable {
    public let importID: UUIDv7
    public let status: CatalogImportState
    public let receivedBatches: Int
    public let appliedBatches: Int
    public let totalBatches: Int
    public let diff: CatalogImportDiff?
    public let failureMessage: String?
}
public enum CatalogUploadError: Error, Equatable, Sendable { case invalidFilename }

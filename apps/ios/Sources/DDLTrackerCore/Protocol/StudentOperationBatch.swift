public enum StudentOperationBatchError: Error, Equatable, Sendable {
    case tooManyOperations(Int)
    case duplicateOperationID(UUIDv7)
    case duplicateDependency(UUIDv7)
    case dependencyMustReferenceEarlierOperation(UUIDv7)
    case operationIDReusedAsEntityID(UUIDv7)
}

public enum StudentOperationBatch {
    public static let maximumCount = 100

    public static func validate(_ operations: [StudentOperation]) throws {
        guard operations.count <= maximumCount else {
            throw StudentOperationBatchError.tooManyOperations(operations.count)
        }
        var seen = Set<UUIDv7>()
        for operation in operations {
            guard !seen.contains(operation.operationID) else {
                throw StudentOperationBatchError.duplicateOperationID(operation.operationID)
            }
            if operation.entityIDs.contains(operation.operationID) {
                throw StudentOperationBatchError.operationIDReusedAsEntityID(operation.operationID)
            }
            var dependencies = Set<UUIDv7>()
            for dependency in operation.dependsOn {
                guard dependencies.insert(dependency).inserted else {
                    throw StudentOperationBatchError.duplicateDependency(dependency)
                }
                guard seen.contains(dependency) else {
                    throw StudentOperationBatchError.dependencyMustReferenceEarlierOperation(dependency)
                }
            }
            seen.insert(operation.operationID)
        }
    }
}

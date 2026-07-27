// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "DDLTrackerClient",
    defaultLocalization: "zh-Hans",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "DDLTrackerCore", targets: ["DDLTrackerCore"]),
    ],
    targets: [
        .target(
            name: "DDLTrackerCore",
            resources: [.process("Resources")],
            swiftSettings: [
                .enableUpcomingFeature("ExistentialAny"),
                .enableUpcomingFeature("InternalImportsByDefault"),
            ]
        ),
        .testTarget(
            name: "DDLTrackerCoreTests",
            dependencies: ["DDLTrackerCore"]
        ),
    ]
)

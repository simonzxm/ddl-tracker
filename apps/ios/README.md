# DDL Tracker for iOS

The Apple client is a native SwiftUI application backed by the `DDLTrackerCore` Swift package. It targets iOS 18 and uses only Apple platform frameworks for UI, persistence, networking, and credential storage.

## Requirements

- macOS with Xcode 26 or newer
- Swift 6.2 toolchain
- XcodeGen
- Node.js and pnpm versions declared by the repository root

The production API base URL is defined by `APIClient.productionBaseURL`.

## Generate the Xcode project

The committed Xcode project is generated from `project.yml`:

```bash
pnpm ios:project
```

Run this command after changing target settings, source paths, package dependencies, Info.plist properties, or assets. Commit `project.yml`, `App/Info.plist`, and the regenerated `.xcodeproj` together when they change.

## Synchronize API contracts

The client bundles the generated OpenAPI document and official cross-language protocol vectors:

```bash
pnpm ios:contracts
pnpm ios:contracts:check
```

`pnpm verify` runs the contract freshness check. Do not edit files under `Sources/DDLTrackerCore/Resources` by hand.

## Run tests

```bash
pnpm ios:test
```

The Swift package tests cover protocol decoding, all student operations, sync recovery, SwiftData transactions, optimistic offline projection, ranking, API request construction, Keychain sessions, and task presentation.

## Compile the application

```bash
cd apps/ios
xcodegen generate
xcodebuild \
  -project DDLTracker.xcodeproj \
  -scheme DDLTracker \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO \
  clean build
```

Open `DDLTracker.xcodeproj` to run on a simulator or signed device.

## Architecture

- `App/`: SwiftUI application, authentication, student workflows, account management, and maintainer tools.
- `Sources/DDLTrackerCore/API`: URLSession API client and Keychain session vault.
- `Sources/DDLTrackerCore/Domain`: Codable API and presentation models.
- `Sources/DDLTrackerCore/Protocol`: strict sync envelopes, snapshot records, events, and operations.
- `Sources/DDLTrackerCore/Store`: SwiftData persistence, reducers, optimistic projection, and outbox handling.
- `Sources/DDLTrackerCore/Sync`: resumable snapshot and incremental synchronization.
- `Tests/DDLTrackerCoreTests`: deterministic contract and state-machine tests.

The app is offline-first. Confirmed server state and pending operations are stored separately. Pending operations are projected immediately for the UI, then resolved atomically when synchronization returns operation results and events.

## Debug visual QA

Debug builds include a credential-free preview mode for simulator screenshots. Release builds exclude the preview data.

```bash
xcrun simctl launch booted xyz.210023.ddltracker \
  --ui-preview \
  --ui-preview-tab=tasks
```

Supported tab values are `tasks`, `courses`, `activity`, `profile`, and `admin`.

## Security notes

- Access tokens and session metadata are stored in Keychain with `AfterFirstUnlockThisDeviceOnly` accessibility.
- Corrupt or unreadable Keychain entries are deleted and treated as a signed-out state.
- Local projections and outbox operations are stored in SwiftData; secrets are not stored there.
- Maintainer mutations require an explicit reason and are recorded by the server audit log.

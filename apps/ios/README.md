# DDL Tracker for iOS

The Apple client is a native SwiftUI application backed by the `DDLTrackerCore` Swift package.

## Generate the Xcode project

```bash
cd apps/ios
xcodegen generate
```

## Verify the core package

```bash
cd apps/ios
swift test
```

## Compile the iOS application

```bash
cd apps/ios
xcodebuild \
  -project DDLTracker.xcodeproj \
  -scheme DDLTracker \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

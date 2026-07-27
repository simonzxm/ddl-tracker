import DDLTrackerCore
import SwiftUI

struct ProfileEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var username: String
    @State private var displayName: String
    @State private var avatarURL: String
    @State private var bio: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(user: CurrentUser) {
        _username = State(initialValue: user.username)
        _displayName = State(initialValue: user.displayName)
        _avatarURL = State(initialValue: user.avatarURL ?? "")
        _bio = State(initialValue: user.bio ?? "")
    }

    var body: some View {
        Form {
            Section {
                TextField("用户名", text: $username)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("显示名称", text: $displayName)
                    .textContentType(.name)
            }
            Section("公开资料") {
                TextField("头像 URL（可选）", text: $avatarURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("个人简介（可选）", text: $bio, axis: .vertical)
                    .lineLimit(3 ... 8)
            }
        }
        .navigationTitle("编辑资料")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("存储") { save() }
                    .disabled(!canSave || isSaving)
            }
        }
        .overlay {
            if isSaving {
                ProgressView()
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .alert("无法更新资料", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("好") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var cleanUsername: String {
        username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var cleanDisplayName: String {
        displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool {
        cleanUsername.count >= 3 && !cleanDisplayName.isEmpty
    }

    private func save() {
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await model.updateProfile(
                    username: cleanUsername,
                    displayName: cleanDisplayName,
                    avatarURL: optional(avatarURL),
                    bio: optional(bio)
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func optional(_ value: String) -> String? {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? nil : clean
    }
}

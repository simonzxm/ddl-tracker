import SwiftUI

struct AuthenticationView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            Group {
                switch model.authStage {
                case .email:
                    EmailEntryView()
                case let .code(_, email, expiresAt):
                    VerificationCodeView(email: email, expiresAt: expiresAt)
                case let .registration(_, email, expiresAt):
                    RegistrationView(email: email, expiresAt: expiresAt)
                }
            }
            .navigationTitle("DDL Tracker")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct EmailEntryView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ""
    @FocusState private var focused: Bool

    var body: some View {
        Form {
            Section {
                VStack(spacing: 18) {
                    Image(systemName: "checklist")
                        .font(.system(size: 54, weight: .medium))
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)
                    VStack(spacing: 6) {
                        Text("管理课程 DDL")
                            .font(.title2.bold())
                        Text("使用学校邮箱登录。验证码只用于验证身份。")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .padding(.vertical, 20)
            }
            Section {
                TextField("name@smail.nju.edu.cn", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .submitLabel(.continue)
                    .onSubmit(send)
            } header: {
                Text("学校邮箱")
            } footer: {
                Text("需要使用服务端允许的校园邮箱域名。")
            }
            Section {
                Button(action: send) {
                    HStack {
                        Spacer()
                        if model.isAuthenticating { ProgressView() } else { Text("获取验证码") }
                        Spacer()
                    }
                }
                .disabled(email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isAuthenticating)
            }
        }
        .onAppear { focused = true }
    }

    private func send() {
        Task { await model.requestLoginCode(email: email) }
    }
}

private struct VerificationCodeView: View {
    @Environment(AppModel.self) private var model
    let email: String
    let expiresAt: Date
    @State private var code = ""
    @FocusState private var focused: Bool

    var body: some View {
        Form {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "envelope.badge")
                        .font(.system(size: 42))
                        .foregroundStyle(.tint)
                    Text("输入验证码")
                        .font(.title2.bold())
                    Text("验证码已发送至 \(email)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .padding(.vertical, 12)
            }
            Section {
                TextField("000000", text: $code)
                    .textContentType(.oneTimeCode)
                    .keyboardType(.numberPad)
                    .font(.title2.monospacedDigit())
                    .focused($focused)
                    .onChange(of: code) { _, newValue in
                        let filtered = String(newValue.filter(\.isNumber).prefix(6))
                        if filtered != code { code = filtered }
                        if filtered.count == 6 { verify() }
                    }
            } header: {
                Text("六位验证码")
            } footer: {
                Text("有效期至 \(expiresAt.formatted(date: .omitted, time: .shortened))")
            }
            Section {
                Button(action: verify) {
                    HStack {
                        Spacer()
                        if model.isAuthenticating { ProgressView() } else { Text("验证并登录") }
                        Spacer()
                    }
                }
                .disabled(code.count != 6 || model.isAuthenticating)
                Button("更换邮箱", role: .cancel) { model.resetAuthentication() }
            }
        }
        .onAppear { focused = true }
    }

    private func verify() { Task { await model.verifyLoginCode(code) } }
}

private struct RegistrationView: View {
    @Environment(AppModel.self) private var model
    let email: String
    let expiresAt: Date
    @State private var username = ""
    @State private var displayName = ""
    @FocusState private var field: Field?

    enum Field: Hashable { case username, displayName }

    var body: some View {
        Form {
            Section {
                LabeledContent("已验证邮箱", value: email)
                LabeledContent("注册有效期", value: expiresAt.formatted(date: .omitted, time: .shortened))
            }
            Section {
                TextField("用户名", text: $username)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($field, equals: .username)
                TextField("显示名称（可选）", text: $displayName)
                    .textContentType(.name)
                    .focused($field, equals: .displayName)
            } header: {
                Text("创建账户")
            } footer: {
                Text("用户名用于公开署名，之后可在个人资料中修改。")
            }
            Section {
                Button {
                    Task { await model.registerAccount(username: username, displayName: displayName) }
                } label: {
                    HStack {
                        Spacer()
                        if model.isAuthenticating { ProgressView() } else { Text("创建账户") }
                        Spacer()
                    }
                }
                .disabled(username.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 || model.isAuthenticating)
                Button("重新验证邮箱", role: .cancel) { model.resetAuthentication() }
            }
        }
        .onAppear { field = .username }
    }
}

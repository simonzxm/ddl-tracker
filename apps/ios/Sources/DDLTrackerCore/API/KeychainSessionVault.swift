import Foundation
import Security

public enum SessionVaultError: Error, Equatable, Sendable {
    case unexpectedStatus(Int32)
    case invalidData
}

public actor KeychainSessionVault: AccessTokenProvider {
    private let service: String
    private let account: String

    public init(service: String = "xyz.210023.ddltracker", account: String = "primary-session") {
        self.service = service
        self.account = account
    }

    public func save(_ credential: SessionCredential) throws {
        let data = try JSONCoding.encoder.encode(credential)
        let base: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let attributes: [CFString: Any] = [
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(base as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw SessionVaultError.unexpectedStatus(updateStatus)
        }
        var insert = base
        for (key, value) in attributes { insert[key] = value }
        let addStatus = SecItemAdd(insert as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw SessionVaultError.unexpectedStatus(addStatus)
        }
    }

    public func load() throws -> SessionCredential? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw SessionVaultError.unexpectedStatus(status) }
        let data: Data
        if let value = item as? Data {
            data = value
        } else if let value = item as? NSData {
            data = Data(referencing: value)
        } else {
            throw SessionVaultError.invalidData
        }
        return try JSONCoding.decoder.decode(SessionCredential.self, from: data)
    }

    public func delete() throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SessionVaultError.unexpectedStatus(status)
        }
    }

    public func accessToken() throws -> String? {
        guard let credential = try load(), credential.expiresAt > Date() else { return nil }
        return credential.accessToken
    }
}

---
status: accepted
---

# 在已验证 OIDC 身份处分隔认证协议与账户会话

OIDC adapter 封装 discovery、authorization code + PKCE、token exchange 与 ID Token 校验；它成功后只产出 `VerifiedOidcIdentity`。账户与会话 module 只依赖已验证的 `(issuer, subject)` 和可选 profile claims，不知道 state、nonce、PKCE、JWKS 或 Provider endpoint。未来新增 Provider 时保留独立协议 adapter，并在已验证身份结果处汇合，避免用带大量协议分支的万能登录 interface 耦合所有方式。

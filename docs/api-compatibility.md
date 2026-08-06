# API 契约兼容矩阵

当前 OpenAPI 契约版本为 `4.0.0`。`/api/v1` 表示 HTTP 路径 major；OpenAPI `info.version` 表示具体契约 release。4.0.0 删除全部人工课程导入接口和对应契约，课程目录改由 Worker Cron 从 GitHub 自动同步，因此是 breaking release。

机器可读的权威矩阵位于 [`packages/contracts/vectors/api-compatibility-v4.0.json`](../packages/contracts/vectors/api-compatibility-v4.0.json)，由 `@ddl-tracker/contracts` 的 schema 和测试校验。客户端不得只比较版本字符串后假设兼容，必须读取矩阵中的 compatibility 与 requirements。

| client \ server | 1.0.0 | 1.1.0 | 2.0.0 | 3.0.0 | 4.0.0 |
| --- | --- | --- | --- | --- | --- |
| 1.0.0 | 完全兼容 | 不兼容 | 不兼容 | 不兼容 | 不兼容 |
| 1.1.0 | 条件兼容：显式使用 legacy catalog plan 流程并避开 1.1-only endpoint | 完全兼容 | 不兼容 | 不兼容 | 不兼容 |
| 2.0.0 | 不兼容 | 不兼容 | 完全兼容 | 不兼容 | 不兼容 |
| 3.0.0 | 不兼容 | 不兼容 | 不兼容 | 完全兼容 | 不兼容 |
| 4.0.0 | 不兼容 | 不兼容 | 不兼容 | 不兼容 | 完全兼容 |

## 4.0.0 变化

删除以下接口：

```text
POST /v1/admin/catalog/imports/plan
POST /v1/admin/catalog/imports/upload
POST /v1/admin/catalog/imports/{import_id}/apply-all
POST /v1/admin/catalog/imports/{import_id}/cancel
GET  /v1/admin/catalog/imports/{import_id}
```

同时删除：

- catalog plan/upload/apply/cancel/status request 与 response schemas。
- `planned/applied/failed/cancelled/expired` import 状态契约。
- admin catalog CLI 与断点 state 文件。
- CSV manifest、manifest hash 和 multipart upload 行为。

课程目录同步现在是服务端内部能力 `automatic_github_catalog_sync`，不暴露客户端触发接口。3.x 及更早客户端若仅使用学生目录查询、OIDC 和 sync 协议，其 wire shape 大部分未变化；但它们发布的完整 OpenAPI 契约仍包含已删除的管理接口，因此矩阵将跨 4.0.0 组合标记为不兼容，不做隐式部分兼容声明。

## 3.0.0 变化

- 删除 `POST /v1/auth/email/challenges`、`POST /v1/auth/email/verifications` 和 `POST /v1/accounts/registrations`。
- 新增 `POST /v1/auth/oidc/start`、`GET /v1/auth/oidc/callback` 和 `POST /v1/auth/oidc/exchange`。
- 登录使用 authorization code + PKCE S256；Provider client 是 public client，不使用 client secret。
- Provider callback 只返回短期、单用途 exchange code；本地 bearer session token 不出现在浏览器 URL。
- 新 OIDC identity 首次登录时自动创建账户；不再存在 registration token 或独立注册步骤。

## 2.0.0 变化

- 同步请求和响应只接受 `protocol_version = 2`。
- snapshot record 改为以 `record_type` 判别的严格联合：`{record_type, schema_version, payload}`。
- sync event 改为以 `type` 判别的严格联合，规范化 event 使用 `schema_version = 2`。
- create、upsert 和 restore event 携带完整当前记录；hide/delete 携带明确 tombstone；merge/redirect 与 aggregate update 携带完整收敛信息。
- OpenAPI 为同步联合发布明确的 `oneOf` 与 discriminator。

## 1.1.0 变化

1.1.0 曾新增 gzip catalog upload、cancel 和扩展 import status。它们只作为历史契约记录保留；4.0.0 server 不再实现这些接口。历史矩阵不构成恢复旧导入路径的要求。

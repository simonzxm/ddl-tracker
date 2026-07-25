# API 契约兼容矩阵

当前 OpenAPI 契约版本为 `1.1.0`。`/api/v1` 表示 HTTP API 的 major version；OpenAPI `info.version` 表示该 major version 内的具体契约 release。

机器可读的权威矩阵位于 [`packages/contracts/vectors/api-compatibility-v1.1.json`](../packages/contracts/vectors/api-compatibility-v1.1.json)，由 `@ddl-tracker/contracts` 的 schema 和测试校验。客户端不得只比较版本字符串后假设完全兼容，必须执行矩阵列出的条件。

| client \ server | 1.0.0 | 1.1.0 |
| --- | --- | --- |
| 1.0.0 | 完全兼容 | 不兼容：已发布的 1.0 response schema 是 strict，会拒绝新增 diff 字段以及 `cancelled`、`expired` |
| 1.1.0 | 条件兼容：维护者显式选择分批 plan 流程，并且不调用 upload/cancel | 完全兼容 |

## 1.1.0 变化

- 新增 `POST /v1/admin/catalog/imports/upload`，接收有上限的 `.csv.gz` 与 manifest，并在服务端原子生成完整 plan。
- 新增 `POST /v1/admin/catalog/imports/{import_id}/cancel`。
- import status 新增 `cancelled` 和 `expired` 终态。
- import diff 新增待停用课程与教学班的内部 ID 和外部键。
- gzip upload response 显式返回 replay 状态、checksum、manifest hash、计数、warning 和完整 diff。

1.0.0 的 plan、apply-all 和 status 路径及 request 字段在 1.1.0 server 上继续保留，但已发布的 1.0.0 客户端会严格拒绝新增响应字段和 status，因此整体仍不兼容，必须升级客户端。

当前 1.1.0 admin CLI 不自动协商 server version，也不会把 upload/cancel 自动改写为旧 plan。连接 1.0.0 server 时，维护者必须先确认 OpenAPI `info.version`，显式运行 `catalog plan` 的 legacy workflow，并避免调用 upload/cancel；否则 1.1-only endpoint 的 404 是契约不兼容，不是应重试的临时网络错误。

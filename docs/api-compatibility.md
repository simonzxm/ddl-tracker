# API 契约兼容矩阵

当前 OpenAPI 契约版本为 `2.0.0`。`/api/v1` 表示 HTTP 路径 major；OpenAPI `info.version` 表示具体契约 release。2.0.0 没有改 HTTP 路径，但同步 wire contract 发生不兼容变更，因此仍是 API contract major release。

机器可读的权威矩阵位于 [`packages/contracts/vectors/api-compatibility-v2.0.json`](../packages/contracts/vectors/api-compatibility-v2.0.json)，由 `@ddl-tracker/contracts` 的 schema 和测试校验。客户端不得只比较版本字符串后假设兼容，必须读取矩阵中的 compatibility 与 requirements。

| client \ server | 1.0.0 | 1.1.0 | 2.0.0 |
| --- | --- | --- | --- |
| 1.0.0 | 完全兼容 | 不兼容 | 不兼容 |
| 1.1.0 | 条件兼容：显式使用 legacy catalog plan 流程并避开 1.1-only endpoint | 完全兼容 | 不兼容 |
| 2.0.0 | 不兼容 | 不兼容 | 完全兼容 |

## 2.0.0 变化

- 同步请求和响应只接受 `protocol_version = 2`。
- snapshot record 改为以 `record_type` 判别的严格联合：`{record_type, schema_version, payload}`。
- snapshot record 不再重复提供顶层实体 `id` 和 `revision`。
- sync event 改为以 `type` 判别的严格联合，规范化 event 使用 `schema_version = 2`。
- create、upsert 和 restore event 携带完整当前记录；hide/delete 携带明确 tombstone；merge/redirect 与 aggregate update 携带完整收敛信息。
- 举报事件拆为 `reporter_content_report_updated` 和 `maintainer_content_report_updated`，避免同一 type 根据 scope 改变 payload shape。
- OpenAPI 为 `SyncEvent`、`SnapshotRecord` 和 `SyncResponse` 发布明确的 `oneOf` 与 discriminator，可用于生成 Swift/Kotlin tagged union。
- protocol v2 reader 遇到当前用户可见的历史 schema-version-1 宽 event 时返回 `cursor_expired`，客户端必须保留 outbox、清空远端投影并重新 account snapshot。

1.x 客户端会发送 `protocol_version = 1`，并且无法解码新的严格 snapshot/event envelope，因此不能连接 2.0.0 server。2.0.0 客户端也不能连接 1.x server；它不能把宽 payload 猜测为某个 typed record/event。

## 1.1.0 变化

- 新增 `POST /v1/admin/catalog/imports/upload`，接收有上限的 `.csv.gz` 与 manifest，并在服务端原子生成完整 plan。
- 新增 `POST /v1/admin/catalog/imports/{import_id}/cancel`。
- import status 新增 `cancelled` 和 `expired` 终态。
- import diff 新增待停用课程与教学班的内部 ID 和外部键。
- gzip upload response 显式返回 replay 状态、checksum、manifest hash、计数、warning 和完整 diff。

1.1.0 client 连接 1.0.0 server 时，维护者必须先确认 OpenAPI `info.version`，显式运行 `catalog plan` 的 legacy workflow，并避免调用 upload/cancel。除此之外的跨 release 组合以机器可读矩阵为准，不进行隐式降级。

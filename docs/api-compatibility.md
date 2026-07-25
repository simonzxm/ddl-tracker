# API 契约兼容矩阵

当前 OpenAPI 契约版本为 `1.1.0`。`/api/v1` 表示 HTTP API 的 major version；OpenAPI `info.version` 表示该 major version 内的具体契约 release。

机器可读的权威矩阵位于 [`packages/contracts/vectors/api-compatibility-v1.1.json`](../packages/contracts/vectors/api-compatibility-v1.1.json)，由 `@ddl-tracker/contracts` 的 schema 和测试校验。客户端不得只比较版本字符串后假设完全兼容，必须执行矩阵列出的条件。

| client \ server | 1.0.0 | 1.1.0 |
| --- | --- | --- |
| 1.0.0 | 完全兼容 | 条件兼容：旧 plan/apply 请求仍可用；响应 parser 必须忽略新增字段并接受 `cancelled`、`expired` |
| 1.1.0 | 条件兼容：回退到分批 plan，不调用 upload/cancel，并接受缺少 1.1 新字段 | 完全兼容 |

## 1.1.0 变化

- 新增 `POST /v1/admin/catalog/imports/upload`，接收有上限的 `.csv.gz` 与 manifest，并在服务端原子生成完整 plan。
- 新增 `POST /v1/admin/catalog/imports/{import_id}/cancel`。
- import status 新增 `cancelled` 和 `expired` 终态。
- import diff 新增待停用课程与教学班的内部 ID 和外部键。
- gzip upload response 显式返回 replay 状态、checksum、manifest hash、计数、warning 和完整 diff。

1.0.0 的 plan、apply-all 和 status 路径及 request 字段在 1.1.0 server 上继续保留。严格拒绝未知响应字段或只接受三个旧 status 值的 1.0.0 客户端并不兼容，必须先升级 parser。1.1.0 客户端连接 1.0.0 server 时必须读取 OpenAPI `info.version`，并按矩阵回退，不能把 404 当作临时网络错误重试新 endpoint。

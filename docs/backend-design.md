# 后端设计

本文描述实现边界、modules、权威数据模型、事务与 Cloudflare 部署形态。用户行为以[产品规范](./product-spec.md)为准；同步 payload 与状态机见[同步协议](./sync-protocol.md)。

## 总体架构

```text
原生或第三方客户端
        │ HTTPS / JSON / Bearer token
        ▼
Cloudflare Worker（Hono HTTP shell）
        │
        ├── 认证与账户 modules ── MailDelivery interface ── 飞书 SMTP
        ├── 课程目录与维护者 modules
        ├── 共享任务、私人任务、评论与审核 modules
        └── 同步 module
                │ Drizzle / pg
                ▼
Hyperdrive（query cache disabled）
        │
Workers VPC TCP service
        │
Cloudflare Tunnel（VPS 上的 cloudflared）
        │ TLS
        ▼
VPS PostgreSQL（权威状态 + 同步日志）
```

PostgreSQL 是唯一在线业务权威存储。R2 只存放 PostgreSQL 备份，不参与请求路径。MVP 不使用 Durable Objects、Queues、KV 或 D1。

## 技术栈

- TypeScript strict mode。
- pnpm workspace。
- Hono：路由、middleware、请求/响应映射。
- Zod 与 Hono OpenAPI 集成：运行时校验并生成 OpenAPI。
- Drizzle ORM + `pg`：默认数据库访问方式；复杂事务、锁和 PostgreSQL 特性可使用参数化显式 SQL。
- Cloudflare Workers + Hyperdrive，启用 `nodejs_compat`。
- VPS PostgreSQL，通过 Workers VPC + remotely managed Cloudflare Tunnel 私网连接。
- 飞书企业邮箱 SMTP，必须使用 TLS 端口；Workers 不允许出站 SMTP port 25。
- Vitest、`@cloudflare/vitest-pool-workers` 和真实临时 PostgreSQL。

版本锁定应由 lockfile 完成。实现开始时必须按当天官方文档确认最低兼容版本，不能从本文复制未来可能过时的 package version。

## 仓库结构

```text
apps/
  api/                 # Worker、业务 modules、Drizzle schema、migration
  admin-cli/           # 只调用维护 HTTP 接口
packages/
  contracts/           # schema、OpenAPI、同步契约、排名参考与 JSON 向量
data/
  fixtures/            # 仅假课程数据；真实 CSV 不入库
docs/
```

业务实现不拆成大量浅 package。`apps/api` 内按领域 module 组织，数据库事务与对应规则保持局部性。`admin-cli` 共享 contracts，但不能导入数据库 adapter 或后端 implementation。

## Modules 与 interfaces

| Module | 对外 interface | 隐藏的复杂度 |
|---|---|---|
| HTTP shell | 已校验 request → module command | Hono、CORS、认证 middleware、错误映射、request ID |
| Email OTP authentication | request challenge、verify challenge | 域名校验、HMAC、冷却、尝试次数、SMTP 状态机 |
| Account and session | verified identity → account/session | 注册、opaque token、哈希、撤销、暂停、删除 |
| Course catalog | 查询、导入计划、应用导入 | CSV 映射、外部键、停用、审计、raw source |
| Shared tasks | 创建任务/提案、投票、合并 | 不变式、聚合计数、指纹、权限、同步事件 |
| Personal tasks | CRUD、合并、发布、状态 | 私密性、revision、转换、无数据丢失 |
| Comments | 创建、修订、删除、读取历史 | 不可变修订、可见性、删除占位 |
| Moderation | 举报、处理、隐藏、暂停 | 私有举报、审计、公开 tombstone、恢复 |
| Sync | process batch、bootstrap、incremental pull | 幂等、savepoint、游标、范围过滤、分页 |

认证 module 有两个关键 seam：

1. `MailDelivery`：飞书 SMTP adapter 与测试 fake adapter。
2. `VerifiedInstitutionalIdentity`：Email OTP、未来 CAS/OAuth 各自完成交互后产出相同结果；账户与 session 不知道验证协议细节。

不要建立带大量 `provider_type` 分支的万能 login flow。未来 provider 可以有自己的 routes，只在已验证身份结果处汇合。

## HTTP 表面

所有 HTTP 接口位于 `/api`，业务路径位于 `/api/v1`。具体 schema 由 `packages/contracts` 生成 OpenAPI；稳定错误 code 是客户端逻辑契约，英文 message 仅用于诊断。

```text
GET    /api/health/live
GET    /api/health/ready

POST   /api/v1/auth/email/challenges
POST   /api/v1/auth/email/verifications
POST   /api/v1/accounts/registrations
GET    /api/v1/sessions
DELETE /api/v1/sessions/:session_id
DELETE /api/v1/sessions
GET    /api/v1/me
PATCH  /api/v1/me/profile
DELETE /api/v1/me

GET    /api/v1/terms
GET    /api/v1/terms/:term_id/courses
GET    /api/v1/courses/:course_id/class-sections
GET    /api/v1/comments/:comment_id/revisions

POST   /api/v1/sync

POST   /api/v1/admin/bootstrap
POST   /api/v1/admin/catalog/imports/plan
POST   /api/v1/admin/catalog/imports/:import_id/apply-all
GET    /api/v1/admin/reports
POST   /api/v1/admin/reports/:report_id/resolve
POST   /api/v1/admin/tasks/:source_task_id/merge
POST   /api/v1/admin/content/:content_id/hide
POST   /api/v1/admin/content/:content_id/restore
POST   /api/v1/admin/users/:user_id/suspend
POST   /api/v1/admin/users/:user_id/restore
POST   /api/v1/admin/users/:user_id/roles
GET    /api/v1/admin/audit
```

普通学生写操作进入 `/api/v1/sync`，不同时提供另一套 CRUD 写接口。管理、认证、目录查询和按需历史读取使用独立接口。

Bearer API 不使用 cookie。为第三方客户端支持 CORS 时不得启用 credentialed CORS；所有权限仍由 bearer session 决定，client metadata 只用于排错而不是认证。

## 数据模型

下表给出逻辑表及关键约束；实现时以 Drizzle schema 与已审查 migration SQL 为准。

| 表 | 关键内容与约束 |
|---|---|
| `users` | UUIDv7；`username_key` 唯一；公开资料；`active/suspended/deleted` |
| `user_roles` | `(user_id, role)` 唯一；至少保留一名 maintainer |
| `institutional_identities` | `(provider, normalized_subject)` 唯一；私有；删除账户时删除 |
| `auth_challenges` | HMAC、过期、尝试数、发送状态；同 subject 一个 current challenge |
| `sessions` | 随机 token 哈希、设备 metadata、last seen、idle/absolute expiry、revoked_at |
| `academic_terms` | 外部学期代码唯一；名称、日期、状态 override、source metadata |
| `courses` | `(term_id, external_course_code)` 唯一；课程名称、学分 |
| `class_sections` | `external_section_id` 唯一；课程、班号、开课单位、教师、校区、容量、课表文本、raw source、active |
| `followed_class_sections` | `(user_id, class_section_id)` 唯一；私人关系 |
| `course_tasks` | 教学班、创建者、可见状态；无标题或 deadline 字段 |
| `task_proposals` | task、作者、不可变公开字段、`content_fingerprint`；`(task_id, fingerprint)` 唯一 |
| `accuracy_votes` | `(user_id, proposal_id)` 唯一；`up/down`；撤回删除当前行或记录 none |
| `proposal_vote_totals` | 每提案 up/down 计数；与 vote 明细在同一事务更新 |
| `proposal_redirects` | source proposal 唯一、canonical proposal；任务合并时保留旧 ID 解析 |
| `personal_todos` | 所有者、可选教学班、title、可选 deadline、note、state、revision、deleted_at |
| `personal_task_details` | `(user_id, task_id)` 唯一；private title/deadline/note、revision |
| `personal_task_states` | `(user_id, task_id)` 唯一；`pending/completed/ignored`、revision |
| `task_comments` | task、作者、current revision、deleted_at、moderation state |
| `comment_revisions` | comment、单调 revision、不可变 body、作者和时间 |
| `content_reports` | 举报人、target、reason、private status、resolution；不公开举报人 |
| `task_merges` | source task 唯一、target task、maintainer、reason；禁止循环和跨教学班合并 |
| `moderation_actions` | hide/restore/suspend/restore 等动作及理由 |
| `operation_receipts` | `(user_id, operation_id)` 唯一；请求摘要与首次稳定结果；保留 180 天 |
| `sync_events` | 全局单调 sequence、event UUID、scope、type、schema version、payload；保留至少 180 天 |
| `catalog_imports` | checksum、manifest、文件名、行数、diff、actor、状态 |
| `audit_log` | append-only 管理动作、actor、target、reason、result、request ID |

### 不变式

- 所有关系通过内部 UUIDv7 引用；学校外部 ID 只作来源键。
- 创建 task 时必须同时创建初始 proposal、创建者赞成票和同步事件。
- proposal 不可更新或撤回；只有 moderation state 可改变。
- comment body 只能通过新增 revision 改变。
- 所有私人表必须从已认证 user ID 推导 owner，禁止信任 payload 中的 owner。
- mutable 私人数据和 comment edit 使用单调 revision 与 expected revision。
- task merge 只能发生在同一 teaching class，source 只能有一个最终 target，解析时跟随重定向到 canonical task。
- task merge 对完全相同 proposal 建立 redirect；重复 voter 同方向去重，相反方向撤回，再从 vote 明细重新计算 aggregate。
- task merge 的私人状态按产品规范的确定性优先级归并；若来源详情转为 personal todo，来源状态必须随该 todo 转出。
- 被删除或隐藏状态使用 tombstone/event 收敛，不能用物理删除破坏离线副本。
- 账户删除对公开贡献匿名化，对私人数据物理删除或不可恢复销毁。
- 账户删除同时删除该用户的 private sync event payload 与 operation receipts；全局 sequence 允许留下空洞，公开匿名化事件另行追加。

## 事务策略

每个 accepted 操作必须在单个数据库事务中同时完成：

1. 加载 fresh 权限与 expected revision。
2. 修改规范化当前状态。
3. 更新派生聚合计数。
4. 追加同步事件。
5. 保存 operation receipt。

同步批次按数组顺序处理，使用 savepoint 隔离每条操作。某条业务校验失败回滚到该 savepoint；后续独立操作继续，依赖失败操作的条目返回 `dependency_failed`。数据库连接、序列化或提交级故障必须回滚整个批次，不能返回虚假部分成功。

不要在数据库事务中等待 SMTP 或其他外部网络 I/O。验证码 module 使用 pending → send → activate 的明确状态机，新邮件发送成功后才替换旧 challenge。

## 数据库访问

- 默认用 Drizzle 表达 schema 和查询。
- 显式 SQL 必须参数化，并仅在 Drizzle 难以清晰表达事务、savepoint、锁或 PostgreSQL 特性时使用。
- 每个 Worker 请求创建、连接并在 `finally` 中关闭一个 `pg.Client`；不能把 client 或 request state 放入 module global。
- 生产连接只使用 `env.HYPERDRIVE.connectionString`。
- Hyperdrive query cache 对整个 MVP 配置禁用，避免 auth、revision 和 sync 的 stale read；仍使用连接池。
- migration 由部署 CLI 使用独立最小权限凭据直连 PostgreSQL；普通 runtime user 无 DDL 权限。
- migration SQL 必须生成、提交、审查，并在临时真实 PostgreSQL 验证从空库和上一版本升级。

## Workers 运行规范

新项目使用 `wrangler.jsonc`。示意配置只表达必须字段，真实 ID 与 secrets 不得提交：

```jsonc
{
  "name": "ddl-tracker-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-12",
  "compatibility_flags": ["nodejs_compat"],
  "preview_urls": true,
  "hyperdrive": [
    { "binding": "HYPERDRIVE", "id": "<cache-disabled-hyperdrive-id>" }
  ],
  "observability": {
    "enabled": true,
    "logs": { "head_sampling_rate": 1 },
    "traces": { "enabled": true, "head_sampling_rate": 0.01 }
  }
}
```

- 绑定类型必须由 `wrangler types` 生成，禁止手写 Env。
- non-secret config 放在 `vars`；SMTP 凭据、HMAC key 和 bootstrap token 使用 Workers secrets。
- 每个 Promise 必须 await、return 或交给 `ctx.waitUntil()`；lint 开启 no-floating-promises。
- 同步 JSON 有应用级大小上限；先检查可信格式的 `Content-Length`，读取时仍按实际 bytes 强制上限，不能只信 header，也不能缓冲无界输入。
- 不使用 module global 保存当前用户、数据库 client 或请求缓存。
- 使用 Web Crypto 生成 token、UUID 和 HMAC；不能使用 `Math.random()`。
- 错误通过结构化 JSON 映射，禁止 `passThroughOnException()`。
- 大量课程 CSV 在 admin CLI 本地解析，Worker 只接收有上限的规范化批次。

## 排名参考实现

`packages/contracts` 包含：

- 带显式版本号的 Wilson score 纯函数。
- 确定性 tie-break 与置信状态函数。
- 语言无关 JSON 输入/期望输出向量。
- schema version 与变更日志。

后端运行时不使用该实现挑选领先提案，只同步原始 aggregate。算法升级必须新增版本，不能在相同版本下改变结果。

## 不采用的架构

- 不做 event sourcing；当前状态表是权威数据。
- 不做服务端排名或页面聚合 read model。
- 不做多租户或预埋 `school_id`。
- 不让 admin CLI 直接写数据库。
- 不在 Worker 内调用 Cloudflare REST API访问可用 binding 的资源。
- 不引入抽象的客户端内核；未来原生客户端独立实现协议。

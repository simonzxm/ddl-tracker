# 安全与运维

本文定义生产安全基线、认证参数、数据隐私、部署、观测、备份和恢复。实现不能把这里的默认值当作无需监控的永久真理；调整配置必须保持协议行为并记录理由。

## 数据分类

### 公开给已登录校内用户

- 学期、课程与教学班目录。
- 课程任务、可见提案、聚合票数和当前评论。
- 用户名、显示名和公开贡献作者。

### 仅当前用户

- OIDC issuer/subject 与 Provider 返回的可选 email/profile claims。
- sessions 与设备 metadata。
- 关注教学班、个人待办、个人任务详情和个人任务状态。
- 自己的准确性判断。
- 自己提交的举报与处理状态。

### 仅维护者

- 举报人身份、举报正文和处理备注。
- 账户处置、角色与完整审计记录。
- 课程导入 raw source 与差异详情。

### Secrets

- session token、短期 OIDC exchange code、bootstrap token。
- OIDC transaction encryption key、session token pepper。
- Hyperdrive、Tunnel/VPC 与备份凭据。

日志、错误响应、OpenAPI 示例和测试 fixture 不能包含 secret 或真实私人正文。

## OIDC 认证

生产只信任配置中的 `OIDC_ISSUER` 与已注册 public client。登录使用 authorization code + PKCE S256：

- `/auth/oidc/start` 只接受严格 allowlist 中的客户端 callback。
- 服务端生成随机 state、nonce 与 PKCE verifier；数据库只保存 state HMAC，并用 `OIDC_TRANSACTION_SECRET` 通过 AES-GCM 加密 nonce/verifier。
- Provider callback 必须校验 state，原子 claim transaction，再向 token endpoint 兑换 code。
- ID Token 必须验证 RS256 signature、issuer、audience、expiry 与 nonce；账户身份只使用 `(issuer, subject)`。
- Provider callback 不把本地 bearer token放入 URL，只重定向一个 10 分钟内有效、单用途的 exchange code。
- transaction 状态为 `pending → exchanging → completed → consumed`，失败进入 `failed`；过期或完成记录最多保留 24 小时。
- discovery、token endpoint 与 JWKS 必须是 HTTPS，错误响应不得泄露 Provider payload、token 或内部 endpoint 细节。

OIDC Provider 是独立信任边界。Client ID、固定 callback 与客户端 callback allowlist 是 non-secret config；Provider client secret 不存在，PKCE 是必须条件。

## OIDC 自动建号与 session

OIDC exchange 成功时：

- 已有 `(issuer, subject)` identity：更新最后登录 metadata 并签发新的设备 session。
- 新 identity：从已验证 claims 生成稳定、唯一的初始 username，原子创建 user、OIDC identity 与 session；之后可通过 profile API 修改公开资料。

Session 使用至少 256 bits Web Crypto 随机 opaque bearer token：

- 响应只返回一次明文 token。
- 数据库保存固定长度 HMAC/hash 与 token ID，不保存明文。
- 每台设备独立记录 client metadata、created at、last seen、idle expiry 和 absolute expiry。
- 30 天无活动过期；创建后 180 天绝对过期，必须重新完成 OIDC 登录。
- last seen 按窗口节流更新，不能每请求写库。
- 用户可撤销单个或全部 session；暂停、删除账户立即撤销全部。
- Bearer token 只经 HTTPS 传输；客户端负责放入 Keychain/Keystore 等系统安全存储。

服务端不使用 JWT，因此权限、暂停和撤销总是 fresh DB read。Hyperdrive query cache 对该路径禁用。

## Authorization

每个写操作必须从 session 推导当前 user：

- 禁止信任 payload 中的 user ID、owner、author 或 role。
- 私人数据 query 必须同时包含当前 user ID 条件。
- 评论只有作者可修订或删除；维护者隐藏是另一种 moderation action。
- task/proposal/comment 必须属于活动学期和未隐藏 canonical task 才接受普通写入。
- 维护者 endpoints 同时检查 active session 与 maintainer role。
- 最后一名维护者不能被降级、暂停或删除，除非同一原子管理操作先建立另一名维护者。

首次维护者使用一次性 `MAINTAINER_BOOTSTRAP_TOKEN`：只有系统尚无维护者、调用者已完成校内注册时可使用。成功后写审计并永久关闭 bootstrap；token 随即删除或轮换。

## 限流与资源保护

限流分为 Cloudflare edge 层与 PostgreSQL 持久层。OIDC start 的源 IP 从 Cloudflare `CF-Connecting-IP` 获取，先加用途前缀并做 HMAC，再使用 PostgreSQL 计数；数据库不保存原始 IP，Worker module global 也不保存计数。WAF/Rate Limiting 在权限允许时作为更靠前的额外防线。

默认初始值：

| 范围 | 默认限制 |
|---|---|
| OIDC start / IP | 20/hour、50/day |
| OIDC callback / transaction | state、expiry 与原子 claim 限制为一次 |
| OIDC exchange code | 10 分钟内、单用途 |
| sync / user | 30/min，burst 5 |
| 普通 authenticated reads / user | 120/min |
| 管理 mutation / maintainer | 30/min |
| sync request body | 512 KiB |
| sync operations | 100 |

阈值是配置，不进入客户端逻辑。所有 429 响应包含 `retry_after`；错误 message 不说明具体命中范围。持续攻击应优先在 Cloudflare WAF/rate limiting 层拦截，数据库限流保证 IP 与账户规则在所有 Worker 实例间一致。

## 输入与内容安全

- 在读取 JSON 前验证 Content-Type 和应用级 body 上限。
- 所有不可信 JSON 通过 runtime schema 校验，禁止 `as` 断言替代验证。
- 纯文本字段只保存文本；客户端必须转义展示，不解释 HTML 或 Markdown。
- URL 只接受绝对 HTTPS URL；后端不主动 fetch 提案 URL，避免 SSRF。
- 文本统一 Unicode NFC；拒绝 NUL 与不允许控制字符。
- SQL 始终由 Drizzle 或参数化查询产生，禁止拼接输入。
- 错误响应不包含 SQL、stack、OIDC token/provider payload、数据库主机或 Cloudflare binding ID。

默认长度：

| 字段 | 长度 |
|---|---|
| username | 3–32 ASCII |
| display name | 1–64 Unicode scalar values |
| task/proposal/personal title | 1–200 |
| proposal description | 0–2,000 |
| evidence note | 0–500 |
| HTTPS URL | 0–2,048 bytes |
| comment body | 1–4,000 |
| private note | 0–4,000 |
| report reason | 1–2,000 |
| admin reason | 1–1,000 |

长度按规范化后值检查；API schema 必须说明按字符还是 UTF-8 bytes 计数。

## PostgreSQL 网络与权限

生产链路使用 [ADR 0006](./adr/0006-private-postgres-over-workers-vpc.md)：Hyperdrive → Workers VPC TCP service → remotely managed Cloudflare Tunnel → VPS PostgreSQL。

- PostgreSQL 不向公网监听或开放 5432，只允许本机/私网 tunnel connector 到达。
- VPS 上 `cloudflared` 以非 root service account 运行、开机启动、自动重启并监控 tunnel health。
- VPC service 使用 `app_protocol = postgresql`，TLS verification 使用 `verify_full`。
- PostgreSQL 使用 hostname 匹配的受信证书；禁止生产 `cert_verification_mode = disabled`。
- Runtime database user 只拥有所需 schema 的 DML/sequence 权限，无 DDL、role、extension 或其他 database 权限。
- Migration、backup 和 runtime 使用不同数据库角色与凭据。
- Migration role 只保存在独立、cache-disabled 的 Hyperdrive 中；该 Hyperdrive 平时不绑定任何 Worker。生产 migration 临时部署专用 Worker，完成或失败后删除，生产 API 永远不绑定该 Hyperdrive。
- `pg_hba.conf` 默认拒绝，按角色、database 和连接路径精确允许。
- 所有凭据有轮换和撤销步骤；rotation 后 remote smoke 必须通过。

若账户不支持 Workers VPC，允许退回 Tunnel + Access service auth；仍禁止直接开放全网数据库端口。

## Hyperdrive 与缓存

MVP 使用 cache-disabled Hyperdrive 配置，保留连接池，不使用 query cache。原因是 Hyperdrive 写入不会自动失效已缓存 SELECT，而 auth、session、revision 和 sync 需要 read-after-write freshness。

未来缓存只允许显式添加到可短暂陈旧的公共数据：

- 课程目录。
- 归档学期教学班快照。
- 不影响权限或同步正确性的公共查询。

未来实现应使用独立 cached binding 或明确 HTTP/CDN cache policy；认证、权限、私人数据、审核、同步、cursor 和写后读永远走 fresh binding。

## Secrets 与配置

- `wrangler.jsonc` 只保存 non-secret vars、binding names 和 resource IDs。
- Workers secrets 保存 OIDC transaction encryption key、token pepper、sync key 和 bootstrap token。
- 临时 Migration Worker 的一次性 token 通过权限为 `0600` 的临时 secrets file 注入，结束后随 Worker 和本地临时目录删除；不能复用生产 API secret。
- 本地 `.dev.vars`/`.env`、课程 CSV、数据库 dump、证书私钥和备份配置全部 gitignore。
- 绑定类型由 `wrangler types` 生成，config/binding 改动后必须重新生成并提交类型 diff。
- VPS secrets 使用 root-readable secret file 或专用 secret manager，不能出现在 shell history、systemd unit 明文或仓库。
- 日志不记录 OIDC subject、email、state、authorization code、exchange code 或 ID Token。

## Observability

Worker 开启 Workers Logs 与 traces，使用结构化 JSON。每个请求生成或接受可信格式 request ID，并关联：

- method、规范化 route、status、duration。
- authenticated user 的不可逆内部 diagnostic ID，不记录 OIDC subject 或 email。
- sync batch 的 operation 数、applied/rejected/replayed 数和 event 数。
- operation ID、import ID、audit ID 与数据库错误类别。
- OIDC discovery/token exchange 的脱敏结果类别和 latency，不记录 code、token、subject 或完整 email。

严禁记录 bearer token、OIDC state/authorization code/exchange code/ID Token、私人正文、评论正文、举报正文或 raw CSV 行。

健康检查：

- `/api/health/live` 只证明 Worker handler 可运行，不查数据库。
- `/api/health/ready` 用 fresh Hyperdrive 执行轻量 `SELECT 1` 和 schema version 检查，只返回通用 ready/not-ready，不暴露依赖信息。

初始告警至少覆盖 5xx rate、P95/P99 latency、数据库连接失败、OIDC discovery/token exchange 失败率、登录异常量、sync rejection spike、Tunnel disconnected 和备份失败。

## 本地、remote dev 与发布

项目不维护长期 staging。

### 本地

- `workerd`/Miniflare 运行 Worker。
- 临时真实 PostgreSQL 执行全部写入、事务、并发和 migration 测试。
- fake OIDC provider 覆盖 authorization、token exchange 与 claim verification。
- 真实课程数据不进入 fixture。

### Remote dev

上线前或依赖轮换后，`wrangler dev --remote` 临时在 Cloudflare 网络运行：

- 验证真实 Hyperdrive/VPC/Tunnel 链路与 `SELECT 1`。
- 验证 schema version 和 runtime database permissions。
- 使用维护者测试账户完成一次受控 OIDC 登录；不把 session token 写入日志。
- 默认不执行持久化业务写入；remote session 使用完即停。

### Preview 与发布

1. CI 通过 lint、types、unit、PostgreSQL integration、Worker runtime、contracts 和 migration tests。
2. 创建 production backup，并验证最近一次 restore drill 未过期。
3. 在本地临时 PostgreSQL 使用与生产相同的 generated bundle 和 migration executor 应用待发布 migrations。
4. 执行 `pnpm db:migrate:prod`，由临时 Migration Worker 通过独立 migration Hyperdrive 应用已审查 migration；不可事务化操作必须有单独 rollback/runbook。
5. `wrangler versions upload` 生成 Preview URL，限制为维护者访问。
6. 对 preview 运行 live、ready、OIDC 参数、OpenAPI、read-only API 与受控登录 smoke。
7. 部署已验证 version；发布后重复 smoke，并监控错误率。

Worker rollback 使用上一 version。数据库 migration 优先 forward-fix；破坏性 schema 变更必须使用 expand → migrate → contract，保证旧 Worker 在切流期间仍兼容。

## 备份与恢复

VPS 使用 pgBackRest 将加密备份与 WAL 持续归档到独立 R2 bucket：

- 每日增量、每周完整备份。
- 保留至少 30 天。
- R2 credential 只允许目标 bucket 所需操作，与 Worker secrets 分离。
- 备份加密 key 不与备份放在同一位置。
- 定期在临时 PostgreSQL 执行时间点恢复，运行 schema、行数与关键查询校验。
- 未通过恢复演练的备份不能视为可用。

目标初始值：RPO 不超过 WAL archive 可见延迟，RTO 以单机恢复演练实测记录；上线前必须记录实际基线，不凭空承诺分钟数。

## 数据保留与清理

| 数据 | 保留规则 |
|---|---|
| OIDC login transaction | consumed、failed 或过期后最多 24 小时 |
| revoked/expired session | 30 天诊断窗口后清理，保留必要审计引用 |
| operation receipts | 180 天 |
| sync events | 至少 180 天 |
| comment revisions | 评论存在期间保留；软删除后仅作者/维护者可见 |
| audit log | 长期 append-only，按运维政策归档 |
| catalog import metadata | 长期保留 checksum、manifest、diff 和结果 |
| private account data | 账户删除时删除 |
| public contributions | 账户删除后匿名保留 |

账户删除必须同步清理属于该用户的 private sync event payload 与 operation receipts，避免 180 天日志窗口继续保存私人正文。公开 event 与贡献改为引用不可关联的 deleted user tombstone，审计只保留非身份化内部引用。

清理任务在没有 Queues/cron 依赖的 MVP 中可由维护者 CLI 定期触发受保护 maintenance endpoint；操作必须有上限、可续跑并记录审计。以后可迁移到 Cron Trigger，但不能在普通请求中无界清理。

## 安全事件最低 runbook

- Session 泄露：撤销单 session/全部 sessions，轮换 pepper 需要全体重新登录。
- Database credential 泄露：撤销 role credential、更新 Hyperdrive/VPC config、验证最小权限和审计。
- OIDC transaction secret 泄露：立即轮换，使所有未完成 transaction/exchange code 失效，并审查异常 callback 与 token exchange 记录。
- 数据损坏：停止写入、保留证据、从时间点备份恢复到隔离数据库，比较后再切换。
- Tunnel 故障：检查 connector health、VPC service route、origin reachability 与 TLS，不能通过临时开放公网 5432 绕过。

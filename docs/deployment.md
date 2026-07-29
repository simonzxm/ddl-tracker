# 部署运行手册

本文是 DDL Tracker Worker、PostgreSQL migration、preview smoke、生产切流、回滚与恢复的可执行清单。安全基线与网络拓扑仍以[安全与运维](./security-and-operations.md)和[后端设计](./backend-design.md)为准。

## 生产前置条件

- Cloudflare 账户已创建 cache-disabled Hyperdrive，并通过 Workers VPC/Tunnel 连接只在私网监听的 PostgreSQL。
- PostgreSQL migration、runtime 和 backup 使用不同角色；runtime 角色没有 DDL、role 或 extension 权限。
- PostgreSQL TLS 使用 `verify_full`，证书 hostname 与连接目标匹配。
- pgBackRest 最近一次完整/增量备份成功，且最近一次隔离恢复演练仍在运维允许窗口内。
- 飞书 SMTP credential 已创建；只允许 TLS 端口 465 或 587。
- 应用内 PostgreSQL 限流已为 `POST /api/v1/auth/email/challenges` 配置源 IP 限制：20/hour、50/day。源 IP 必须来自 Cloudflare `CF-Connecting-IP`，数据库只保存带用途前缀的 HMAC。权限允许时再配置等价的 Cloudflare WAF/Rate Limiting 作为额外边缘防线。
- 发布者已通过 `pnpm verify` 或 CI 的 `pnpm verify:ci`。

## 创建生产配置

生产配置不会提交仓库。复制模板：

```bash
cp apps/api/wrangler.production.example.jsonc \
  apps/api/wrangler.production.jsonc
```

至少替换：

- Worker name。
- Hyperdrive config ID。
- 允许的校内邮箱域名，多个域名用逗号分隔。
- SMTP host、port、from address 和 display name。

配置必须保持：

- `APP_ENVIRONMENT = production`。
- `nodejs_compat`。
- 当前 Workers Free plan 不配置 `limits.cpu_ms`；专用目录上传限制 multipart 5 MiB、gzip 4 MiB、解压 CSV 10 MiB，并将规范化数据分为每类最多 100 条的存储 batch。升级到付费 Standard plan 后才可显式配置 CPU budget。
- retention cleanup cron。
- Workers logs 与 traces 开启。

应用内 PostgreSQL 限流覆盖 source IP（20/hour、50/day）、email identity（1/min、5/hour、10/day）、sync user（5/10 seconds、30/min）、authenticated read（120/min）和 admin mutation（30/min）。Cloudflare 边缘 IP 规则是额外防线，不能替代应用内计数。

执行本地保护检查：

```bash
pnpm deploy:check
```

也可检查其他路径：

```bash
WRANGLER_PRODUCTION_CONFIG=apps/api/wrangler.production.jsonc \
  pnpm deploy:check
```

## 注入 Worker secrets

以下命令由 Wrangler 交互读取值，不要把 secret 写入命令行、shell history、仓库或 CI 日志：

```bash
cd apps/api
pnpm exec wrangler secret put OTP_HMAC_SECRET \
  --config wrangler.production.jsonc
pnpm exec wrangler secret put TOKEN_PEPPER \
  --config wrangler.production.jsonc
pnpm exec wrangler secret put SYNC_TOKEN_SECRET \
  --config wrangler.production.jsonc
pnpm exec wrangler secret put MAINTAINER_BOOTSTRAP_TOKEN \
  --config wrangler.production.jsonc
pnpm exec wrangler secret put SMTP_USERNAME \
  --config wrangler.production.jsonc
pnpm exec wrangler secret put SMTP_PASSWORD \
  --config wrangler.production.jsonc
```

OTP HMAC、token pepper、sync token 和 bootstrap token 使用独立的至少 32-byte 随机值，不能复用。bootstrap 成功后立即轮换或删除 bootstrap secret。

## Migration

生产 migration 使用 [ADR 0009](./adr/0009-ephemeral-worker-database-migrations.md) 定义的临时 Migration Worker。它通过独立 migration Hyperdrive 复用现有 Workers VPC service 与 Tunnel；不需要 SSH、数据库公网入口或 VPS 上的额外程序。生产 API Worker 始终只持有 runtime role。

### 首次配置

确认 PostgreSQL 已有独立 migration role，并且该 role 只能访问目标 database、拥有应用 schema 所需 DDL 权限且不能管理 role、extension 或其他 database。然后执行：

```bash
pnpm db:migrate:setup
```

命令读取已忽略的 `apps/api/wrangler.production.jsonc`，取得 runtime Hyperdrive 使用的 database 与 VPC service，创建或验证名为 `ddl-tracker-postgres-migration` 的 cache-disabled Hyperdrive，并写入权限为 `0600`、不提交仓库的 `apps/migration-worker/wrangler.production.jsonc`。第一次创建时会无回显读取 migration role 密码；非交互环境可临时设置 `DDL_TRACKER_MIGRATION_DATABASE_PASSWORD`。密码只作为 Wrangler 子进程参数传递给 Cloudflare，不写入配置文件、仓库或日志。

若 role 或 Hyperdrive 名称不同，可分别设置 `DDL_TRACKER_MIGRATION_ROLE` 与 `DDL_TRACKER_MIGRATION_HYPERDRIVE_NAME`。已存在的 Hyperdrive 必须与 runtime Hyperdrive 使用同一 VPC service 和 database、使用预期 migration role，并禁用 query cache，否则配置命令拒绝继续。

### 每次 migration

生成 migration 时继续使用：

```bash
pnpm --filter @ddl-tracker/api db:generate
```

该命令同时从 Drizzle `_journal.json` 和 SQL 生成临时 Worker 的不可变 migration bundle；SQL、journal、bundle 和 `latestMigrationHash` 必须一起提交并审查。不得修改已经发布的 migration。

生产 migration 前：

1. 创建并验证 production backup。
2. 记录当前 Worker version 和当前 schema migration journal。
3. 确认最近一次 restore drill 仍在允许窗口内。
4. 确认 migration SQL 已人工审查；不可事务化步骤必须有单独 runbook，不能使用一键命令。
5. 确认当前 Git 工作树与 index 干净，待执行 migration 已提交。
6. 执行：

```bash
pnpm db:migrate:prod
```

该命令自动完成：

1. 验证 Wrangler 生成物、Drizzle journal、migration bundle 和最新 hash 一致。
2. 用 Docker PostgreSQL 从空库走生产 migration executor，并运行完整 PostgreSQL integration suite。
3. dry-run 构建 Migration Worker。
4. 生成包含 Git SHA 的随机 Worker 名称和 32-byte 一次性 token。
5. 将 token 通过权限为 `0600` 的临时 secrets file 注入并部署 Worker。
6. 调用唯一的 `POST /migrate`；Worker 验证目标 database/role、获取 advisory transaction lock、验证 journal 是 bundle 的精确前缀，并在同一个事务中应用 pending migration。
7. 验证最新 journal hash，输出 applied migration。
8. 无论成功或失败都删除临时 Worker；删除失败时输出精确的 `wrangler delete ... --force` 清理命令。

本地不保存生产 `DATABASE_URL`，调用请求不能携带 SQL、database、role 或 migration 选择。独立 migration Hyperdrive 可以保留，但平时不绑定任何 Worker。

迁移后用 runtime role 通过 `/api/health/ready` 和 smoke 验证连接与当前 Worker 所需 schema；runtime role 不得执行 DDL。

### 失败处理

- Worker 内 migration 失败会回滚全部 pending migration；命令不会自动 restore backup。
- journal 出现未知 hash、被修改的历史 migration、时间戳空洞、错误 database 或错误 role 时，在执行 DDL 前失败。
- 同时运行的 migration 由 PostgreSQL advisory transaction lock 串行化；锁等待受 `lock_timeout` 限制。
- 临时 Worker 调用或部署失败后仍会尝试删除；若自动清理失败，必须立即执行错误中给出的命令并在 Cloudflare dashboard 确认不存在该 Worker。
- 当前链路不能调用 VPS 上的 pgBackRest。backup 创建、WAL archive 检查和 restore drill 验证必须在 migration 命令之外完成，不能因为“一键”而省略。

破坏性变更必须采用 expand → migrate → contract。数据库回滚默认使用 forward-fix；不能在无法证明安全时反向执行 destructive migration。

`/api/health/ready` 验证当前 Worker 所需的 migration 已出现在 journal 中；它允许数据库继续向前迁移，但不承诺旧 Worker 与任意后续 contract migration 兼容。执行 contract 前必须确认新 Worker 已完成切流和 smoke；执行后若旧版本依赖已删除的 schema，禁止直接回滚旧 Worker。

## Remote dev smoke

Remote dev 只用于短期验证 Cloudflare 网络、Hyperdrive、Tunnel 和 SMTP；完成后立即停止：

```bash
cd apps/api
pnpm exec wrangler dev --remote --config wrangler.production.jsonc
```

只向维护者 allowlist 邮箱发送一封验证码，不执行目录导入、审核、合并或其他持久化业务写入。

## 上传 preview version

```bash
cd apps/api
pnpm exec wrangler versions upload \
  --config wrangler.production.jsonc
```

保存输出的 version ID 和 preview URL。Preview 必须限制为维护者访问。

运行未认证只读 smoke：

```bash
DDL_TRACKER_BASE_URL='https://preview.example.workers.dev' \
  pnpm smoke
```

使用专用维护者测试 session 增加已认证目录与 account snapshot smoke：

```bash
DDL_TRACKER_BASE_URL='https://preview.example.workers.dev' \
DDL_TRACKER_SMOKE_TOKEN='opaque-session-token' \
  pnpm smoke
```

命令不会打印 token。Smoke 包含 live、ready、OpenAPI、无效 auth 参数、目录读取和只读 account snapshot。

## 切流生产

确认 preview smoke、SMTP allowlist 投递、数据库权限和日志均正常后，将已验证 version 切到 100%：

```bash
cd apps/api
pnpm exec wrangler versions deploy VERSION_ID@100% \
  --config wrangler.production.jsonc
```

部署后立即重复 smoke，并观察：

- 5xx rate 与 P95/P99 latency。
- PostgreSQL/Hyperdrive 连接失败。
- SMTP 失败率。
- sync rejection spike。
- Tunnel health。
- retention cron 最近一次结果。
- retention 结果中的 `catalog_imports` 数量；正常情况下应接近 0，持续增长表示维护者生成 plan 后未处理。

## Worker 回滚

列出版本和当前 deployment：

```bash
cd apps/api
pnpm exec wrangler versions list \
  --config wrangler.production.jsonc
pnpm exec wrangler deployments status \
  --config wrangler.production.jsonc
```

将上一个已知正常 version 恢复到 100%：

```bash
pnpm exec wrangler versions deploy PREVIOUS_VERSION_ID@100% \
  --config wrangler.production.jsonc
```

回滚后重复 smoke。若新 migration 已使旧 Worker 不兼容，禁止直接切回；先执行经过审查的 forward-fix 使 schema 恢复兼容。

## PostgreSQL 恢复演练

恢复必须在隔离实例进行：

1. 使用 pgBackRest 从指定 backup/WAL target 恢复。
2. 使用 migration role 检查 schema journal。
3. 运行 `SELECT 1`、核心表行数、FK/unique 约束抽样和只读业务查询。
4. 使用测试 Worker/本地 API 指向隔离实例，运行 smoke 和关键 PostgreSQL integration tests。
5. 记录日期、backup ID、目标时间、恢复耗时、实际 RPO/RTO、验证结果和发现的问题。

未通过恢复演练的备份不能视为可用，也不能作为发布前置条件中的“已验证备份”。

## Secret 轮换

- Session 泄露：撤销对应 session；轮换 `TOKEN_PEPPER` 会使所有现有 session 失效。
- OTP HMAC 泄露：轮换后所有未使用 challenge 失效。
- Sync token 泄露：轮换后 cursor/snapshot token 失效，客户端重新 bootstrap。
- SMTP 泄露：先在飞书撤销 credential，再更新 Worker secret并执行 allowlist smoke。
- Database credential 泄露：撤销 PostgreSQL role credential，更新 Hyperdrive，验证最小权限和 Tunnel/TLS，再恢复流量。

任何轮换都必须记录变更理由、操作者、开始/结束时间、验证结果和回滚路径；不得把 secret 值写入记录。

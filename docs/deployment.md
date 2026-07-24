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

先使用临时 PostgreSQL 从空库重放全部 migration：

```bash
pnpm test:postgres:docker
```

生产 migration 前：

1. 创建并验证 production backup。
2. 记录当前 Worker version 和当前 schema migration journal。
3. 确认 migration SQL 已人工审查；不可事务化步骤必须有单独 runbook。
4. 使用 migration role，而不是 Worker runtime role：

```bash
DATABASE_URL='postgresql://migration-role@private-host/database' \
  pnpm --filter @ddl-tracker/api db:migrate
```

5. 用 runtime role 验证 `SELECT 1` 和读取 migration journal，但不得执行 DDL。

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

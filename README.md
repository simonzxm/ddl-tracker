# DDL Tracker

DDL Tracker 是面向单个学校的课程待办后端。学生关注教学班，在共享课程任务上共同提交截止时间提案、判断准确性和讨论，同时维护只有自己可见的待办、任务详情与完成状态。

MVP 包含 Cloudflare Worker API、PostgreSQL 数据模型与迁移、离线同步协议、维护者审核接口，以及从 `at-nju/courses` 自动同步的课程目录；不包含 Web、PWA、原生客户端或 TypeScript 客户端内核。

## 已实现能力

- OIDC authorization code + PKCE 登录、自动建号、opaque bearer session、账户资料与删除。
- 学期、课程、教学班查询，以及按固定 GitHub commit 下载、校验并原子应用的每日课程目录同步。
- 账户快照、教学班快照、增量 push/pull、幂等 receipt 与 cursor retention。
- 共享任务、不可变提案、准确性判断、评论修订与举报。
- 私人待办、私人任务详情、个人任务状态与显式发布。
- 维护者 bootstrap、角色、账户处置、内容审核、任务合并与审计。
- OpenAPI 3.1、Wilson score 参考实现和语言无关测试向量。
- Cloudflare Workers + Hyperdrive 生产入口、OIDC Provider 集成、课程目录 Cron 和定时数据清理。

明确不做：任何客户端 UI、多学校、学生创建课程、提醒或推送、日历订阅、任务类型枚举、服务端排名、全文任务搜索、多 Provider 账户绑定、管理后台。

## 环境要求

- Node.js 24 或更新版本。
- pnpm 11.15.0。
- PostgreSQL 17；本地全量测试可使用 Docker。
- Cloudflare Wrangler 登录，仅在 remote smoke、preview 或部署时需要。

安装依赖：

```bash
pnpm install --frozen-lockfile
```

## 本地验证

不连接 PostgreSQL 的快速检查：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

使用本地 Docker 启动临时 PostgreSQL、从空库应用全部 migration，并运行全部 integration tests：

```bash
pnpm test:postgres:docker
```

验证 Wrangler 生成类型与配置一致：

```bash
pnpm verify:generated
```

完整发布前门禁：

```bash
pnpm verify
```

## 本地 Worker

复制仅含占位值的开发 secrets 模板：

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

创建本地 PostgreSQL/Hyperdrive 配置后运行：

```bash
pnpm --filter @ddl-tracker/api dev
```

`/api/health/live` 不访问数据库；`/api/health/ready` 使用 fresh Hyperdrive 连接执行数据库检查。OpenAPI 位于 `/api/openapi.json`。

## 生产发布

生产数据库 migration 不要求 SSH、公开 PostgreSQL 或修改 VPS。第一次使用时配置独立 migration Hyperdrive：

```bash
pnpm db:migrate:setup
```

之后从干净、已提交的工作树一键完成本地验证、临时 Migration Worker 部署、migration、结果验证和 Worker 删除：

```bash
pnpm db:migrate:prod
```

该命令不会创建或验证 VPS 上的 pgBackRest backup；发布者必须先按运行手册确认可用 backup。生产配置、secret 注入、完整 migration 前置条件、preview smoke、部署、回滚和恢复步骤见 [部署运行手册](./docs/deployment.md)。`apps/api/wrangler.jsonc` 仅用于开发、类型生成和 dry-run，不能未经检查直接作为生产配置。

## 阅读顺序

1. [CONTEXT.md](./CONTEXT.md) — 项目统一领域语言。
2. [产品规范](./docs/product-spec.md) — 用户行为、状态和边界。
3. [后端设计](./docs/backend-design.md) — modules、数据模型、事务和技术栈。
4. [同步协议](./docs/sync-protocol.md) — 快照、游标、操作、事件和冲突。
5. [课程目录自动同步](./docs/catalog-sync.md) — GitHub 快照发现、CSV 校验和原子写入。
6. [安全与运维](./docs/security-and-operations.md) — 认证、隐私、部署、备份和观测。
7. [测试规范](./docs/testing.md) — 验收矩阵与发布门槛。
8. [架构决策](./docs/adr/) — 难以逆转且需要保留理由的决定。

## 文档权威性

- 领域词义以 `CONTEXT.md` 为准。
- 用户可观察行为以产品规范为准。
- 协议行为以同步协议和生成的 OpenAPI 为准。
- ADR 解释为什么作出决定，但不重复定义完整行为。
- 若代码与文档冲突，在修改实现前必须先判断是实现偏离规范，还是规范需要通过明确决策更新。

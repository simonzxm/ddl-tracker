# DDL Tracker

DDL Tracker 是面向单个学校的课程待办后端。学生关注教学班，在共享课程任务上共同提交截止时间提案、判断准确性和讨论，同时维护只有自己可见的待办、任务详情与完成状态。

> 当前仓库处于设计完成、等待实现的阶段。MVP 只包含后端、维护者 CLI、协议契约和官方排名参考实现，不包含 Web、PWA、原生客户端或 TypeScript 客户端内核。

## MVP 交付范围

- Cloudflare Workers HTTP API。
- 校内邮箱验证码认证、opaque bearer session 和账户管理。
- 学期、课程、教学班目录导入与查询。
- 双向离线同步协议、当前状态快照和增量事件。
- 共享课程任务、不可变任务提案、准确性判断和任务评论。
- 私人待办、课程任务下的个人详情以及个人任务状态。
- 举报、内容隐藏、重复任务合并、账户处置和审计。
- 维护者 CLI；CLI 只调用受保护的后端接口。
- Wilson score 官方参考实现与语言无关测试向量。

不在 MVP 中：任何客户端 UI、多学校、学生创建课程、提醒或推送、日历订阅、任务类型枚举、服务端排名、全文任务搜索、CAS/OAuth、管理后台。

## 阅读顺序

1. [CONTEXT.md](./CONTEXT.md) — 项目统一领域语言。
2. [产品规范](./docs/product-spec.md) — 用户行为、状态和边界。
3. [后端设计](./docs/backend-design.md) — modules、数据模型、事务和技术栈。
4. [同步协议](./docs/sync-protocol.md) — 快照、游标、操作、事件和冲突。
5. [课程导入](./docs/course-import.md) — CSV 映射、校验和幂等导入。
6. [安全与运维](./docs/security-and-operations.md) — 认证、隐私、部署、备份和观测。
7. [测试规范](./docs/testing.md) — 验收矩阵与发布门槛。
8. [架构决策](./docs/adr/) — 难以逆转且需要保留理由的决定。

## 技术方向

- TypeScript、pnpm workspace、Hono。
- Cloudflare Workers + Hyperdrive。
- Workers VPC + Cloudflare Tunnel 连接 VPS PostgreSQL。
- Drizzle ORM + `pg`；默认使用 Drizzle，复杂事务可使用显式 SQL。
- 飞书企业邮箱 SMTP，通过可替换邮件投递 interface 发送验证码。
- PostgreSQL 是业务权威数据源；同步事件日志不是 event sourcing。

## 文档权威性

- 领域词义以 `CONTEXT.md` 为准。
- 用户可观察行为以产品规范为准。
- 协议行为以同步协议和生成的 OpenAPI 为准。
- ADR 解释为什么作出决定，但不重复定义完整行为。
- 若代码与文档冲突，在修改实现前必须先判断是实现偏离规范，还是规范需要通过明确决策更新。

课程原始 CSV 由外部管理系统追踪，不提交本仓库。仓库只保存导入契约、假数据 fixture 和导入批次的数据库审计要求。

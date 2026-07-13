# 架构决策索引

ADR 只记录难以逆转、缺少上下文会令人意外、并经过真实取舍的决定。完整行为仍由产品、后端和同步规范定义。

- [0001：为官方客户端统一任务提案排名](./0001-unified-client-side-proposal-ranking.md)
- [0002：使用 Workers、Hyperdrive 与自建 PostgreSQL](./0002-workers-hyperdrive-postgres.md)
- [0003：在已验证校内身份处分隔认证方式与账户会话](./0003-authentication-seams.md)
- [0004：用单一双向同步接口承载学生离线操作](./0004-bidirectional-sync.md)
- [0005：同步事件日志不是业务事实来源](./0005-transactional-sync-log-not-event-sourcing.md)
- [0006：通过 Workers VPC 私网连接 PostgreSQL](./0006-private-postgres-over-workers-vpc.md)
- [0007：MVP 是单学校部署而非多租户系统](./0007-single-school-deployment.md)
- [0008：在共享课程任务上保留每用户私人覆盖](./0008-shared-tasks-with-private-overlays.md)

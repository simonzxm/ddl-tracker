---
status: accepted
---

# 使用临时 Worker 执行生产数据库 migration

生产 PostgreSQL 只经 Workers VPC service 与现有 Cloudflare Tunnel 可达，发布者不能直接连接数据库，也不能依赖 SSH 或在 VPS 上部署额外 migration agent。生产 migration 因此由本地发布命令临时部署一个专用 Cloudflare Worker；该 Worker只在一次 migration 期间绑定独立、cache-disabled 的 migration Hyperdrive，并在完成或失败后立即删除。

Migration Hyperdrive 复用 runtime Hyperdrive 所在的 VPC service，但使用拥有所需 DDL 权限的独立 PostgreSQL role。它可以长期保留为 Cloudflare resource，却不绑定到任何永久 Worker。生产 API Worker 继续只绑定 runtime Hyperdrive，不能获得 DDL 权限。

本地命令只能部署仓库构建时生成的 migration bundle，调用者不能提交任意 SQL、数据库地址或 migration 名称。临时 Worker 使用一次性随机 bearer token，连接后验证 database 与 role、获取 PostgreSQL advisory transaction lock、要求数据库 journal 是 bundle 的精确前缀，并在一个事务中执行全部 pending migration。不可事务化步骤必须使用独立 runbook，不能塞入该一键路径。

相比开放 PostgreSQL、公网代理或永久 DDL endpoint，这一方案不改变 VPS、不扩大数据库网络暴露面，也不让生产 API 持有 DDL credential。代价是 migration 依赖 Cloudflare Workers/Hyperdrive 可用性，且无法从这条链路主动运行 VPS 上的 pgBackRest；生产 backup 的创建和验证仍是 migration 前的独立运维前置条件。

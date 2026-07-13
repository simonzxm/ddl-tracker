---
status: accepted
---

# 使用 Workers、Hyperdrive 与自建 PostgreSQL

后端运行在 Cloudflare Workers，通过 Hyperdrive 访问部署在自建 VPS 上的 PostgreSQL；PostgreSQL 是业务数据的权威存储。相比 D1 或完全托管的数据库，这一组合增加了数据库运维与网络配置责任，但保留 PostgreSQL 能力和数据控制权，并让 Workers 专注于认证、业务校验与同步 API。

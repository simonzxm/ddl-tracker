---
status: accepted
---

# 通过 Workers VPC 私网连接 PostgreSQL

生产 Worker 通过 Hyperdrive、Workers VPC TCP service 和 remotely managed Cloudflare Tunnel 访问 VPS 上的 PostgreSQL；数据库不向公网开放 5432，并要求端到端 TLS 验证。相比公开数据库端口并维护 Cloudflare IP allowlist，这增加了 tunnel connector 的运维责任，但显著缩小数据库网络暴露面；若账户无法使用 Workers VPC，回退到 Tunnel + Access。

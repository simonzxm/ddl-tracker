# 2026-07-25 PostgreSQL 恢复演练

结果：通过。

## 恢复目标

- pgBackRest stanza：`ddl-tracker`
- 仓库：`repo2`（Cloudflare R2，加密）
- backup ID：`20260724-144816F_20260725-114657I`
- backup start：`2026-07-25T03:46:57Z`
- backup stop / 本次恢复点：`2026-07-25T03:47:03Z`
- 恢复模式：`type=immediate`、`target-action=promote`、`archive-mode=off`

本次演练固定在所选 backup stop，不继续回放该恢复点之后的归档 WAL。因此下面的 RPO 是这个固定恢复点的数据年龄，不代表 repo2 当前可达到的最晚 PITR 点。

## 隔离措施

- 演练开始前确认生产集群仍在 `127.0.0.1:5432`，data directory 为 `/var/lib/postgresql/17/main`。
- 使用 `mktemp` 创建 `/var/tmp/ddl-tracker-restore-drill.*`，并在恢复和启动命令中显式覆盖 data directory。
- 恢复实例使用端口 `55432`、独立 Unix socket、独立 external PID file，只监听 `127.0.0.1`；关闭归档和 SSL。
- 生产 PostgreSQL 未停止或重载。演练前后 `postgresql.service` 均为 active，生产 `SELECT 1` 均成功。
- 验证结束后以 fast mode 停止恢复实例；确认 `55432` 不再监听后，仅在路径前缀校验通过时删除临时目录。

## 时间结果

所有时间均为 UTC，耗时从 `2026-07-25T04:06:36Z` 开始计算。

| 指标 | 结果 |
| --- | ---: |
| 文件恢复完成 | 131.266 秒 |
| 数据库开始接受只读连接 | 133.088 秒 |
| immediate recovery 完成并 promotion（RTO） | 138.292 秒 |
| 全部验证完成 | 138.501 秒 |
| 所选恢复点到演练开始（RPO） | 1,173 秒（19 分 33 秒） |
| 临时实例停止 | `2026-07-25T04:08:54Z` |

## 验证结果

- migration journal 共 9 条，最新为 ID `9`、hash `f9d97e605bc82537a0b8ef02871e3301253321b29f435b67ed71a84fb91b9c4b`，对应 `0008_volatile_adam_destine.sql`。该备份按预期不含后续 `0009_overrated_photon.sql`。
- 数据量为 1 个学期、1,909 门 active 课程、3,048 个 active 教学班。
- 成功导入 `019f9470-4ee8-78b7-b75d-0ed032d5da01` 存在，状态为 `applied`，31/31 batch 已应用，`row_count=3048`。
- 备份时点包含 1 个 applied import 和 3 个 planned import；后者是在该恢复点之后于生产完成审计取消，因此备份中保留 planned 状态符合预期。
- 课程到学期、教学班到课程的 orphan 数均为 0。
- `(term_id, external_course_code)` 和 `external_section_id` 重复数均为 0，未验证的 PK、unique、FK、check constraint 数为 0。
- 抽样课程代码、名称、学分和教学班聚合可正常读取。
- `pg_amcheck --parent-check --heapallindexed` 通过。

准备阶段的一次恢复读取发现原先把 `0009` 误认为已包含在备份中的断言不正确；该临时实例随即停止并清理。修正预期后从 repo2 全新恢复，以上 RTO/RPO 和验证结果仅取自第二次完整成功演练。

## 结论

指定的 repo2 备份能够独立恢复、完成一致性恢复和 promotion，并通过 schema、目录数据、导入状态、关系完整性、唯一性和物理页检查。本次演练未发现备份损坏或生产隔离问题。

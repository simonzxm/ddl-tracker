# 2026-07-25 PostgreSQL 恢复演练

结果：通过。固定备份恢复和最新可见 WAL 的 PITR 均完成验证。

## 恢复目标

- pgBackRest stanza：`ddl-tracker`
- 仓库：`repo2`（Cloudflare R2，加密）
- backup ID：`20260724-144816F_20260725-114657I`
- backup start：`2026-07-25T03:46:57Z`
- backup stop / 本次恢复点：`2026-07-25T03:47:03Z`
- 固定备份恢复模式：`type=immediate`、`target-action=promote`、`archive-mode=off`
- 最新 WAL PITR target：`0/B90000C8`，位于 segment `0000000100000000000000B9`

先固定在所选 backup stop 验证备份集自身，再单独生成不修改业务表的 PostgreSQL restore point、切换 WAL，并从 repo2 恢复到该 LSN。实际 RPO 基线采用第二次验证测得的 WAL archive 可见延迟；固定备份的数据年龄仅作为诊断信息。

## 隔离措施

- 演练开始前确认生产集群仍在 `127.0.0.1:5432`，data directory 为 `/var/lib/postgresql/17/main`。
- 使用 `mktemp` 创建 `/var/tmp/ddl-tracker-restore-drill.*`，并在恢复和启动命令中显式覆盖 data directory。
- 恢复实例使用端口 `55432`、独立 Unix socket、独立 external PID file，只监听 `127.0.0.1`；关闭归档和 SSL。
- 最新 WAL 实例的临时 HBA 仅允许本机连接；本地测试通过 root SSH tunnel 访问，Worker HTTP 只监听本机。临时 HBA、tunnel 和本地 Wrangler 配置均在演练后删除。
- 生产 PostgreSQL 未停止或重载。演练前后 `postgresql.service` 均为 active，生产 `SELECT 1` 均成功。
- 验证结束后以 fast mode 停止恢复实例；确认 `55432` 不再监听后，仅在路径前缀校验通过时删除临时目录。

## 固定备份时间结果

所有时间均为 UTC，耗时从 `2026-07-25T04:06:36Z` 开始计算。

| 指标 | 结果 |
| --- | ---: |
| 文件恢复完成 | 131.266 秒 |
| 数据库开始接受只读连接 | 133.088 秒 |
| immediate recovery 完成并 promotion（RTO） | 138.292 秒 |
| 全部验证完成 | 138.501 秒 |
| 所选备份恢复点到演练开始的数据年龄 | 1,173 秒（19 分 33 秒） |
| 临时实例停止 | `2026-07-25T04:08:54Z` |

## 最新 WAL RPO 与 PITR

- `2026-07-25T04:24:57Z` 创建不修改业务表的 restore point，target LSN 为 `0/B90000C8`，随后调用 `pg_switch_wal()`。
- `2026-07-25T04:25:03Z` 已能用 repo2 的 `archive-get` 取回完整的 16 MiB target segment。
- WAL archive 可见延迟为 5.422 秒，作为本次实测 RPO 基线。
- 从 repo2 指定备份开始恢复并回放到 target LSN；文件恢复 130.827 秒，完成 PITR 和 promotion 的 RTO 为 140.719 秒。
- 最新 WAL 实例包含 migration 0009、1 个 applied import、0 个 planned import、3 个 cancelled import 和对应 3 条取消审计；active 课程/教学班仍为 1,909/3,048。
- 最新 WAL 实例再次通过关系完整性断言和 `pg_amcheck --parent-check --heapallindexed`。

## 验证结果

- migration journal 共 9 条，最新为 ID `9`、hash `f9d97e605bc82537a0b8ef02871e3301253321b29f435b67ed71a84fb91b9c4b`，对应 `0008_volatile_adam_destine.sql`。该备份按预期不含后续 `0009_overrated_photon.sql`。
- 数据量为 1 个学期、1,909 门 active 课程、3,048 个 active 教学班。
- 成功导入 `019f9470-4ee8-78b7-b75d-0ed032d5da01` 存在，状态为 `applied`，31/31 batch 已应用，`row_count=3048`。
- 备份时点包含 1 个 applied import 和 3 个 planned import；后者是在该恢复点之后于生产完成审计取消，因此备份中保留 planned 状态符合预期。
- 课程到学期、教学班到课程的 orphan 数均为 0。
- `(term_id, external_course_code)` 和 `external_section_id` 重复数均为 0，未验证的 PK、unique、FK、check constraint 数为 0。
- 抽样课程代码、名称、学分和教学班聚合可正常读取。
- `pg_amcheck --parent-check --heapallindexed` 通过。

## Worker 与集成测试

- 通过 SSH tunnel 将本地端口转发到最新 WAL 恢复实例的 `127.0.0.1:55432`。
- 在同一临时集群创建独立的 `ddl_tracker_restore_test`，执行 migration upgrade test 和完整 PostgreSQL integration suite：81 个 test files、352 个 tests 全部通过。恢复出的 `ddl_tracker` 未被测试 reset。
- 本地 Wrangler/Workerd 使用临时 Hyperdrive `localConnectionString` 指向恢复出的 `ddl_tracker`；`live`、`ready`、OpenAPI 和非法认证参数 smoke 全部通过。
- 专用 gzip upload 与 cancel 路由在该本地 Worker 上未认证均返回 401。
- 测试结束后依次停止 Workerd、SSH tunnel 和恢复 PostgreSQL；确认生产 5432 仍在线后删除远端恢复目录、临时 HBA 和本地临时配置。

准备阶段的一次恢复读取发现原先把 `0009` 误认为已包含在备份中的断言不正确；该临时实例随即停止并清理。修正预期后从 repo2 全新恢复，以上 RTO/RPO 和验证结果仅取自第二次完整成功演练。

## 结论

指定的 repo2 备份能够独立恢复，也能通过归档 WAL 恢复到最新测量 LSN 并完成 promotion。恢复实例通过 schema、目录数据、导入状态、关系完整性、唯一性、物理页、Worker smoke 和完整 PostgreSQL integration tests。本次演练未发现备份损坏、WAL 缺失或生产隔离问题。

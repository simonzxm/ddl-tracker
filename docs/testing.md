# 测试规范

测试目标不是覆盖实现行数，而是证明产品不变式、事务边界、同步收敛和隐私边界。接口是主要测试表面；内部重构不应迫使行为测试重写。

## 发布质量门槛

每个 release 必须通过：

- TypeScript strict typecheck。
- lint，包括 `no-floating-promises`、禁止 `any` binding/handler 和无解释 suppressions。
- `wrangler types` 生成结果与 `wrangler.jsonc` 一致。
- OpenAPI 与同步 schema 生成结果已提交且无未审查 diff。
- 单元、真实 PostgreSQL integration、Workers runtime 和 contract tests。
- 从空库与上一 release schema 的 migration tests。
- 课程 importer fixture tests。
- Preview URL smoke tests。

不允许以“本地 Node 测试通过”替代 Workers runtime 测试，也不允许以 SQLite 替代 PostgreSQL integration。

## 测试层次

### 纯规则单元测试

不连接数据库或网络：

- 文本、用户名、URL、OIDC redirect allowlist 与 proposal canonicalization。
- 内容指纹和精确重复判断。
- Wilson score、tie-break 和置信状态。
- operation dependency graph 校验。
- 状态转换、错误映射和可见 scope 判断。
- 时间与过期计算，时钟通过 interface 注入。

### Module interface tests

通过 module interface 测试完整行为，依赖使用 fake adapters：

- OIDC provider/login module + fake discovery、token endpoint 与 repository。
- Account/session module + test repository。
- Catalog plan module + 假 CSV。
- Sync processor + transaction adapter。

测试断言可观察结果，不读取 implementation 私有状态。生产 OIDC adapter 与 fake provider 必须覆盖相同的 authorization、exchange 与 identity contract。

### PostgreSQL integration

每个测试 suite 创建临时真实 PostgreSQL database、应用 migration、测试后销毁。重点：

- unique/check/FK constraints。
- Drizzle mapping 与 raw SQL 类型。
- savepoint 部分成功和整批 commit failure。
- expected revision 并发更新。
- task/proposal/vote/event 原子性。
- operation receipt replay 与 ID body mismatch。
- vote totals 在并发 set/change/none 后与明细一致。
- task merge redirect、循环防御和私人详情无损转换。
- account deletion匿名化且私人数据清除。
- sync cursor visibility、event retention 和 tombstone ordering。

### Workers runtime

使用 `@cloudflare/vitest-pool-workers`：

- Hono routing、middleware、CORS 与 Content-Type。
- 真实生成 Env binding type 的访问方式。
- 请求 body 上限和结构化 error。
- bearer auth、maintainer authorization 与 suspend。
- 每请求数据库 client 生命周期。
- 未处理 exception 返回 500 且无敏感信息。
- no global request state；并发请求不会串 user context。

注意该测试工具可能自动提供 `nodejs_compat`，因此必须另有 config test 检查真实 `wrangler.jsonc` 明确包含该 flag。

### 契约测试

`packages/contracts` 发布：

- OpenAPI schema 与固定 request/response examples。
- sync operations/events 的 JSON Schema。
- 排名、canonicalization 和 reducer JSON vectors。
- protocol/schema version compatibility matrix。

JSON vectors 不引用 TypeScript 特有数字、Date、Map 或 class。Swift/Kotlin/第三方实现可直接读取同一文件验证结果。

## 产品行为矩阵

### 认证与账户

| 场景 | 期望 |
|---|---|
| 非 allowlist callback 发起登录 | `invalid_request`，不创建 transaction |
| state 被篡改或 transaction 过期 | callback 拒绝，不调用 token endpoint |
| Provider callback 并发重放 | 只有一个请求能原子进入 `exchanging` |
| ID Token signature/issuer/audience/nonce 不匹配 | 登录失败，不创建账户或 session |
| 首次 OIDC 登录 | user、OIDC identity、session 原子自动创建 |
| 并发首次登录或 username 碰撞 | identity 只创建一次，username 使用确定性 fallback |
| session 30 天无活动或 180 天绝对时间 | unauthenticated |
| 暂停账户 | 所有 session 立即无效 |
| 删除账户 | 私人数据消失，公开贡献显示已注销用户 |

### 共享任务与提案

| 场景 | 期望 |
|---|---|
| 创建 task 时 proposal 校验失败 | task、vote、event 均不存在 |
| 新 task 创建成功 | task + proposal + author up vote + events 原子存在 |
| 完全重复 proposal | `duplicate_proposal`，不创建、不投票 |
| `HW3` 与 `Homework 3` | 可分别创建，不做语义合并 |
| 作者反对自己的 proposal | 允许，聚合正确变化 |
| 隐藏领先 proposal | 客户端原始数据可重算下一可见 proposal |
| 所有 proposals 隐藏 | task 不作为活动共享任务展示 |
| 合并任务含完全相同 proposals | canonical + redirect；同向票去重，相反票撤回，aggregate 重算 |
| archived term 写入 | `inactive_term` |

### 私人数据

| 场景 | 期望 |
|---|---|
| 无 personal details 直接完成 shared task | 成功创建独立 personal state |
| 两设备 expected revision 相同并发编辑 | 一个成功，一个 `revision_conflict` |
| 发布私人信息 | 只使用显式 public payload，private note 不泄露 |
| 合并 personal todo | 内容转 details，state 转 personal state，入口不重复 |
| 合并 duplicate tasks 的不同 personal states | details 冲突时状态随转出的 todo；否则 completed > pending > ignored |
| unfollow section | 私人详情保留，公开增量停止 |
| leading proposal 变化 | completion 不自动重置 |
| hidden shared task | 本人仍可使用 private details/state |

### 评论与审核

| 场景 | 期望 |
|---|---|
| 编辑评论 | 新 revision，旧 revision 保留且公开可按需读取 |
| 删除评论 | 普通用户只见占位，作者/维护者有受限历史权限 |
| snapshot | 只含当前 comment/revision metadata，不含全部历史 |
| 举报 | 其他学生和 target 看不到 reporter/reason |
| hide/restore | 当前状态与同步 tombstone/event 一致 |
| 合并两个 task，用户两边都有 details | target 保留，source 转 personal todo，无覆盖 |

## 同步测试矩阵

必须自动覆盖：

1. Account snapshot 多页后，从 anchor 增量重放 snapshot 期间的 create/update/delete。
2. Class snapshot 后从原 cursor 重放，允许其他 scope duplicate 且最终一致。
3. 空 operations 只 pull。
4. 100 条批次全成功。
5. 中间业务失败、后续独立操作成功。
6. 前置失败导致 dependent `dependency_failed`。
7. 后一操作引用前一成功创建实体。
8. 响应丢失后相同 operation ID replay 返回同结果。
9. 相同 operation ID 不同 payload 返回 `operation_id_reused`。
10. 最终 commit 故障时不保存任何 success/receipt/event。
11. 不可见事件被 cursor 跨过，新 follow 通过 snapshot 补齐。
12. 180 天外 cursor 返回 `cursor_expired`。
13. 旧 upsert 不复活更新 revision 更高的 tombstone。
14. 私人 event 永远不会出现在另一 user response。
15. Public vote aggregate event 不含 voter ID。
16. Suspended user 不能 push 或 pull private data。

每个测试用一个参考 reducer 应用响应，比较最终本地投影与服务端规范化当前状态；不能只断言 events 数量。

## 排名测试向量

Wilson score 使用 `z = 1.96`，实现输出在比较前不得人为四舍五入。文档近似值用于人工核对：

| Up | Down | Score 近似值 |
|---:|---:|---:|
| 0 | 0 | 0 |
| 1 | 0 | 0.206543291474 |
| 2 | 0 | 0.342371952890 |
| 3 | 0 | 0.438493919551 |
| 4 | 0 | 0.510099979596 |
| 2 | 1 | 0.207654955126 |
| 3 | 1 | 0.300636052443 |
| 10 | 1 | 0.622635374514 |
| 10 | 9 | 0.317074825118 |
| 1 | 1 | 0.094528654801 |
| 0 | 1 | 0 |

还必须覆盖：同分总票数、同分同票数创建时间、完全相同数据按 UUID；少于 3 票 pending、反对占比恰好 `1/3` disputed、与第二名差恰好 `0.05` 不触发“小于 0.05”条件。

## Importer 测试

fixture 必须包含：

- UTF-8 BOM。
- 引号中包含逗号的 `SKBJ`。
- 前导零 KCH/KXH。
- 空教师和可选数值。
- 重复 JXBID。
- 同 `(term, KCH)` 不同 KCM。
- 缺列、额外列和未知 schema version。
- 同 checksum replay。
- 缺失 active section 的 dry-run 与 confirm-deactivations。
- 中断后按 import ID 续传。

真实 `26fall.csv` 可由维护者在本地手动运行 validation，但不能成为 CI fixture 或提交仓库。

## Security tests

- 所有对象级权限做跨 user negative test。
- SQL/HTML/control-character/超长输入。
- URL 拒绝非 HTTPS、credential、畸形 host；后端不 fetch URL。
- OIDC state、authorization code、exchange code 与 ID Token 不出现在日志、错误或浏览器最终 session URL。
- callback redirect 只能落到 exact allowlist；开放重定向测试必须失败。
- exchange code 必须短期、单用途；callback 和 exchange 并发重放只有一个成功。
- 限流跨 isolate 使用持久/edge 层而非 global memory。
- Bearer token、OIDC code/token/subject、email 与 private body 不出现在日志和 error snapshot。
- Bootstrap 只能成功一次。
- 最后一名 maintainer 不可移除。
- Reporter identity 不进入 public event。
- Query cache disabled config test。
- PostgreSQL runtime role 无 DDL 与跨 database 权限。

## Remote 与发布 smoke

不维护长期 staging。每次发布至少验证：

- Remote dev：真实 Worker runtime、Hyperdrive/VPC/Tunnel `SELECT 1`、schema version、OIDC discovery 与受控登录。
- Preview URL：live/ready、OpenAPI、auth 参数错误、已授权只读目录和 snapshot。
- Production deploy 后：相同只读 smoke、一次受控登录、日志与错误率。

Smoke 失败立即停止发布；不能通过开放公网 PostgreSQL、关闭 TLS、绕过认证或直接改库使测试“通过”。

## Migration、backup 与恢复

- 每个 migration 测试空库 up 与上一版本 up；空库测试必须使用生产 Migration Worker 的 generated bundle 和 executor，而不是另一套迁移实现。
- migration executor 覆盖 database/role 错配、journal 非精确前缀、并发 advisory lock、事务回滚与重复执行幂等性。
- 本地编排覆盖部署成功、调用失败、部署输出异常、Worker 删除失败与精确手工清理命令；测试不得创建真实 Cloudflare resource。
- destructive change 使用 expand/migrate/contract，并验证旧 Worker 与新 schema、新 Worker 与过渡 schema。
- pgBackRest backup job 有成功、失败与过期告警测试。
- 定期恢复到隔离 PostgreSQL，应用关键一致性查询和随机业务抽样。
- Restore drill 记录日期、备份 ID、目标时间、耗时、验证结果和发现的问题。

## Definition of Done

一个 backend ticket 完成必须同时满足：

- 行为符合产品规范和同步协议。
- 相关 module interface tests 与真实 PostgreSQL tests 已增加。
- 任何协议/schema 改动更新版本、OpenAPI、JSON vectors 和文档。
- 任何管理动作包含 authorization 与 audit tests。
- 不记录敏感内容，不增加 module-global request state 或 floating promises。
- migration、rollback/forward-fix 和 observability 已覆盖。
- 对应 docs 链接仍有效，没有创建第二份冲突规则。

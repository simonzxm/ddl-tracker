# ADR 0010：从固定 GitHub commit 自动同步课程目录

- 状态：已接受
- 日期：2026-08-06

## 背景

原课程目录流程要求维护者准备 CSV、单独维护 manifest、通过 CLI 上传、审阅 plan、确认停用并 apply。它引入了专用管理接口、批次状态机、临时 payload、过期清理和大量恢复分支，但课程数据本身已经由 `at-nju/courses` 公开仓库持续生成确定性 gzip 文件。

人工流程把上游采集、文件传递、日期补充、计划确认和数据库应用分散在多个接口中。实际维护成本高，并且容易因遗漏 manifest、未 apply plan 或客户端/服务端解析规则漂移而停止更新。

## 决策

课程目录由 Worker Cron 直接从 `at-nju/courses` 同步：

- 先解析 `main` 的当前 commit SHA，再读取该 SHA 的 repository tree。
- 只发现 `data/<term>/courses.csv.gz`。
- raw 文件始终使用固定 commit 下载，避免一次运行混入多个上游版本。
- 不再使用 manifest；学期身份和显示名来自 CSV，显式校历日期若数据库已有则保留。
- 每个学期在一个 `REPEATABLE READ` 事务内完成 diff、upsert、停用、同步事件、run 记录和 state 更新。
- 以 `(repository, term_code)` advisory lock 串行化同一学期同步。
- blob SHA 没变化则跳过；首次 bootstrap 每次最多处理 4 个最近学期。
- 删除全部课程上传、plan、apply、status、cancel HTTP 接口，删除 admin CLI、批次表、manifest parser 和 plan retention。

## 后果

正面：

- 唯一外部 seam 是 `CatalogSource`，唯一业务入口是 `CatalogSyncService.sync()`。
- 数据发现、下载固定版本、校验、差异和原子写入集中在一个深 module 中。
- 不存在待处理 plan、人工确认遗漏、manifest 漂移或客户端断点状态。
- 失败学期不会更新 current state，下次 Cron 自动重试。
- 上游 source version、diff 与失败摘要仍由 `catalog_sync_runs` 审计。

代价：

- DDL Tracker 接受该公开镜像作为课程目录上游依赖；上游不可用会延迟更新。
- 上游不提供正式校历日期，新学期只能先使用 term code 推导展示状态，直到数据库有显式日期或 override。
- 首次全历史 bootstrap 可能跨多个 Cron 周期完成。
- 删除旧接口是 API 4.0.0 breaking change；旧维护者客户端不能继续使用。

## 被拒绝的方案

### 保留上传接口作为 fallback

拒绝。它会继续要求维护两套数据来源和两套故障路径，并使“当前目录由谁负责”重新变得含糊。上游故障应通过重试和修复 source adapter 处理，而不是恢复人工写入入口。

### Worker 每次下载默认分支 raw URL

拒绝。先读 tree 再下载时默认分支可能移动，导致同一运行混合不同 commit。固定 commit URL 是完整快照语义的一部分。

### 把 GitHub 数据复制到仓库或 R2 后再导入

拒绝。提交真实课程快照会膨胀应用仓库并产生第二份版本历史；R2 中转在当前文件大小和每日频率下没有必要。

### 同步全部学期于一次 Cron

拒绝。首次部署可能需要处理大量历史文件，不应让单次 Worker invocation 无界增长。按最近学期优先、每次最多 4 个可保证渐进 bootstrap。

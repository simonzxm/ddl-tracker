# 课程目录自动同步

课程目录以公开仓库 `at-nju/courses` 为唯一上游来源。DDL Tracker 不接受人工上传课程 CSV，不提供课程导入 HTTP 接口，也没有维护者导入 CLI 或 manifest 文件。

生产 Worker 的 Cron Trigger 每天 `03:17 UTC` 执行一次同步。同步 module 从公开 GitHub `data` 目录页读取上游 `main` 分支当前 commit 和学期目录，锁定该 commit 后发现并下载：

```text
data/<YYYY-YYYY-[1|2|3]>/courses.csv.gz  # 仅 2025-2026-1 及以后
```

所有文件都从固定 commit 的 raw URL 下载，因此同一次运行不会混用不同上游版本。目录页无法解析唯一 commit、学期目录非法、raw ETag/长度非法、下载失败、gzip 损坏或文件超过限制时，本次对应学期同步失败。

## 同步范围与进度

- `catalog_sync_state` 为每个 `(repository, term_code)` 保存最近成功同步的 commit SHA、raw ETag source version、CSV checksum 与 run ID；source version 继续存放在历史命名的 `blob_sha` 列中。
- source version 未变化的学期直接跳过，不重新下载。
- 每次 Cron 最多处理 4 个发生变化的学期，按学期代码从新到旧排序。
- 首次部署会优先同步最近学期；仅回填 `2025-2026-1` 及以后的学期。
- 每个学期独立提交。一个学期失败时停止本次运行，已经成功提交的其他学期不回滚；失败学期不会更新 `catalog_sync_state`，下次 Cron 会重试。

## 下载与资源限制

- 公开 GitHub `data` 目录页必须包含唯一的 `currentOid` 和合法学期目录，不调用 `api.github.com`。
- 只接受 `2025-2026-1` 及以后且路径严格匹配 `data/<term>/courses.csv.gz` 的数据。
- 固定 commit raw URL 的 HEAD 必须返回合法 ETag source version 和 `Content-Length`。
- gzip 最大 4 MiB。
- 解压后 CSV 最大 10 MiB。
- 必须具有 gzip magic，解压过程同样按实际读取字节限制，防止压缩炸弹。
- CSV 必须是有效 UTF-8，可包含 BOM。

## CSV 校验与字段映射

解析使用真正的 CSV parser，支持引号中的逗号；禁止手工按逗号拆分。文本统一做 Unicode NFC、换行规范化与首尾空白清理。空字符串转换为 `null`，外部代码保留前导零。

必须存在以下来源列：

```text
XNXQDM XNXQDM_DISPLAY KCH KCM XF PKDWDM PKDWDM_DISPLAY
JXBID JXBMC KXH SKJS XXXQDM XXXQDM_DISPLAY XKZRS YPSJDD
SKZC SKXQ SKJC SKJAS JXLDM JXLDM_DISPLAY
```

未知额外列保留在教学班 `raw_source` 中并记录 warning。缺失必需列、重复 header、空必填值、非法学分/容量、重复 `JXBID`、同一 `KCH` 出现冲突课程事实或一个文件包含多个学期身份时，整个学期拒绝同步。

### 学期

| 目标字段 | 来源 |
|---|---|
| `external_term_code` | `XNXQDM`，并必须与上游目录名一致 |
| `name` | `XNXQDM_DISPLAY` |
| `starts_on`, `ends_on` | 上游不提供；已有数据库值保留，新学期为 `null` |
| `source_metadata` | repository、commit SHA、raw ETag source version、source path、run ID、checksum |

没有日期的新学期按 `XNXQDM` 和 `Asia/Shanghai` 当前日期推导展示状态；数据库中的显式日期和状态 override 优先。

### 课程

课程唯一键为 `(term_id, KCH)`。

| 目标字段 | 来源 |
|---|---|
| `external_course_code` | `KCH` |
| `name` | `KCM` |
| `credits` | `XF`，严格 decimal，空值允许 |

### 教学班

教学班唯一外部键为 `JXBID`。

| 目标字段 | 来源 |
|---|---|
| `external_section_id` | `JXBID` |
| `section_number` | `KXH` |
| `department_code`, `department_name` | `PKDWDM`, `PKDWDM_DISPLAY` |
| `instructors` | `SKJS`，按 `,，;；、` 拆分 |
| `campus` | `XXXQDM_DISPLAY` |
| `capacity` | `XKZRS` |
| `schedule_text` | `YPSJDD` |
| `raw_source` | 该行全部来源列及同步 metadata |

MVP 不把周次、星期和节次文本转换为可计算课表规则；完整展示仍使用 `schedule_text` 和保留的 raw source。

## 原子写入

每个学期在一个 `REPEATABLE READ` PostgreSQL 事务中完成：

1. 获取 `(repository, term_code)` advisory transaction lock。
2. 读取一致的数据库基线并计算新增、更新、未变化和停用差异。
3. upsert 学期、课程与教学班。
4. 将上游文件中缺失的原 active 课程和教学班标记为 inactive，不硬删除。
5. 追加教学班停用事件；目录确有规范化变化时推进 `catalog_revision` 并追加 revision event。
6. 写入成功的 `catalog_sync_runs` 记录并更新 `catalog_sync_state`。
7. 提交事务。

任何校验、外部键移动、SQL 或提交失败都会回滚该学期全部目录变更。`JXBID` 不允许从一门课程移动到另一门课程。已有任务、私人覆盖、历史学期和 inactive 记录均保留。

上游 source version 变化但规范化目录内容未变化时，仍更新同步 state 和成功 run，但不推进目录 revision，也不产生目录变更事件。

## 运行记录与故障处理

`catalog_sync_runs` 长期记录：repository、commit SHA、term code、source path、raw ETag source version、CSV checksum、行数、课程/教学班计数、是否产生目录变化、diff、状态、错误摘要和起止时间。

失败记录不保存整行 CSV、教师列表或完整 raw payload。日志不得输出 GitHub 响应正文、CSV 内容、数据库连接信息或用户私有数据。

故障处理顺序：

1. 检查 Worker scheduled invocation 和结构化错误类别。
2. 检查 GitHub 目录页和固定 commit raw URL 可达性，以及目录页 `currentOid`、学期链接、raw ETag/长度是否可解析。
3. 检查最近失败的 `catalog_sync_runs`，确认 term、commit、source version 与错误摘要。
4. 修复代码、资源限制或等待上游数据修正；下一次 Cron 会自动重试未成功 source version。
5. 不得通过恢复旧上传接口、直接修改目录表或手工伪造 `catalog_sync_state` 绕过校验。

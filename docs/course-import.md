# 课程目录导入

课程原始数据由外部管理系统追踪，不提交本仓库。维护者使用 admin CLI 在本地解析 CSV、生成差异计划，再通过受保护 API 分批提交规范化记录。CLI 不直连 PostgreSQL。

## 当前来源事实

用于设计的 `26fall.csv` 是 UTF-8 CSV，开头可能有 BOM，包含 39 列和 3,025 条教学班记录。分析结果：

- `XNXQDM` 全文件唯一值 `2026-2027-1`，表示学期。
- `KCH` 有 1,890 个值；同一学期内每个 KCH 对应稳定 KCM。
- `JXBID` 3,025 个且全部唯一，适合作为教学班外部键。
- `WID` 当前与 `JXBID` 完全相同，不重复作为业务键。
- `(XNXQDM, KCH, KXH)` 当前也唯一，但 `KXH` 只作为显示班号，不替代 JXBID。
- 教师 `SKJS` 允许为空；其他可选字段必须按 schema 明确处理。

这些统计用于校验当前数据形态，不代表后续文件永远满足；导入器必须重新验证每个文件。

## Manifest

每次导入必须同时提供 manifest，补足 CSV 中缺失的学期日期与 schema version：

```json
{
  "schema_version": 1,
  "source_system": "course-management",
  "term": {
    "external_code": "2026-2027-1",
    "display_name": "2026-2027学年 第1学期",
    "starts_on": "2026-08-24",
    "ends_on": "2027-01-10",
    "time_zone": "Asia/Shanghai"
  }
}
```

以上日期来自南京大学 2026–2027 学年校历；后续学期必须重新依据正式校历填写，不能沿用示例值。

- `external_code` 必须与所有 CSV 行的 `XNXQDM` 相同。
- `display_name` 必须与 `XNXQDM_DISPLAY` 一致，除非维护者明确提供 override reason。
- 时区 MVP 只能是 `Asia/Shanghai`。
- 日期按学校本地日历解释，结束日过后学期自动归档；manual override 必须审计。

## 字段映射

### 学期

| 目标字段 | 来源 |
|---|---|
| `external_term_code` | `XNXQDM` |
| `display_name` | `XNXQDM_DISPLAY` |
| `starts_on`, `ends_on`, `time_zone` | manifest |

### 课程

课程唯一键为 `(term_id, KCH)`。

| 目标字段 | 来源 |
|---|---|
| `external_course_code` | `KCH`，保留前导零 |
| `name` | `KCM` |
| `credits` | `XF`，解析 decimal，空值允许 |

同一个唯一键出现多个课程名或学分时，plan 必须报冲突，不能选择“最后一行获胜”。开课单位不是课程事实，不保存到课程记录。

### 教学班

教学班唯一外部键为 `JXBID`。

| 目标字段 | 来源 |
|---|---|
| `external_section_id` | `JXBID` |
| `name` | `JXBMC` |
| `section_number` | `KXH`，保留前导零 |
| `department_code` | `PKDWDM` |
| `department_name` | `PKDWDM_DISPLAY` |
| `instructors` | `SKJS`，按来源分隔符解析为数组 |
| `campus_code` | `XXXQDM` |
| `campus_name` | `XXXQDM_DISPLAY` |
| `capacity` | `XKZRS` |
| `schedule_text` | `YPSJDD` |
| `weeks_text` | `SKZC` |
| `weekday_text` | `SKXQ` |
| `periods_text` | `SKJC` |
| `room_text` | `SKJAS` |
| `building_code` | `JXLDM` |
| `building_name` | `JXLDM_DISPLAY` |
| `source_payload` | 该行全部 39 列的 JSON object |

同一课程的不同教学班可以属于不同开课单位，这是正常的开课事实，不产生冲突或警告。开课单位同时保存为教学班结构化字段；原始值仍保留在 `source_payload`，用于审计与未来迁移。

MVP 不把“1-18周、周四第9-11节”解析为可计算课表规则。结构化字段只是检索与展示辅助，`schedule_text` 是当前完整展示来源。

## 本地解析

admin CLI 必须：

- 识别并移除 UTF-8 BOM。
- 使用真正 CSV parser，正确处理引号中的逗号；禁止按逗号手工 split。
- 验证 header 集合与 schema version；未知额外列保留在 source payload 并警告，缺失必需列失败。
- 所有文本转 Unicode NFC、统一换行并去除首尾空白；外部代码只去首尾空白，不能移除前导零。
- 空字符串转换为 null；数值字段严格解析，不能默认为 0。
- 计算整个原始文件 SHA-256、行数、header hash 和 manifest hash。
- 只向后端发送有上限的规范化批次，不把 1.3 MB 文件作为一个 Worker request 上传。

## Plan 阶段

导入永远先 plan，输出至少包含：

- 新增、更新、未变化和将停用的学期/课程/教学班数量。
- 每个字段的变更摘要。
- 重复外部键、空必填字段、父关系冲突和解析错误。
- CSV 中缺失、但数据库当前 active 的记录列表。
- checksum 是否曾成功导入。

Plan 保存为 `catalog_imports` 记录并返回 import ID。它绑定 checksum、manifest、actor 和目标数据库环境；文件或数据库基线改变后不能应用旧 plan，必须重算。

## Apply 阶段

- 相同 checksum + manifest 的成功导入是幂等 no-op。
- 课程按 `(term, KCH)` upsert，教学班按 `JXBID` upsert。
- JXBID 不允许从一个课程移动到另一个课程；发生时要求显式维护者迁移决策。
- 新文件缺失的旧记录只标记 inactive，不硬删除。
- 停用记录前，CLI 必须要求显式 `--confirm-deactivations`；无缺失时不要求。
- 已有关联任务、私人信息和历史学期记录全部保留。
- 每批规范化记录通过后端事务应用；整个 import 只有所有批次成功后才标记 completed。
- 中途失败可使用同 import ID 幂等续传；不能重复应用已确认批次。
- 完成后追加目录失效/停用同步事件和审计记录。

## 维护者 CLI 行为

命令名可以在实现时调整，但能力必须对应：

```text
catalog validate <csv|csv.gz> --manifest <json>
catalog plan <csv|csv.gz> --manifest <json>
catalog apply <import-id> [--confirm-deactivations]
catalog status <import-id>
```

CLI 按 gzip magic 自动解压 `.csv.gz`，解压后的 CSV 与未压缩输入使用完全相同的校验、checksum 和规范化流程。CLI 使用普通邮箱认证获得的 maintainer bearer session，不使用数据库连接串。输出默认人类可读，同时支持 `--json` 供自动化处理。

## 仓库与敏感信息

- `*.csv` 和 `*.csv.gz` 课程原始文件默认 gitignore。
- 仓库只保留最小假数据 fixture，不能复制真实学生、教师邮箱或其他额外个人信息。
- 数据库保留 source payload 是为了字段迁移，不向普通客户端完整同步。
- import 日志不得输出整行原始 payload，只输出外部键和字段级错误。

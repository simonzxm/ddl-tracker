# 同步协议

本文定义未来原生客户端实现离线同步所需的语言无关语义。JSON schema 与测试向量最终由 `packages/contracts` 发布；本文是行为规范，不是某个 TypeScript 客户端的说明。

## 目标

- 客户端离线时可立即创建和修改自己的数据，并排队公开操作。
- 一次联网调用同时 push 本地操作和 pull 远端变化。
- 请求丢失、响应丢失、重复提交和批次部分失败都不会重复产生业务效果。
- Swift、Kotlin 和第三方实现可以仅依赖 JSON 契约完成收敛。
- 后端同步原始状态，不计算官方页面排序或领先提案。

不追求多主数据库、服务端 event sourcing、任意字段自动合并或永久有效游标。

## 传输约定

- Endpoint：`POST /api/v1/sync`。
- Authentication：`Authorization: Bearer <opaque-token>`。
- Content-Type：`application/json; charset=utf-8`。
- 字段名与枚举使用 `snake_case`。
- ID 使用 canonical lowercase UUIDv7；课程外部键仍是字符串。
- 时间戳使用 RFC 3339 UTC；业务输入时区固定 `Asia/Shanghai`。
- 文本使用 Unicode NFC 和 `\n` 换行。
- `cursor`、`page_token` 和 `snapshot_token` 均 opaque，客户端不得解析或自行生成。
- operation、snapshot record 与 sync event 都有独立 `schema_version`；未知版本必须拒绝，不能忽略未知字段后猜测执行。
- 当前同步协议为 `protocol_version = 2`。snapshot record 使用 `schema_version = 1`，sync event 使用 `schema_version = 2`，二者不能与 protocol version 混用。
- snapshot record 和 sync event 都是严格判别联合；`record_type` 或 `type` 唯一决定 payload schema，不存在任意键值 payload。

## 同步模式

同一个 `/api/v1/sync` 支持三种互斥模式。

### 账户 bootstrap

新安装或本地数据库重建时使用。请求没有 cursor，不上传 operations：

```json
{
  "protocol_version": 2,
  "mode": "account_snapshot",
  "snapshot_token": null,
  "page_token": null,
  "snapshot_limit": 500,
  "operations": []
}
```

第一页开始前，服务端记录全局事件 anchor，并创建短期 opaque snapshot token。快照包含：

- 当前用户资料、关注教学班关系、全部私人待办、个人任务详情、个人任务状态和本人提交的内容举报。
- 当前关注教学班的公开课程任务、可见提案、投票聚合、当前用户自己的投票、当前评论和所引用公开用户资料。
- 合并、隐藏、删除和停用所需的当前 tombstone 状态。

快照不包含课程目录全文、所有投票明细、完整评论修订历史、其他举报人的信息或同步事件历史。

每条快照记录使用以下 envelope：

```json
{
  "record_type": "personal_task_state",
  "schema_version": 1,
  "payload": {
    "course_task_id": "018f...",
    "state": "completed",
    "revision": 4,
    "created_at": "2026-07-12T19:00:00Z",
    "updated_at": "2026-07-12T20:00:00Z"
  }
}
```

顶层不重复保存实体 `id` 或 `revision`；实体标识和并发 revision 只存在于对应严格 payload 中。分页使用的 `(record_type, id)` 是服务端 token 内部实现，客户端不得依赖。

客户端重复携带 snapshot token 和 page token，直到响应 `snapshot_complete = true`。完成响应提供 `next_cursor`，它等于快照开始前的 anchor。客户端随后进入 incremental 模式；快照期间发生的所有变化会从该 cursor 后重放。

快照分页使用 `(record_type, id)` keyset，不使用 offset。快照不承诺跨 HTTP 页的数据库 repeatable-read；正确性来自“开始前 anchor + 完成后增量重放”。快照中偶然包含 anchor 之后的新版记录是允许的，客户端 reducer 必须按 ID/revision 幂等 upsert。

### 教学班快照

新关注或按需浏览教学班时使用：

```json
{
  "protocol_version": 2,
  "mode": "class_section_snapshot",
  "cursor": "opaque-current-cursor",
  "class_section_id": "018f...",
  "snapshot_token": null,
  "page_token": null,
  "snapshot_limit": 500,
  "operations": []
}
```

它返回该教学班当前公开状态、所引用用户资料以及当前用户在这些提案上的投票状态。若用户在该班已有私人详情或状态，也返回相关私人记录。

完成后响应给出 `resume_cursor`，等于请求开始时的原 cursor。客户端从该 cursor 重新做 incremental pull，以覆盖快照过程中发生的变化；其他 scope 可能收到重复事件，必须幂等处理。

浏览快照不建立关注关系。成功执行 `follow_class_section` 后，operation result 的 `follow_up` 会要求取得对应教学班快照；客户端完成该快照前不能认为该班已完整同步。

### 增量 push/pull

```json
{
  "protocol_version": 2,
  "mode": "incremental",
  "cursor": "opaque-cursor",
  "event_limit": 500,
  "operations": [
    {
      "operation_id": "018f...",
      "type": "set_personal_task_state",
      "schema_version": 1,
      "depends_on": [],
      "payload": {
        "course_task_id": "018f...",
        "state": "completed",
        "expected_revision": 3
      }
    }
  ]
}
```

响应：

```json
{
  "protocol_version": 2,
  "mode": "incremental",
  "request_id": "018f...",
  "operation_results": [
    {
      "operation_id": "018f...",
      "operation_type": "set_personal_task_state",
      "status": "applied",
      "follow_up": null
    }
  ],
  "events": [
    {
      "event_id": "018f...",
      "schema_version": 2,
      "type": "personal_task_state_upserted",
      "occurred_at": "2026-07-12T20:00:00Z",
      "payload": {
        "course_task_id": "018f...",
        "state": "completed",
        "revision": 4,
        "created_at": "2026-07-12T19:00:00Z",
        "updated_at": "2026-07-12T20:00:00Z"
      }
    }
  ],
  "next_cursor": "opaque-next-cursor",
  "has_more": false
}
```

客户端只有在完整提交本次本地事务后，才能保存 `next_cursor` 并从 outbox 移除 applied/replayed operations。网络错误或本地提交失败时必须使用相同 operation ID 重试。

## 操作 envelope

每个 operation 都包含：

| 字段 | 规则 |
|---|---|
| `operation_id` | 客户端生成 UUIDv7；同一意图重试时保持不变 |
| `type` | 稳定操作名；未知类型拒绝整个该 operation |
| `schema_version` | 操作 payload version |
| `depends_on` | 同批次前置 operation IDs，只允许引用更早条目 |
| `payload` | 已按对应 schema 校验的业务参数 |

`operation_id` 不能兼作实体 ID。创建类操作在 payload 中携带独立客户端生成实体 ID。

服务端保存 request digest 与首次稳定结果 180 天：

- 同一用户、同一 operation ID、相同 digest：不重新执行，返回 `replayed` 和首次结果。
- 同一 operation ID、不同 digest：返回 `operation_id_reused`。
- receipt 已过保留期：服务端可以把它当新 ID；客户端不得在离线 180 天后盲目重放旧 outbox，应先 bootstrap 并要求用户确认仍需提交。

## 支持的学生操作

### 关注与私人数据

- `follow_class_section`
- `unfollow_class_section`
- `create_personal_todo`
- `update_personal_todo`
- `delete_personal_todo`
- `upsert_personal_task_details`
- `delete_personal_task_details`
- `set_personal_task_state`
- `merge_personal_todo_into_course_task`

Mutable 操作必须携带 `expected_revision`。创建使用 revision `1`；每次 accepted update 或 delete 增加 revision。expected revision 不匹配时返回 `revision_conflict` 和当前服务端记录，不能 last-write-wins。

对可能尚不存在的 singleton/upsert 记录（例如 personal task state/details），客户端用 `expected_revision = 0` 表示“必须不存在”；成功后产生 revision `1`。普通 create operation 不接受 expected revision，而以客户端实体 ID 唯一约束处理。

### 发布与共享数据

- `publish_personal_todo_as_course_task`
- `publish_personal_task_details_as_proposal`
- `create_course_task_with_initial_proposal`
- `create_task_proposal`
- `set_accuracy_vote`
- `create_task_comment`
- `edit_task_comment`
- `delete_task_comment`
- `create_content_report`

发布操作必须显式携带公开 proposal 字段。服务端不能从私人表自动复制正文。`set_accuracy_vote` 的值为 `up`、`down` 或 `none`；`none` 表示撤回当前判断。

创建 course task 的 payload 必须同时提供 task ID、proposal ID 与公开 proposal 内容。服务端自动创建作者的 `up` vote，但该自动行为只发生在全新 task + initial proposal 的原子操作中。

创建一个与已有 proposal 精确重复的内容返回 `duplicate_proposal` 和已有 ID，不改变任何 vote。

## 批次顺序、依赖与部分成功

- 每批最多 100 operations，按数组顺序处理。
- 后一项可引用前一项成功创建的实体。
- `depends_on` 中任何操作失败时，该项返回 `dependency_failed`，不执行 implementation。
- 业务拒绝只回滚当前 savepoint，其他独立操作继续。
- 每个 accepted operation 的状态修改、聚合、事件和 receipt 原子产生。
- 连接丢失、serialization failure 或最终 commit 失败时整个批次失败，HTTP 返回可重试错误，不返回任何 operation 已成功的声明。

`operation_results` 顺序必须与请求 operations 一致。每项重复给出稳定的 `operation_type`；成功项的 `follow_up` 为 `null`，或明确要求客户端执行一次 `class_section_snapshot`。服务端实体状态由同一响应中的事件收敛，不在成功结果中复制任意键值对象。状态只能是：

- `applied`：首次成功执行。
- `replayed`：先前已执行，返回相同结果。
- `rejected`：稳定业务错误，不自动重试。
- `dependency_failed`：前置操作失败；修正依赖后使用新 operation ID。

只要 request envelope 合法且批次成功 commit，即使部分 operations 被拒绝，HTTP 状态仍为 `200`。Malformed envelope、未认证和 request-level size/rate error 使用对应 4xx；数据库不可用或整批 commit failure 使用 5xx。Rejected 与 dependency-failed 结果也保存 receipt，保证响应丢失后的 replay 稳定。

## 事件 envelope 与可见范围

所有事件使用全局单调数据库 sequence 排序，但 sequence 不直接暴露；cursor 是带版本的 opaque 表示。事件 ID 是 UUIDv7，用于客户端幂等。

事件 scope：

- `private_user`：只对一个用户可见，例如个人待办、自己的 vote、举报状态。
- `class_section_public`：只对当前关注该教学班的用户可见。
- `authenticated_global`：所有登录用户需要的公开资料或目录失效信息。
- `maintainer_private`：只有维护者可见。

服务端扫描 cursor 后的全局事件并过滤可见范围。cursor 可以跨过不可见 sequence；用户以后新关注教学班时通过教学班快照补齐旧状态，而不是回退事件历史。

### 主要事件类型

```text
class_section_followed
class_section_unfollowed
course_task_created
course_task_merged
course_task_hidden
course_task_restored
task_proposal_created
task_proposal_hidden
task_proposal_restored
task_proposal_redirected
proposal_vote_totals_updated
accuracy_vote_updated                 # 仅当前用户自己的判断
personal_todo_upserted
personal_todo_deleted
personal_task_details_upserted
personal_task_details_deleted
personal_task_state_upserted
personal_task_state_deleted
task_comment_upserted
task_comment_deleted
task_comment_hidden
task_comment_restored
public_user_profile_updated
public_user_deleted
reporter_content_report_updated      # 仅举报人；包含本人提交的完整举报记录，不含 reporter_id
maintainer_content_report_updated    # 仅维护者；包含完整举报记录
class_section_deactivated
```

Event payload 必须通过其 `type` 对应的严格 schema，并携带客户端更新本地当前状态所需的完整小记录，而不是数据库 diff：

- create、upsert、restore：携带完整当前记录；restore 不能只发送 `{id, state}`。
- delete、hide：携带对应实体的完整 tombstone，包括实体类型、ID、状态和 revision；删除还携带 `deleted_at`。
- merge、redirect：携带可持久化的 source、target/canonical、revision 与 `created_at`。
- aggregate update：携带完整当前 aggregate 与 `updated_at`。
- 举报事件按 audience 拆分为两个 event type，不能由同一个 type 承载两种 payload。

投票事件对其他用户只包含新 aggregate；当前用户另收自己的 vote state。禁止在 public event 中放 voter ID。

## Cursor 与保留

- 同步事件至少保留 180 天。
- cursor 早于可用窗口时返回 `cursor_expired`，不返回不完整增量。
- protocol v2 reader 遇到当前用户可见的历史 `schema_version = 1` 宽 payload event 时同样返回 `cursor_expired`，要求客户端重新 account snapshot；不可见历史 event 可以安全跨过。
- 客户端收到 `cursor_expired` 后保留未提交 outbox，清空远端投影，重新做 account snapshot，再由用户确认超过 receipt 保留期的操作。
- cursor 与用户身份绑定；不能跨账户或环境复用。
- `has_more = true` 时客户端应立即继续 pull，但仍必须串行，不能并发使用同一 cursor。

## 客户端 reducer 要求

未来客户端虽然不在本 MVP 实现，但协议要求其：

- 本地状态更新和 cursor 保存处于同一事务。
- 按 ID 与 revision 幂等 upsert；忽略较旧 revision。
- 保存已处理 event ID，或保证所有 event handler 天然幂等。
- tombstone 的 revision 不低于已存在记录，不能被旧 upsert 复活。
- redirect 解析到 canonical task，并防御循环。
- snapshot 过程中继续接受本地操作进入 outbox，但完成 snapshot 前不 push。
- 启动、回到前台、网络恢复、联网产生 outbox 和手动刷新时触发同步。
- 同一客户端同时只有一个 sync session；自动重试使用带 jitter 的指数退避。

## 主要错误 code

| Code | 是否重试 | 含义 |
|---|---|---|
| `unauthenticated` | 否，重新登录 | session 无效或过期 |
| `account_suspended` | 否 | 账户被暂停 |
| `protocol_version_unsupported` | 否，升级客户端 | 协议版本不支持 |
| `cursor_expired` | 否，bootstrap | 增量窗口已丢失 |
| `operation_id_reused` | 否，修复客户端 | 同 ID 不同内容 |
| `revision_conflict` | 否，用户解决 | mutable 数据已被其他设备修改 |
| `dependency_failed` | 否，修复前置 | 批内依赖失败 |
| `duplicate_proposal` | 否 | 完全相同 proposal 已存在 |
| `inactive_term` | 否 | 学期已归档或不可写 |
| `content_hidden` | 否 | target 不允许继续写入 |
| `payload_too_large` | 否，拆批 | 超出请求上限 |
| `rate_limited` | 是，按 `retry_after` | 限流 |
| `temporarily_unavailable` | 是 | 数据库或外部依赖临时不可用 |

错误对象统一包含 `code`、稳定结构化 `details`、诊断 `message`、`retryable`、可选 `retry_after` 和 `request_id`。客户端逻辑不能解析 message 文本。

## 官方限制默认值

- 请求 JSON：512 KiB。
- operations：100。
- event page：默认 200，最大 500。
- snapshot page：默认 200，最大 500。
- comment/history page：默认 50，最大 100。
- snapshot token：15 分钟无活动过期。

这些是带配置的服务器保护值，但降低上限不能破坏协议；客户端必须支持更小分页和 `payload_too_large` 拆批。

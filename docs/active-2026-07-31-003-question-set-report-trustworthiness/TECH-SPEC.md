---
title: 问题集运行控制与报告可信度修复技术方案
date: 2026-07-31
status: active
source: 2026-07-31 生产问题集运行 #3 诊断、docs/active-2026-07-23-004-question-set-run-reports/prd.md
scope: deep
---

# 问题集运行控制与报告可信度修复技术方案

## 1. 背景与目标

2026-07-31 对正式入口 `https://insight.guangtuo.com/geo/question-set-reports?run_id=3` 的运行时、数据库、日志和页面联合诊断确认了四类互相独立但同时影响用户信任的问题：

1. 运行 #3 实际已在 18:42:52 收敛为“部分完成”，10 条计划中 8 条完成、2 条仅结构化分析失败；用户观察到的“持续运行”发生在执行期间，不是当前仍有后台任务。
2. 18:33:52 的暂停请求成功，但 soft pause 只阻止领取下一条任务，不取消两条已领取任务；14 秒后浏览器又发出了恢复请求，且恢复接口缺少并发幂等保护，页面也没有提交中禁用状态。
3. DeepSeek Web 和豆包 Web 使用 `innerText` 保存回答，表格、列表、标题和链接结构被压平；DeepSeek 显式引用锚点的可见文字只有数字，因此报告只显示数字；网络检索候选还存在宽泛抓取、无关条目和 UTF-8 被错误按单字节编码解释后的乱码。
4. 两条回答已经成功采集并保存，但 `ai_structured_v4` 输出中的实体表面词未通过精确定位校验，因此整条分析按现行 fail-closed 规则失败，不写品牌指标。

本方案的目标是在不建立第二套运行链路、不放松指标证据边界的前提下，让运行状态、暂停行为、原始回答、引用与检索证据、结构化分析失败都具备真实、稳定、可解释的用户语义。

## 2. 范围与非目标

### 2.1 范围

- 为问题集报告增加可观察的控制状态和执行明细，区分正在执行、等待处理、暂停收尾、已暂停和终态。
- 使暂停、继续操作具备原子、幂等语义，并阻止前端重复提交。
- 将新 Web 回答从 DOM 安全转换为受控 Markdown，保留段落、标题、列表、表格、代码块、链接和引用标记。
- 规范显式引用的标题、显示序号、域名和 URL，避免把 `-1`、`[3]` 等数字标记当作标题。
- 收紧检索候选采集边界，修复可证明的编码错乱，过滤 UI、静态资源和无关 URL，并暴露截断统计。
- 提升结构化分析二次重试的针对性；在至少存在一个精确可定位表面词时，允许丢弃同实体的无效附加表面词并记录诊断。
- 在结构化分析前识别豆包搜索状态、资料摘要和计划文本；新运行直接保存为“采集无效”，历史报告读取时按同一规则归类，且不进入分析覆盖率分母或品牌指标。
- 对表格组合证据执行确定性、逐单元精确锚定；仍失败的 evidence 只请求字段级补丁，不重新生成整份结构化 JSON。
- 使用自动化测试、真实浏览器入口和正式部署流程验证修复；经人工确认后，对运行 #3 的两条分析失败记录执行 analysis-only 重试。

### 2.2 非目标

- 不把 soft pause 改成强制中断正在生成的浏览器回答；强杀 Chrome 可能破坏会话与证据完整性。
- 不增加取消运行、撤销已完成结果或回滚外部平台请求的能力。
- 不修改 SOV、品牌提及率、推荐率、排名或引用 KPI 的计算口径。
- 不让程序用模糊匹配、编辑距离或名称相似度猜测实体证据。
- 不把检索候选计入显式引用 KPI。
- 不抓取任意外部网页来补标题，避免 SSRF、性能和内容可信度风险。
- 不对存量 `plain_text` 回答猜测重建表格或列表；已经丢失的 DOM 结构只能通过重新执行完整监测获得。
- 不批量重算或改写全部历史指标和历史证据。

### 2.3 延后事项

- 若后续业务要求“点击暂停后立即停止当前生成”，另行设计可取消的浏览器任务、平台会话恢复和证据一致性协议。
- 若真实平台长期改变网络响应结构，按新脱敏 fixture 扩充候选路径白名单，不恢复任意 JSON 递归抓取。

## 3. 当前系统认知

### 3.1 正式入口与运行事实

- 正式报告入口：`nextjs-frontend/src/app/geo/question-set-reports/page.tsx`。
- 报告聚合与只读状态派生：`backend/services/QuestionSetRunService.js`。
- 问题集执行、暂停和恢复：`backend/services/ProjectRunService.js`。
- 暂停和恢复 API：`backend/routes/geoProjects.js`。
- `QuestionRecord.status` 只有 `pending / completed / failed`；当前报告把所有 `pending` 都显示为“进行中”。
- worker 只在领取下一条记录前检查 `QuestionSetRun.paused_at`；已经领取并持有有效租约的记录会继续完成。
- 当前恢复接口先读取暂停状态、后清空 `paused_at` 并调度；并发请求可能都通过读取检查。

### 3.2 Web 回答和来源证据

- DeepSeek Web 采集：`backend/services/DeepSeekWebAdapter.js`。
- 豆包 Web 采集：`backend/services/DoubaoWebAdapter.js`。
- 两个平台当前都从回答容器读取 `innerText`，结构化排版在保存前已经丢失。
- `provider_citations` 同时保存 `explicit_citation` 和 `retrieval_candidate`，两者由 `source_role` 区分。
- 显式引用进入引用 KPI；检索候选只证明平台搜索过程观察到候选页面，不代表回答引用了该页面。
- DeepSeek/豆包网络观察当前递归遍历 JSON/SSE 中任意 `url/link/href/source_url` 字段，边界过宽。
- `WebCaptureEvidence.tsx` 和问题集报告直接优先显示 `source.title`，因此数字锚点和乱码标题原样暴露。

### 3.3 结构化分析

- 正式分析契约为 `ai_structured_v4`；2026-08-01 使用 `semantic_evidence_few_shot_v7`，本轮修复后升级为 `semantic_evidence_field_repair_v8`，不改变指标语义版本。
- `backend/services/AIResponseAnalysisService.js` 最多尝试两次；第二次会携带首轮错误和无效输出。
- 当前任一 `surface_forms` 无法在完整原回答中精确定位时，整条分析失败。
- `ProjectRunService` 已支持对保存了完整原回答与 provider citations 的失败记录执行 `analysis_only` 重试，不再次调用监测平台，也不消耗监测配额。

### 3.4 需要沿用的模式

- 报告读取保持只读，不在 GET 中调和或修改运行状态。
- 执行租约和 fencing token 仍是判断当前执行权的事实源；对外不得返回 token、owner 或内部租约详情。
- API 字段沿用现有 `snake_case` 风格，变更优先增加字段，不改变既有字段类型和含义。
- 外部平台 DOM、JSON、SSE 和分析模型输出都属于不可信输入，必须在 adapter 或解析器边界校验。
- Web 证据继续按记录归属和私有读取接口保存；新格式不得绕过现有证据访问控制。

## 4. 需求、约束与规则

### 4.1 功能要求

- REQ-001：报告必须区分 `executing` 与 `queued`，且二者之和等于现有 `pending`。
- REQ-002：设置 `paused_at` 后不得再领取新记录；已持有有效执行租约的记录允许完成。
- REQ-003：存在已执行记录时，暂停后显示“暂停收尾中”，不得显示为已经完全停止。
- REQ-004：暂停和继续接口必须支持重复、并发调用；一次控制状态迁移最多触发一次调度。
- REQ-005：暂停或继续请求提交期间，对应按钮必须 loading 且不可重复点击。
- REQ-006：新 Web 回答必须保存格式标识；报告只对明确标记为 Markdown 的回答启用 Markdown 渲染。
- REQ-007：Markdown 转换必须保留常用语义结构，同时禁止原始 HTML、脚本、事件属性和非 HTTP(S) 链接。
- REQ-008：显式引用必须保存 URL、域名、可用标题和独立显示序号；纯数字锚点不得作为标题。
- REQ-009：检索候选必须来自已验证的平台搜索结果数组，不得从任意响应对象递归捞取 URL。
- REQ-010：可证明为 UTF-8/单字节误解码的标题可修复；不确定时保留原值或回退域名，不做无界猜测。
- REQ-011：检索候选按规范 URL 去重，最多保存 20 条，标题最多 160 字，并记录观察、接纳、丢弃和截断数量。
- REQ-012：结构化分析二次重试必须给出与具体字段错误对应的纠正要求。
- REQ-013：同一实体至少有一个表面词能精确定位时，无效附加表面词可以丢弃；全部表面词均无效时整条分析仍失败。
- REQ-014：任何被丢弃的表面词都不得参与提及计数、排名、推荐、情绪或 SOV，并必须进入有界诊断。
- REQ-015：运行 #3 的存量原回答、引用和指标不得被伪造或静默改写；修复后只对两条分析失败记录做 analysis-only 重试。
- REQ-016：豆包搜索状态、搜索资料摘要和计划/准备文本必须在结构化分析调用前标记为 `capture_quality.status=invalid`，失败码为 `web_capture_invalid_answer`。
- REQ-017：历史报告读取必须用同一纯函数识别上述存量回答，只做只读归类，不回写数据库。
- REQ-018：采集无效记录不得进入分析覆盖率分母、引用 KPI 或品牌指标；若历史异常数据已经带有指标，聚合层也必须按记录 ID 排除。
- REQ-019：表格组合证据仅当每个非分隔单元都能在完整原回答中精确定位时，才可确定性拆成多个原文 evidence；不得丢弃找不到的单元后让证据通过。
- REQ-020：仅 evidence 校验失败时，第二次模型请求只能返回失败 evidence 字段的补丁；不得重新生成整份 JSON，未知字段、重复字段、缺失字段和无法定位的补丁继续 fail-closed。

### 4.2 约束

- CON-001：SQLite 和 Postgres 的暂停/恢复状态迁移必须具有同一业务语义。
- CON-002：不得在数据库事务内执行外部 AI 或浏览器调用。
- CON-003：不得通过前端按钮状态推断后端调度权，后端原子状态迁移是唯一事实源。
- CON-004：Markdown 渲染不得启用 `rehypeRaw` 或 `dangerouslySetInnerHTML`。
- CON-005：URL 只接受不含内嵌用户名或密码的 `http:` 和 `https:`；外链继续使用安全的新窗口属性。
- CON-006：编码修复只对标题等展示文本执行，不修改 URL、域名、回答原文或结构化分析证据。
- CON-007：分析校验仍保持 fail-closed；“丢弃无效附加表面词”只是一条可审计的精确证据归一化规则，不是模糊兜底。
- CON-008：不新增数据库列；回答格式、候选统计等新增持久信息写入现有 `QuestionRecord.result_summary.web_capture` JSON。
- CON-009：生产源码只通过本地修改、验证、提交、推送和 Git Bundle 快进部署，不直接编辑服务器仓库文件。
- CON-010：字段级 evidence 修复最多使用现有第二次分析请求，不增加第三次重试；非 evidence 结构错误继续沿用完整对象重试。

### 4.3 不变量

- INV-001：`execution_summary.pending = execution_summary.executing + execution_summary.queued`。
- INV-002：任一报告行恰好有一个 `execution_state`。
- INV-003：同一轮暂停到恢复的状态迁移最多创建一个新的执行调度。
- INV-004：`explicit_citation` 与 `retrieval_candidate` 不因标题、编码或 UI 展示修复而互相转换。
- INV-005：无精确原文证据的实体不进入品牌表现指标。
- INV-006：存量 `plain_text` 保持原文不变，新 Markdown 只来自采集时的 DOM 语义转换。
- INV-007：任一保存为或只读识别为 `capture_quality.status=invalid` 的记录，对结构化分析成功率和品牌指标的贡献恒为零。
- INV-008：进入最终结构的每条 evidence 仍必须通过既有精确原文定位校验；表格锚定和字段补丁都不得绕过该校验。

## 5. 接口与数据契约

### 5.1 报告输出

保留现有：

- `status`: `running | paused | completed | partial | failed`
- `execution_summary.pending`
- 行级 `status`: `pending | completed | failed`

新增：

```json
{
  "control_state": "pausing",
  "execution_summary": {
    "total": 10,
    "completed": 4,
    "failed": 0,
    "pending": 6,
    "executing": 2,
    "queued": 4
  },
  "rows": [
    {
      "status": "pending",
      "execution_state": "executing",
      "answer_format": "plain_text"
    }
  ]
}
```

`control_state` 取值：

| 值 | 规则 |
| --- | --- |
| `running` | native run 有 pending，且未设置 `paused_at` |
| `pausing` | 已设置 `paused_at`，仍有持有效租约的 executing 记录 |
| `paused` | 已设置 `paused_at`，无 executing，且仍有 queued |
| `terminal` | 无 pending，父运行已收敛为终态 |
| `read_only` | imported 或 snapshot-only，没有可操作的完整运行事实 |

行级 `execution_state` 取值：

- `completed`：现有行状态为 completed。
- `failed`：现有行状态为 failed。
- `executing`：行状态为 pending，且执行 token、owner 和未过期租约共同证明当前有人持有执行权。
- `queued`：其他 pending，包括尚未领取或租约已过期、等待 recovery 的记录。

兼容规则：

- 旧消费者可以继续只看 `status` 和 `pending`。
- 新前端优先使用 `control_state` 与 `execution_state`；字段缺失时回退现有展示。
- API 不返回 `execution_token`、`lease_owner` 或 `lease_expires_at`。

### 5.2 暂停和继续命令

接口路径保持：

- `POST /api/geo-projects/:projectId/question-set-runs/:runId/pause`
- `POST /api/geo-projects/:projectId/question-set-runs/:runId/resume`

成功响应在现有外层内增加：

```json
{
  "success": true,
  "data": {
    "run_id": 3,
    "control_state": "pausing",
    "idempotent_replay": false
  }
}
```

规则：

- pause 以条件更新 `completed_at IS NULL AND paused_at IS NULL` 完成状态迁移。
- 已处于 `pausing/paused` 的重复 pause 返回 200 和 `idempotent_replay=true`，不返回 409。
- resume 以条件更新 `completed_at IS NULL AND paused_at IS NOT NULL` 取得唯一恢复权；只有更新成功者可以重建上下文并启动调度。
- 已处于 `running` 的重复 resume 返回 200 和 `idempotent_replay=true`，不得再次调度。
- 已终态、只读或无完整运行记录仍按现有安全错误语义拒绝。
- 状态更新成功但调度提交失败时，必须恢复为可恢复的暂停状态，或写入稳定失败诊断；不得留下“显示运行中但无人调度”的状态。

### 5.3 回答格式

新 Web capture 在现有 `result_summary.web_capture` 中增加：

```json
{
  "answer_format": "markdown_v1"
}
```

报告行增加：

```json
{
  "answer": "厂家名称 | 主要产品\n---|---\n……",
  "answer_format": "markdown_v1"
}
```

规则：

- `markdown_v1` 只允许来自受管 Web adapter 的 DOM 语义序列化器。
- API 平台和存量 Web 记录默认 `plain_text`，除非其可信响应契约明确声明格式。
- `markdown_v1` 支持段落、换行、标题、无序/有序列表、表格、引用块、代码块、强调和 HTTP(S) 链接。
- 不保存平台页面原始 HTML；不渲染内联 HTML。

### 5.4 来源对象

`provider_citations` 保留原字段并加法扩展：

```json
{
  "url": "https://example.com/article",
  "domain": "example.com",
  "title": "页面标题",
  "display_index": 3,
  "source_role": "explicit_citation",
  "source_origin": "deepseek_web_dom"
}
```

标题优先级：

1. 平台搜索结果或 DOM 元数据中的非空标题。
2. 不属于纯数字引用标记的锚点文字。
3. URL 对应的域名。
4. 完整 URL。

数字标记只进入 `display_index`，不进入 `title`。规范化层必须识别 `1`、`-1`、`[1]`、`【1】` 等仅承担序号作用的文本。

### 5.5 检索候选观察统计

在 `web_capture.search` 中增加：

```json
{
  "candidate_observation": {
    "observed_count": 34,
    "accepted_count": 12,
    "dropped_count": 22,
    "truncated": false
  }
}
```

该统计只描述 adapter 观察和过滤过程，不表示引用数量，也不进入指标。

### 5.6 分析归一化诊断

分析结构合法且仅丢弃无效附加表面词时，在现有分析诊断或结构中增加有界警告：

```json
{
  "normalization_warnings": [
    {
      "code": "unsupported_surface_form_dropped",
      "entity_name": "某实体",
      "dropped_count": 1
    }
  ]
}
```

不保存被丢弃的完整长文本，避免诊断无限膨胀。若某实体归一化后没有任何精确表面词，仍抛出 `invalid_analysis_output`。

## 6. 关键技术决策

- KTD-001：保留 soft pause。暂停的强保证是“不再领取下一条任务”，不是中断已发出的外部请求；UI 用 `pausing` 真实表达收尾过程。
- KTD-002：控制状态由当前运行记录和有效租约只读派生，不增加另一套持久状态机，避免状态漂移。
- KTD-003：pause/resume 使用条件更新取得唯一状态迁移权，不依赖进程内锁；因此多进程和 SQLite/Postgres 语义一致。
- KTD-004：新回答保存安全 Markdown 而非 HTML。Markdown 足以表达用户需要的结构，且可沿用前端已有 `react-markdown + remark-gfm`。
- KTD-005：不为本次修复新增数据库列。格式与采集统计属于 Web capture 契约，写入现有 JSON；报告字段由服务端归一化输出。
- KTD-006：引用标题不通过服务器访问第三方 URL 补齐，只使用平台已返回元数据、DOM 安全文本和域名回退。
- KTD-007：检索候选从“任意 JSON 递归发现”硬切为“平台适配器白名单路径 + 形状校验”。未识别响应只记录为未接纳，不静默恢复宽泛抓取。
- KTD-008：编码修复采用保守的可逆判定：仅当输入由单字节字符构成、重新解释为 UTF-8 成功且乱码评分明显下降时使用修复值。
- KTD-009：分析模型的有效输出契约不变，因此继续使用 `ai_structured_v4`；提示词修订升级，归一化警告显式记录，不改变指标公式版本。
- KTD-010：运行 #3 的两条失败记录只做 analysis-only 重试；其存量纯文本回答不伪造结构，若需恢复原表格必须创建新的完整监测运行。

## 7. 实现切片

### U1. 运行状态可观察与暂停恢复幂等

**目标：** 用户能准确看到执行中、排队中、暂停收尾和已暂停；重复或并发继续只触发一次调度。

**依赖：** 无。

**涉及文件：**

- `backend/services/QuestionSetRunService.js`
- `backend/services/ProjectRunService.js`
- `backend/routes/geoProjects.js`
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/QuestionSetRunApi.test.js`
- `backend/tests/QuestionSetRunReconciliation.test.js`
- `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
- `nextjs-frontend/src/utils/questionSetRunPresentation.cjs`
- `nextjs-frontend/src/utils/questionSetRunPresentation.test.cjs`
- `nextjs-frontend/src/utils/questionSetReportPage.test.cjs`

**方案：**

- 在报告查询关联记录中读取判断执行状态所需的租约字段，只在服务层派生安全状态。
- 扩展 `execution_summary`、报告行和 `control_state`，保留旧字段兼容。
- pause/resume 改为条件更新；resume 只有唯一获胜者调度。
- 前端增加独立 `pauseSubmitting`、`resumeSubmitting`，按钮 loading 期间禁用其他运行控制操作。
- 状态说明明确 soft pause 语义，并分别展示 executing 和 queued 数量。

**测试场景：**

- 2 条执行中、4 条排队时暂停，报告显示“暂停收尾中”，且不领取第 3 条。
- executing 清零后仍有 queued，报告显示“已暂停”。
- 两个并发 resume 只有一个调用调度器，两个请求都得到可解释成功响应。
- pause/resume 网络请求未完成时无法重复点击。
- 旧报告缺少新字段时仍能展示。

**验收方式：** 从问题集报告入口执行一组至少 4 条、并发 2 的任务；暂停后只允许已领取的 2 条收敛，排队项保持不变；连续触发恢复不会出现重复平台调用。

### U2. Web 回答结构与显式引用可信展示

**目标：** 新采集回答保留可读结构，显式引用显示可识别标题或域名，并保持安全渲染。

**依赖：** 无。

**涉及文件：**

- `backend/services/DeepSeekWebAdapter.js`
- `backend/services/DoubaoWebAdapter.js`
- `backend/services/QuestionSetRunService.js`
- `backend/tests/DeepSeekWebAdapter.test.js`
- `backend/tests/DoubaoWebAdapter.test.js`
- `backend/tests/QuestionSetRunService.test.js`
- `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
- `nextjs-frontend/src/components/WebCaptureEvidence.tsx`
- `nextjs-frontend/src/utils/webCaptureEvidence.cjs`
- `nextjs-frontend/src/utils/questionSetReportPage.test.cjs`

**方案：**

- 在回答 DOM 内执行有界、平台适配的语义序列化，生成 `markdown_v1`；稳定性判断和 SHA-256 均基于最终保存文本。
- 明确处理表格、列表、标题、段落、代码和链接，未知节点只递归读取安全文本。
- 引用抽取将数字标记解析为 `display_index`，标题按元数据、非数字锚点、域名、URL 回退。
- 新报告用 `ReactMarkdown + remarkGfm` 渲染 `markdown_v1`，不启用原始 HTML；`plain_text` 继续原样预格式化。
- CSV v1 继续导出回答文本；若需要保留格式判定，在尾部增加可选 `answer_format` 列，旧 CSV 不受影响。

**测试场景：**

- 包含 GFM 表格、嵌套列表、标题、代码块和引用链接的 DOM 得到稳定 Markdown。
- 脚本、事件属性、`javascript:` URL 和原始 HTML 不进入渲染结果。
- `-1`、`[3]` 不作为标题，存在元数据时显示标题，否则显示域名。
- 存量 `plain_text` 不被当作 Markdown 解释。
- 导出/导入不丢失已声明的回答格式，旧 CSV 仍可导入。

**验收方式：** 新运行的厂家对比回答在报告中显示为表格和列表；引用均为可点击链接且标签不是孤立数字；安全 fixture 不产生可执行 HTML。

### U3. 检索候选归一化、过滤与乱码修复

**目标：** 检索候选只包含可解释的搜索结果，中文标题正常显示，历史乱码可在读取时安全修复。

**依赖：** U2 的来源标题与 URL 归一化规则。

**涉及文件：**

- `backend/services/DeepSeekWebAdapter.js`
- `backend/services/DoubaoWebAdapter.js`
- `backend/services/QuestionSetRunService.js`
- `backend/tests/DeepSeekWebAdapter.test.js`
- `backend/tests/DoubaoWebAdapter.test.js`
- `backend/tests/QuestionSetRunService.test.js`
- `nextjs-frontend/src/components/WebCaptureEvidence.tsx`
- `nextjs-frontend/src/utils/webCaptureEvidence.cjs`

**方案：**

- 用脱敏真实响应 fixture 固化 DeepSeek 和豆包各自允许的搜索结果数组路径与元素形状。
- 删除正式路径中的任意对象递归 URL 收集；未命中白名单的响应不产生候选。
- 过滤平台自身 UI、登录/反馈页、静态资源、无 HTTP(S) URL、空标题和明显超长 UI 文本。
- 对 URL 去 fragment、规范化后去重；新记录最多保存 20 条。
- 在写入时修复可证明的 mojibake；报告读取层对存量标题应用相同展示修复，但不回写数据库。
- Web 证据卡默认折叠候选，并解释“平台搜索过程中观察到，不代表回答引用，不计入引用 KPI”。

**测试场景：**

- `ç”µç£æ„ŸçŸ¥ - ä¸Šæµ·å¹¿æ‹“` 可恢复为中文标题。
- 正常中文、英文和无法证明的混合文本保持不变。
- 任意深层对象中的无关 URL 不被采集。
- 同 URL 的 fragment 变体只保留一条，超过 20 条时统计标记为截断。
- 运行 #3 的历史乱码在报告读取时正常显示，但数据库原始快照不变。

**验收方式：** 同一问题的新 Web 运行中候选数量、标题和链接可人工复核；报告明确区分显式引用与检索候选；存量运行 #3 不再显示可修复的乱码标题。

### U4. 结构化分析纠错与精确证据归一化

**目标：** 降低由单个多余错误别名导致的整条失败，同时继续拒绝无精确证据的实体和指标。

**依赖：** 无。

**涉及文件：**

- `backend/services/AIResponseAnalysisService.js`
- `backend/tests/AIResponseAnalysisService.test.js`
- `backend/tests/AIResponseAnalysisV4.test.js`
- `backend/services/ProjectRunService.js`
- `backend/tests/ProjectRunService.test.js`
- `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
- `nextjs-frontend/src/utils/historyErrorDisplay.test.cjs`

**方案：**

- 将校验错误结构化为字段路径、错误类型和实体名，二次提示明确要求删除不在原文中的实体/别名或复制原文精确表面词。
- 非 evidence 的结构错误第二次仍重新输出完整 v4 对象；evidence 错误改为只输出失败字段补丁，避免重生成其他已经正确的字段。
- 表格组合证据先做确定性拆分：每个非分隔单元都必须独立精确定位；任一单元缺失时整字段进入模型修复，不能只保留可定位部分。
- 归一化时先收集同实体全部表面词：精确可定位的进入计数；无效附加项丢弃并产生有界 warning。
- 若实体最终没有任何精确表面词，或关系、候选、情绪证据引用了不存在实体，整条继续失败。
- 提示词修订升级但不改变 `ai_structured_v4` 和指标语义版本。
- 报告在分析诊断中展示“已忽略 N 个无原文依据的附加名称”，不展示内部提示词或无界模型输出。

**测试场景：**

- `["上海广拓", "广拓公司（原文不存在）"]` 只使用精确存在的名称并记录 warning。
- 所有表面词都不存在时仍为 `invalid_analysis_output`，不写指标。
- 空数组但实体全称在原文中时沿用现有精确全称回填规则。
- 二次提示包含字段路径和可执行纠正要求。
- analysis-only 重试继续复用原回答和引用，不调用监测平台、不扣监测配额。

**验收方式：** 用运行 #3 的脱敏失败形状 fixture 验证：有至少一个精确证据的多余别名不再导致整条失败；完全无证据输出仍被拒绝。

### U5. 正式切换、历史处置与生产入口验收

**目标：** 将 U1–U4 接入唯一正式入口，完成发布门禁，并在不篡改证据的前提下处置运行 #3。

**依赖：** U1、U2、U3、U4。

**涉及文件：**

- `README.md`
- `docs/README.md`
- `docs/DEPLOYMENT.md`
- 本需求目录及相关测试证据

**方案：**

- 完成后端全量测试、前端 Node 回归、lint、类型检查和生产构建。
- 通过真实报告页面验证暂停/恢复、Markdown、引用标签、候选说明和分析诊断。
- 本地提交并推送后，使用校验过的 Git Bundle 快进服务器 `main`，执行仓库正式部署入口；发布前备份生产 SQLite。
- 部署前后分别核对服务器 `HEAD`、`origin/main`、工作区状态、systemd 服务、`/api/ready` 和受管 Chrome 会话。
- 经人工确认后，对运行 #3 的两条结构化分析失败记录只执行一次幂等 analysis-only 重试。
- 不修改运行 #3 已保存的原始回答；如需要恢复表格结构，另建一次完整监测运行。
- 更新当前文档，只描述新正式路径；不保留旧候选递归抓取或非幂等恢复作为 fallback。

**测试场景：**

- 正式入口创建小规模问题集运行，暂停后排队数不再下降，已执行数正常收敛。
- 重复 resume 不产生重复浏览器提问或重复记录。
- DeepSeek Web 与豆包 Web 各至少一条回答完成结构化展示和来源分组。
- 服务重启后运行状态和租约派生仍正确。
- 运行 #3 analysis-only 重试不产生新的 Web capture，也不消耗监测配额。

**验收方式：** 保存 API 响应、结构化日志、数据库只读不变量查询和真实页面截图；任一门禁失败则不把目录改为 `closed`，也不宣称生产已生效。

## 8. 验收标准

- AC-001：Given 并发 2 且至少 4 条待执行任务，When 用户点击暂停，Then 不再领取新任务，已领取任务显示为“暂停收尾中”并允许完成。
- AC-002：Given 已完全暂停且仍有排队项，When 用户查看报告，Then 报告显示“已暂停”，执行中为 0，排队数大于 0。
- AC-003：Given 两个并发 resume 请求，When 后端处理，Then 只有一个请求取得恢复权并启动一次调度，另一个返回幂等回放。
- AC-004：Given 控制请求仍在提交，When 用户再次点击，Then 前端不会发出第二个相同请求。
- AC-005：Given 新采集回答包含表格、列表和链接，When 打开报告，Then 结构可读且不执行任何原始 HTML 或脚本。
- AC-006：Given 显式引用锚点文本只有数字，When 展示引用，Then 链接标签使用平台标题或域名，数字只作为序号。
- AC-007：Given 网络响应包含搜索结果和无关 UI URL，When 采集候选，Then 只接纳白名单搜索结果，最多 20 条并记录过滤统计。
- AC-008：Given 可证明的 UTF-8 mojibake 标题，When 新写入或读取历史报告，Then 页面显示修复后的中文且数据库历史快照不被回写。
- AC-009：Given 一个实体有至少一个精确表面词和一个无效附加表面词，When 归一化分析输出，Then 只使用精确表面词并记录 warning。
- AC-010：Given 一个实体没有任何可定位表面词，When 校验分析输出，Then 整条分析失败且不进入品牌指标。
- AC-011：Given 运行 #3 两条分析失败记录，When 执行获批的修复重试，Then 只调用分析 API，不调用 Web 监测、不扣监测配额。
- AC-012：Given 存量 `plain_text` 回答，When 发布新前端，Then 原文保持不变且不会被错误解释为 Markdown。
- AC-013：Given 正式部署完成，When 从公开入口运行并检查服务，Then 新状态、格式和证据路径生效，旧非幂等恢复和宽泛候选抓取不再被正式入口调用。
- AC-014：Given 豆包回答为“正在搜索”、搜索资料摘要或计划文本，When 正式执行链收到回答，Then 不调用结构化分析，记录标记为采集无效并保留原始采集证据。
- AC-015：Given 历史报告含上述过渡态文本，When 打开报告，Then 行显示“采集无效”，且 `invalid_captures` 单独计数、`acquired_answers` 和分析覆盖率分母均排除该行。
- AC-016：Given 历史采集无效记录异常带有指标，When 聚合项目或问题集指标，Then 该指标不计入提及率、推荐率、SOV、情绪和引用指标。
- AC-017：Given evidence 把多个表格单元拼成非连续文本，When 每个单元均能精确定位，Then 系统确定性拆成多个原文片段且只调用模型一次。
- AC-018：Given evidence 含任一不存在的表格单元，When 执行字段修复，Then 第二次请求只包含失败 evidence 字段；补丁仍不存在时整条分析失败且不写指标。

## 9. 测试与验证计划

### 9.1 自动化测试

- 后端：
  - `backend/tests/QuestionSetRunService.test.js`
  - `backend/tests/QuestionSetRunApi.test.js`
  - `backend/tests/QuestionSetRunReconciliation.test.js`
  - `backend/tests/DeepSeekWebAdapter.test.js`
  - `backend/tests/DoubaoWebAdapter.test.js`
  - `backend/tests/AIResponseAnalysisService.test.js`
  - `backend/tests/AIResponseAnalysisV4.test.js`
  - `backend/tests/ProjectRunService.test.js`
- 前端：
  - `nextjs-frontend/src/utils/questionSetRunPresentation.test.cjs`
  - `nextjs-frontend/src/utils/questionSetReportPage.test.cjs`
  - `nextjs-frontend/src/utils/webCaptureEvidence.test.cjs`，若当前不存在则在实现中新增。
- 回归门禁：
  - 后端完整 `npm test`。
  - 前端完整 Node 测试、lint、TypeScript 检查和生产构建。

### 9.2 fixture 策略

- 只使用脱敏后的平台 DOM 与网络响应最小 fixture。
- fixture 覆盖中文 mojibake、数字引用标记、表格/列表、候选超限、无关嵌套 URL 和分析表面词错误。
- 不把生产账号、Cookie、Token、完整网页响应或用户数据写入 Git。

### 9.3 真实入口验证

- 创建低数量、双 Web 平台或单 Web 平台的专用验收运行，避免污染业务问题集。
- 在任务执行中点击一次暂停，记录 executing/queued 变化；再快速重复触发继续，验证只有一次调度。
- 展开回答和 Web 证据，核对 Markdown、显式引用与检索候选。
- 只读核对任务记录、租约、provider citations、analysis diagnostics 与配额变化。

### 9.4 发布与回滚

- 发布前对生产 SQLite 做在线备份并执行 `PRAGMA quick_check`。
- 发布只使用项目正式部署入口和 systemd 服务，不在远程桌面或 SSH 中启动第二套 Node 进程。
- 代码回滚使用前一 Git 提交；数据回滚只在新增写入造成不可接受影响时使用发布前备份。
- 若仅 UI 或 adapter 回归，不回退到旧候选递归抓取或旧非幂等 resume；直接修复新实现。

## 10. 风险与缓解

- 风险：平台 DOM 变化导致 Markdown 序列化失败。
  - 缓解：平台级 selector/fixture 测试；无法确认回答容器时以稳定错误失败，不保存错位内容。
- 风险：Markdown 改变稳定性判断，导致生成未完成就被判定稳定。
  - 缓解：稳定性仍同时要求生成控件消失、页面非 busy 和连续稳定窗口；测试增量 DOM 变化。
- 风险：并发 resume 在不同进程同时调度。
  - 缓解：数据库条件更新取得唯一恢复权，并用执行租约作为第二道 fencing。
- 风险：租约短暂过期使执行中记录显示为排队。
  - 缓解：沿用心跳续租；状态只表达当前可证明事实，不把过期租约伪装为活跃。
- 风险：编码修复误伤合法的拉丁文本。
  - 缓解：要求 UTF-8 解码成功且乱码评分显著改善；正常文本和不确定文本保持原样。
- 风险：放宽单个表面词处理造成错误指标。
  - 缓解：只接受同实体中其他精确可定位表面词；无精确词仍整条失败，丢弃项不参与任何计算并留下诊断。
- 风险：生产运行 #3 的重试覆盖审计信息。
  - 缓解：沿用已有重试链和父运行 revision，新旧记录均保留；先备份，再使用幂等 analysis-only 接口。

## 11. 假设与开放问题

### 11.1 假设

- 当前 soft pause 语义符合业务需求，只需真实展示和防止误恢复。
- DeepSeek 与豆包当前页面都能从回答容器 DOM 提取足够的表格、列表和链接语义。
- 运行 #3 的两条失败记录仍保留完整原回答与 provider citations，可走 analysis-only。

### 11.2 开放问题

- 无阻塞产品问题。若实现期真实平台响应不包含稳定的候选数组路径，则该平台候选功能应显示“本次未获得可验证候选”，而不是恢复宽泛抓取。

## 12. 后续衔接

- 建议拆为 5 个 issue：运行控制、回答与显式引用、检索候选、分析纠错、正式切换与生产验收。
- 建议第一个 issue：运行状态可观察与暂停恢复幂等。
- U1 和 U4 适合 TDD；U2、U3 使用脱敏 DOM/网络 fixture 做 adapter contract test；U5 必须包含真实入口验收。
- 2026-08-03 因豆包历史过渡态与表格 evidence 失败重新进入 `active`；Issue 006 完成生产验收后再恢复 `closed`。

## 13. 最终实现与生产验收（2026-08-01）

### 13.1 正式路径

- 唯一正式入口仍为 `https://insight.guangtuo.com/geo/question-set-reports`，新运行控制、Markdown 回答、来源归一化、候选过滤和分析证据归一化均已成为默认路径。
- 暂停保持 soft pause：点击后立即阻止领取新的排队任务；已被浏览器领取的回答允许完成，并依次显示“正在暂停”和“运行已暂停”。继续操作通过数据库条件更新取得唯一恢复权，重复请求不会重复调度。
- DeepSeek Web 与豆包 Web 的新回答只从受信回答容器生成 `markdown_v1`；搜索摘要、生成过程卡和宽泛 DOM 节点不会作为最终回答保存。
- 显式引用和指标引用源共用可读标签规则；纯数字、`autolink`、`link`、`url` 等占位标题回退为域名。检索候选只走平台白名单路径并执行有界归一化，旧任意 JSON URL 递归抓取已退出正式路径。
- 存量 `plain_text` 原回答不改写，也不猜测恢复已经丢失的表格或列表结构；需要结构化排版时只能重新发起完整监测。

### 13.2 自动化门禁

- 后端全量测试：977 / 977 通过。
- 市场监测回归：95 / 95 通过；前端监测 Node 测试：29 / 29 通过；Playwright：2 / 2 通过。
- 前端 lint 为 0 error，仅保留 1 条既有 `<img>` warning；生产构建通过并生成 36 个路由。
- 正式部署入口完成数据库备份、迁移检查、完整性检查、构建与 systemd 重启；后端、前端服务和 readiness 均正常。

### 13.3 真实运行证据

- 运行 #3 的 2 条失败记录仅执行 analysis-only 重试：`analysis_only_count=2`、`full_monitoring_count=0`、`quota_consumed=0`；原回答、引用和 Web 证据复用原记录，最终 10 / 10 完成、分析覆盖率 100%。
- 运行 #4 实测暂停后不再领取排队任务，已领取任务完成后进入“运行已暂停”；继续时只领取剩余排队项，未产生重复记录或重复平台调用。
- 验收运行 #7 中豆包保存了约 3000 字的完整 Markdown 回答和 6 条显式引用，而不是搜索摘要或进度文本；其单条分析失败再次只走 analysis-only，原回答哈希、长度和引用不变，最终 3 / 3 完成、分析覆盖率 100%。
- 正式页面复核运行 #3：显式引用与指标来源均显示站点域名或页面标题；可证明的历史乱码在读取时恢复为中文，检索候选区域明确声明不代表回答引用且不计入引用 KPI。

## 14. 2026-08-03 采集质量与证据字段修复增量

### 14.1 豆包异常根因

生产记录 39、45、51 的最终截图分别停留在“正在搜索”、搜索资料摘要和“我将梳理……为后续……做准备”的计划块；截图中的停止生成按钮仍存在，说明豆包没有拒答，也没有完成正式回答。旧 adapter 曾把当前搜索/工具/计划节点当成稳定回答容器，在正式回答出现前提前返回并开始下一条任务。记录 54 在相关 selector 修复后保存了完整表格回答，证明账号和豆包生成能力可用，故本轮根因是采集完成态误判，不是“豆包没有回答”。

### 14.2 正式实现

- `WebCaptureAnswerQualityService` 是 adapter、正式执行链、问题集报告和项目聚合共用的纯判定入口；仅对豆包 Web 身份或其 capture schema 生效。
- 新执行在 `ProjectRunService.finalizeSuccessfulRecord` 之前执行质量门禁。命中过渡态后保存原回答、来源与 Web capture，写入 `answer_quality` 和稳定失败码，但不调用结构化分析，也不生成指标。
- 历史读取不改数据库，通过同一判定入口增加 `capture_quality`；报告单独展示 `invalid_captures`。项目聚合按记录 ID 再过滤存量异常指标，防止历史不一致数据污染任何品牌指标。
- 表格 evidence 只做严格的确定性拆分：所有单元都能逐字定位才转换为多个原文片段。任一单元无法定位时，第二次请求只包含失败字段路径、字段上下文、无效 evidence 和完整原回答，响应只允许 `repairs[]`。
- 字段补丁必须逐一覆盖失败字段，不得出现未知或重复字段；每条修复 evidence 再走原有精确定位与完整 `parseOutput` 校验。字段修复占用第二次尝试，不存在第三次隐式重试。
- 当前生产分析运行配置继续使用 `deepseek-v4-flash`，`thinking.type=disabled`，不启用 Web 搜索；代码契约修订为 `semantic_evidence_field_repair_v8`。

### 14.3 验证状态

- 后端相关 TDD：采集计划块等待正式回答、执行前拦截、历史只读归类、项目指标排除、严格表格锚定、字段级修复及错误补丁拒绝均通过。
- 后端标准全量测试：988 / 988 通过。
- 本次报告页测试：18 / 18；前端 lint 通过；Next.js 生产构建通过并生成 36 个路由。
- 首次生产部署被 `b169953` 已有的 5 项营销前端契约失败拦截，服务按发布脚本设计保持停止后已由 systemd 恢复。缺失内容均为已批准只读产品边界文案：百度外跳提示、全局平台范围、未接入来源原因和跨来源不归因说明；采用最小实现修复后营销测试 29 / 29、lint 和生产构建通过，未修改数据或 API 行为。
- 生产部署、Flash 真实样本通过率和正式报告入口复核尚未完成；完成前目录保持 `active`。

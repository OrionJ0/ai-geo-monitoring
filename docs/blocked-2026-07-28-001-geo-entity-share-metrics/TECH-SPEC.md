---
title: GEO 指标口径与回答内竞品提及占比技术方案
date: 2026-07-28
status: blocked
source: docs/blocked-2026-07-28-001-geo-entity-share-metrics/prd.md
scope: deep
---

# GEO 指标口径与回答内竞品提及占比技术方案

## 1. 背景与目标

当前正式链路由监测平台生成原回答，`AIResponseAnalysisService` 使用 `ai_structured_v2` 抽取实体，再由程序计算并写入 `VisibilityMetric`。现有 `share_of_voice` 只使用人工配置竞品，无法表达回答语境中的真实竞争关系；项目级查询还会用项目当前平台配置过滤历史记录，长回答则被静默截取前 12,000 个字符分析。

本方案把新生成结果硬切到“回答内竞品提及占比（SOV）”：

- AI 结合当前问题和完整回答，逐条判断非目标企业实体是否为当前场景竞品，并返回简短理由。
- 程序根据原回答计算目标品牌和竞品的实际独立提及次数，再计算单条 SOV。
- 聚合层先计算每条回答的 SOV，再对可计算回答等权平均。
- 新旧指标使用不同存储字段和明确语义版本；历史旧结果不重算、不混合。
- 分析失败只降低分析覆盖率，不作为品牌未提及、未推荐或 SOV 为零。
- 项目看板和项目报告按时间范围保留实际历史数据，默认合并全部平台，并支持单平台查看。

## 2. 范围与非目标

### 2.1 范围

- 将正式分析契约升级为 `ai_structured_v3`。
- 把问题文本、目标品牌上下文、人工竞品提示和完整原回答传给分析模型。
- 新增逐实体 `competitor / non_competitor` 二选一判断及理由。
- 由程序计算实体提及次数、单条 SOV、聚合 SOV 和样本数。
- 新增指标语义版本及新 SOV 存储字段，隔离现有 `share_of_voice`。
- 为分析失败记录保存分析契约和指标语义版本。
- 更新项目看板、项目报告、问题/问题集报告、问题历史、导出、告警和洞察。
- 项目看板和项目报告支持“全部平台 / 单个平台”查看。
- 修正项目级历史查询，不再用当前平台配置隐藏已有记录。
- 更新 40 条人工基线和 10 条多实体人工抽查所需的离线脚本与报告。
- 从真实单问题、问题集和自动监测入口验证新契约正式生效且旧 SOV 未被调用。

### 2.2 非目标

- 不建设永久竞品库、实体角色知识图谱或专用分类模型。
- 不增加“无法判断”竞品状态。
- 不让 AI 返回提及次数、SOV、排名数字或推荐布尔值。
- 不对长回答分段分析或合并分段结果。
- 不在生产代码中执行人工准确率门禁。
- 不自动识别或过滤含目标品牌名称的问题。
- 不追溯重算旧指标、旧问题集报告或旧项目报告快照。
- 不实现问题集自动版本管理或自动建立比较基线。

### 2.3 延后事项

- 当人工抽查证明二选一竞品关系不足时，再评估更细实体角色。
- 当实际回答持续超过分析模型上下文限制时，再单独设计可验证的分段方案。
- 当数据规模证明项目级内存聚合成为瓶颈时，再引入数据库预聚合。

## 3. 当前系统认知

### 3.1 正式入口与数据流

1. 单问题和问题集从 `backend/routes/geoProjects.js` 进入 `ProjectRunService`。
2. 自动监测由 `SchedulerService` 创建任务，并通过 `ProjectRecordFinalizationService` 进入同一指标终态链路。
3. `ProjectRunService.buildVisibilityMetricPayload()` 调用 `AIResponseAnalysisService.analyze()`。
4. `AIResponseAnalysisService` 当前只接收原回答、目标品牌和人工配置竞品：
   - 契约版本为 `ai_structured_v2` / `geo_metric_input_v2`。
   - `competitor_matches` 只映射人工配置竞品。
   - 构造提示词时执行 `responseText.slice(0, 12000)`。
   - `share_of_voice` 使用目标品牌与人工配置竞品提及次数计算。
5. `ProjectRunService` 在同一终态事务中保存 `ResultDetail`、`VisibilityMetric` 和 `QuestionRecord`。
6. 分析失败时原回答可以保留，记录进入 `failed`，但项目级页面尚未完整表达分析覆盖率。

### 3.2 聚合与报告

- `ProjectMetricsService` 直接读取 `share_of_voice` 并将缺失值转为 `0` 后求平均。
- `GET /api/geo-projects/:projectId/dashboard` 和 `ReportSnapshotService` 使用项目当前 `platforms` 过滤周期数据。
- `QuestionSetRunService` 通过 `question_set_run_id` 只读取本次运行，因此不存在跨运行的平台混合问题。
- `QuestionSetRunCsvService` 使用 `question_set_run_v1`，当前必要列含无版本语义的 `share_of_voice`。
- `ReportSnapshot.summary` 保存生成时的聚合结果，适合保留历史口径，但当前没有独立指标语义版本。

### 3.3 受影响消费者

- 后端：
  - `backend/services/AIResponseAnalysisService.js`
  - `backend/services/AIPlatformRequestService.js`
  - `backend/services/ProjectRunService.js`
  - `backend/services/ProjectRecordFinalizationService.js`
  - `backend/services/ProjectMetricsService.js`
  - `backend/services/QuestionSetRunService.js`
  - `backend/services/QuestionSetRunCsvService.js`
  - `backend/services/ReportSnapshotService.js`
  - `backend/services/AlertEvaluationService.js`
  - `backend/services/OpportunityInsightService.js`
  - `backend/routes/geoProjects.js`
  - `backend/models/VisibilityMetric.js`
  - `backend/models/QuestionRecord.js`
  - `backend/models/QuestionSetRun.js`
  - `backend/models/ReportSnapshot.js`
- 前端：
  - `nextjs-frontend/src/app/geo/project-dashboard/page.tsx`
  - `nextjs-frontend/src/app/geo/reports/page.tsx`
  - `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
  - `nextjs-frontend/src/app/geo/prompts/page.tsx`
  - `nextjs-frontend/src/app/geo/alerts/page.tsx`
  - `nextjs-frontend/src/utils/historyAnalysisDisplay.cjs`
  - `nextjs-frontend/src/utils/reportCsv.cjs`
- 文档：
  - `README.md`
  - `CONTEXT.md`
  - `docs/README.md`
  - `docs/API.md`

### 3.4 现有测试与模式

- 后端使用 Node `node:test`。
- 前端以工具单元测试和源码契约测试为主，Next.js 构建负责 TypeScript 校验。
- Sequelize 同时支持 SQLite 和 Postgres；项目没有通用迁移框架，现有复杂迁移采用幂等迁移服务、只读审计和 CLI。
- 问题集运行已经固化 `analysis_contract_version`，并支持只读历史报告、CSV 往返和 analysis-only 重试。
- 引用指标已经采用“语义版本 + 历史只读 + 当前聚合过滤”的兼容模式，新 SOV 沿用该模式。

## 4. 需求、约束与规则

### 4.1 版本常量

- `CURRENT_ANALYSIS_CONTRACT = ai_structured_v3`
- `CURRENT_STRUCTURE_VERSION = geo_metric_input_v3`
- `CURRENT_METRIC_SEMANTICS = contextual_competitor_mentions_sov_v1`
- `LEGACY_METRIC_SEMANTICS = configured_competitor_sov_v1`

分析模型或提示词措辞升级不改变 `CURRENT_METRIC_SEMANTICS`；只有 SOV 定义或公式变化时才增加指标语义版本。

### 4.2 功能需求

- REQ-001：分析模型必须同时获得当前问题和完整原回答。
- REQ-002：模型必须抽取回答中的全部 `brand/company` 实体及可在原文定位的短名称。
- REQ-003：每个非目标实体必须恰好存在一条竞品二选一判断和非空简短理由。
- REQ-004：人工配置竞品只作为名称、别名和业务背景提示，不能直接决定判断结果。
- REQ-005：程序必须根据完整原文扫描实体短名称并计算独立提及次数。
- REQ-006：新单条 SOV 必须等于目标品牌提及次数除以目标品牌与当前回答竞品提及次数之和。
- REQ-007：聚合 SOV 必须等于各条可计算回答 SOV 的算术平均。
- REQ-008：分母为零时 SOV 为 `N/A`，不得存为或显示为 `0%`。
- REQ-009：分析失败回答不进入任何品牌表现指标，只进入分析覆盖率。
- REQ-010：单条结果必须可查看竞品、非竞品、提及次数和 AI 判断理由。
- REQ-011：项目看板和项目报告默认合并全部平台，并支持单平台查看。
- REQ-012：项目级查询按时间范围读取实际历史记录，当前平台配置只约束未来采集。
- REQ-013：历史旧 SOV 保持原值和原标签，不参与新口径聚合。
- REQ-014：新问题/问题集运行、自动监测和 analysis-only 重试统一使用新契约，不保留旧运行时回退。
- REQ-015：比例指标展示分子和分母；平均指标展示参与计算的有效回答数。
- REQ-016：项目级趋势说明必须要求使用稳定的非品牌词问题集合；问题集合发生实质增删后，从变更日建立新的人工比较基线。

### 4.3 约束

- CON-001：AI 输出属于不可信外部输入，必须在服务边界完成结构、枚举、长度、实体引用和原文定位校验。
- CON-002：完整原回答不得在应用层静默截断。
- CON-003：输入超限、输出截断或结构校验失败时整条分析失败，不生成部分指标。
- CON-004：分析平台调用不得放在数据库事务内。
- CON-005：SQLite 和 Postgres 必须满足相同数据不变量。
- CON-006：人工准确率目标只用于离线评审报告，不进入生产运行判断。
- CON-007：历史值不重算；迁移只增加语义元数据和新字段。
- CON-008：新旧指标不能共用一个无版本语义的值字段。
- CON-009：运行日志不得输出完整问题、完整回答、模型原始输出、密钥或认证信息。
- CON-010：系统不自动识别品牌词问题，也不实现问题集版本管理；问题配置和比较基线由运营侧负责。

### 4.4 沿用模式

- PAT-001：HTTP 外层继续使用 `{ success, message?, data? }`。
- PAT-002：错误使用稳定 `error_code`，页面只显示脱敏中文信息。
- PAT-003：问题集 CSV 保持 `question_set_run_v1` 可读，通过尾部可选列扩展，不改写旧列含义。
- PAT-004：历史报告根据指标语义版本选择旧或新展示器，不在读取时猜测并重算。
- PAT-005：新终态继续在短事务内原子提交原回答、指标和记录状态，并沿用 execution token fencing。
- PAT-006：API 字段继续沿用项目现有 snake_case；新增版本化对象，不为本需求进行全局命名风格迁移。

## 5. 接口与数据契约

### 5.1 `ai_structured_v3` 输入

内部调用输入：

```json
{
  "question": "当前监测问题全文",
  "responseText": "监测平台返回的完整原回答",
  "brand": {
    "name": "目标品牌",
    "aliases": ["目标品牌别名"],
    "industry": "项目行业",
    "primary_keywords": ["核心业务关键词"]
  },
  "competitorHints": [
    {
      "name": "人工配置竞品",
      "aliases": ["竞品别名"]
    }
  ]
}
```

规则：

- `question` 和 `responseText` 都不能为空。
- `responseText` 必须原样进入提示词，不允许 `slice()`、字符上限截断或摘要替代。
- `competitorHints` 只作为已知名称和业务提示；提示词必须明确“已配置不等于本回答竞品，未配置也可以是竞品”。
- `brand.industry`、`brand.primary_keywords` 和问题共同提供“满足相同需求、可作为替代选择”的判断语境。
- 正式分析请求不发送 `max_tokens` 或 `max_output_tokens`，不设置应用层输入或输出 Token 上限；提供商拒绝完整上下文时整条失败。
- 当前正式分析配置为 `deepseek/deepseek-v4-pro`，固定 `temperature=0`、`response_format=json_object`、`thinking=disabled`、关闭联网，最多尝试两次。
- 首次结构校验失败时，第二次提示必须携带具体校验错误和上次完整无效输出，只修正结构，不改变语义判断；请求失败仍按稳定错误码处理。
- 设置中心的“AI 分析 API”页签通过后端生成的 `request_parameters` 展示实际脱敏请求体和运行策略，不展示密钥或完整运行时正文。

### 5.2 `ai_structured_v3` 输出

保留现有 `entities`、`mentions`、`target_entity_name`、`candidate_lists`、`recommendations`、`claims` 和 `sentiment`，删除运行时 `competitor_matches`，新增：

```json
{
  "competitor_relations": [
    {
      "entity_name": "必须精确引用 entities.name",
      "relation": "competitor",
      "reason": "为什么该实体在当前问题和回答场景中可替代目标品牌"
    },
    {
      "entity_name": "必须精确引用 entities.name",
      "relation": "non_competitor",
      "reason": "为什么该实体不是当前场景替代选择"
    }
  ]
}
```

校验不变量：

- `relation` 只允许 `competitor`、`non_competitor`。
- `reason` 去除多余空白后长度为 1–160 字符。
- 每个已提及的非目标实体必须恰好出现一次。
- 目标实体不得出现在 `competitor_relations`。
- `target_entity_name=null` 时，所有实体都属于非目标实体并必须覆盖。
- 关系引用的实体必须真实存在且具有可在原回答定位的 mention。
- 缺项、重复、非法枚举、空理由或无效实体引用使整条分析失败。

结构化输出保存：

- `analysis_method = ai_structured_v3`
- `analysis_structure.schema_version = geo_metric_input_v3`
- `analysis_structure.competitor_relations` 保留模型原始规范化判断。
- 生产数据库不保存未校验的模型原始输出。

### 5.3 程序计算契约

实体计数沿用“短名称扫描 + 重叠消解”：

1. 只扫描通过校验且确实出现在完整原回答中的短名称。
2. 同一位置重叠名称选择最长匹配。
3. 同一实体在同一位置的相邻全称与括号、斜杠别名合并为一次。
4. 后文再次独立出现时再次计数。
5. 不计算代词或模型推断出的隐含指代。

规范化计算结果：

```json
{
  "metric_semantics_version": "contextual_competitor_mentions_sov_v1",
  "brand_mentioned": true,
  "brand_mentions": 2,
  "brand_recommended": true,
  "brand_rank": 1,
  "answer_competitor_share": 50,
  "sov_numerator": 2,
  "sov_denominator": 4,
  "competition_entities": [
    {
      "name": "竞品甲",
      "relation": "competitor",
      "reason": "与目标品牌满足同一需求",
      "mentions": 2,
      "surface_forms": ["竞品甲"]
    },
    {
      "name": "客户乙",
      "relation": "non_competitor",
      "reason": "回答中是采购方，不是替代方案",
      "mentions": 1,
      "surface_forms": ["客户乙"]
    }
  ]
}
```

边界：

- `sov_denominator > 0`：`answer_competitor_share = round(sov_numerator / sov_denominator × 100, 2)`。
- `sov_denominator = 0`：`answer_competitor_share = null`，页面显示 `N/A`。
- 只有目标品牌：`100%`。
- 没有目标品牌但存在竞品：`0%`。
- 非竞品提及次数不进入分母。
- AI 不返回上述次数或占比。

### 5.4 聚合契约

品牌指标有效回答为具有 `CURRENT_METRIC_SEMANTICS` 指标记录的回答。

```text
品牌提及率
= brand_mentioned=true 的有效回答数
÷ 有效回答数

平均回答内竞品提及占比
= answer_competitor_share 非 null 的单条值之和
÷ answer_competitor_share 非 null 的回答数

推荐率
= brand_recommended=true 的有效回答数
÷ 有效回答数

分析覆盖率
= 成功生成 CURRENT_METRIC_SEMANTICS 指标的回答数
÷ 已成功保存完整原回答且属于 CURRENT_METRIC_SEMANTICS 的回答数
```

聚合输出至少包含：

```json
{
  "metric_semantics_version": "contextual_competitor_mentions_sov_v1",
  "valid_answers": 10,
  "acquired_answers": 12,
  "analysis_coverage_rate": 83.33,
  "brand_mentioned_answers": 8,
  "brand_mention_rate": 80,
  "sov_calculable_answers": 9,
  "avg_answer_competitor_share": 42.5,
  "recommended_answers": 3,
  "recommendation_rate": 30,
  "ranked_answers": 7,
  "avg_brand_rank": 2.3
}
```

规则：

- `sov_calculable_answers=0` 时 `avg_answer_competitor_share=null`，不得返回 `0`。
- 无有效排名时 `avg_brand_rank=null`。
- 没有数据的趋势日期使用 `null`，前端不得绘制成零值。
- 全部、平台、分类、问题和日期聚合复用同一个 reducer，不能维护多套公式。

### 5.5 数据模型

#### `visibility_metrics`

新增：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `metric_semantics_version` | STRING(50) | 非空；存量为旧版本，新记录必须显式写当前版本 |
| `answer_competitor_share` | FLOAT NULL | 新单条 SOV；分母为零时 null |
| `sov_numerator` | INTEGER NULL | 新 SOV 目标品牌提及次数 |
| `sov_denominator` | INTEGER NULL | 新 SOV 目标品牌与竞品提及次数之和 |
| `competition_entities` | JSON | 新回答中全部非目标企业实体的关系、理由和计数 |

现有字段：

- `share_of_voice` 只保留历史 `configured_competitor_sov_v1` 原值；列改为可空并移除默认值。新记录必须写 `null`。
- `competitor_mentions` 只保留历史配置竞品结果；新记录写空数组，正式聚合不得读取。
- `visibility_score` 暂保留物理字段以读取历史数据；新记录等于 `brand_mentions`，用户界面、导出、告警和洞察统一称为“品牌提及次数”。
- `analysis_method` 继续保存实际分析契约。

新增索引：

- `(project_id, metric_semantics_version, created_at, platform)`

#### `question_records`

新增：

- `analysis_contract_version STRING(40) NULL`
- `metric_semantics_version STRING(50) NULL`
- 索引 `(project_id, metric_semantics_version, created_at, platform)`

所有参与项目 GEO 指标的任务在创建时必须显式固化两个版本；即使分析失败，项目级查询仍能判断该回答属于哪套分析口径。不参与项目指标的普通检测记录保持 null，不伪造指标版本。

#### `question_set_runs`

新增：

- `metric_semantics_version STRING(50) NULL`

新 native run 固化当前值；历史或 imported run 保持自身版本。已有 `analysis_contract_version` 继续使用。

#### `report_snapshots`

新增：

- `metric_semantics_version STRING(50) NULL`

新快照显式写当前版本。旧快照 JSON 不改写，读取时按旧版本展示。

### 5.6 数据迁移

新增幂等迁移服务与 CLI：

- `backend/services/GeoMetricSemanticsMigrationService.js`
- `backend/scripts/migrateGeoMetricSemantics.js`
- `npm run audit:geo-metric-semantics`
- `npm run migrate:geo-metric-semantics`

迁移顺序：

1. 输出只读审计：各表行数、现有 `analysis_method` 分布、旧 SOV 非空数量和基础校验摘要。
2. 备份生产数据库；SQLite 额外执行 `PRAGMA quick_check`。
3. 添加新列和索引。
4. 所有迁移前已有 `VisibilityMetric` 标记为 `configured_competitor_sov_v1`，旧值不变。
5. 迁移前已有且 `project_id` 非空的 `QuestionRecord`、`QuestionSetRun` 和 `ReportSnapshot` 标记为旧指标语义；分析契约优先沿用已存值，没有证据时使用 `legacy_unknown`。非项目记录保持 null。
6. 将 `visibility_metrics.share_of_voice` 调整为可空，但不修改任何已有数值。
7. 校验迁移前后旧 SOV 的记录 ID、数量和值摘要一致。
8. 启动新版本后，所有新任务必须显式写当前版本，不依赖数据库默认值。

迁移不做：

- 不生成新 SOV。
- 不把旧配置竞品解释为 AI 识别竞品。
- 不修改旧报告快照 JSON。
- 不伪造失败记录的分析结果。

### 5.7 单条与问题集报告 API

报告统一增加版本化 `sov` 对象，由 `metric_semantics_version` 形成判别联合：

```json
{
  "sov": {
    "metric_semantics_version": "contextual_competitor_mentions_sov_v1",
    "kind": "contextual_competitor_mentions",
    "status": "calculated",
    "value": 50,
    "numerator": 2,
    "denominator": 4
  }
}
```

可选值：

- `kind = legacy_configured_competitors | contextual_competitor_mentions`
- `status = calculated | not_applicable`
- `status=not_applicable` 时 `value=null`，新口径 numerator、denominator 均为 0。
- 历史旧记录无法可靠恢复分子、分母时返回 null，不进行猜测。
- 历史旧记录只要原 `share_of_voice` 有值，就返回 `status=calculated` 和原值；`numerator`、`denominator` 均为 null，不把旧值反推成提及次数。

聚合统一增加：

```json
{
  "sov_summary": {
    "metric_semantics_version": "contextual_competitor_mentions_sov_v1",
    "average": 42.5,
    "calculable_answers": 9
  }
}
```

兼容规则：

- 旧报告继续保留原 `share_of_voice` 和 `avg_share_of_voice`，同时由历史读取适配器增加统一 `sov` / `sov_summary`；页面展示“历史竞品配置口径”。
- 新报告返回：
  - `answer_competitor_share`
  - `sov_numerator`
  - `sov_denominator`
  - `competition_entities`
  - 聚合 `avg_answer_competitor_share`
  - `sov_calculable_answers`
  - 分析覆盖率分子、分母

新报告不返回无版本语义的 `share_of_voice` 或 `avg_share_of_voice`。正式前端只消费 `sov` / `sov_summary`，不根据字段是否存在推断版本。

单条明细显示：

- 目标品牌提及次数。
- SOV 分子、分母和值或 `N/A`。
- 每个非目标企业实体的竞品/非竞品判断、提及次数和理由。
- 分析平台、模型、契约版本。

问题/问题集报告继续只读取本次 `question_set_run_id`，不引入项目级比较基线和平台历史过滤。

### 5.8 项目看板 API

接口保持：

`GET /api/geo-projects/:projectId/dashboard`

Query：

- `days=1..365`
- `platform=all|<platform-code>`，默认 `all`

行为：

- 查询条件使用 `project_id + metric_semantics_version + created_at`。
- 不使用项目当前 `platforms` 排除历史记录。
- `platform=<code>` 只筛选实际历史平台，不改变指标公式。
- 非法平台代码返回 400 `INVALID_PLATFORM_FILTER`。
- 合法但周期内无数据的平台返回空结果和 `N/A`，不返回伪零值。

输出增加：

```json
{
  "metric_semantics_version": "contextual_competitor_mentions_sov_v1",
  "selected_platform": "all",
  "available_platforms": ["deepseek", "doubao"],
  "summary": {
    "sov_summary": {}
  },
  "trend": []
}
```

`available_platforms` 来自所选周期实际记录，不来自项目当前配置。

### 5.9 项目报告快照

新快照默认生成全部平台结果，并在同一批已查询数据上一次构建：

```json
{
  "metric_semantics_version": "contextual_competitor_mentions_sov_v1",
  "metric_views": {
    "all": {
      "summary": {},
      "trend": []
    },
    "platforms": [
      {
        "platform": "deepseek",
        "summary": {},
        "trend": []
      }
    ]
  }
}
```

规则：

- 页面默认使用 `all`。
- 切换平台只选择快照中已固化的视图，不重新查询并改写快照。
- 来源、机会和其他全项目证据默认保持全部平台口径；平台选择器必须明确作用于核心品牌指标和趋势。
- `reports/latest` 继续按周期返回最新快照，不跨快照聚合；返回旧快照时页面按旧口径展示，生成新快照后自然返回新口径。
- 每个平台视图在一次内存分组中生成，不能为每个平台重复执行数据库查询。

### 5.10 CSV

保持 `question_set_run_v1` 和现有旧列含义。追加尾部可选列：

- `metric_semantics_version`
- `answer_competitor_share`
- `sov_numerator`
- `sov_denominator`
- `competition_entities_json`

规则：

- 旧文件缺少新列时按旧口径导入。
- 新口径行必须填写当前 `metric_semantics_version`。
- 新口径行的旧 `share_of_voice` 单元格必须为空。
- `has_metrics=true` 的新口径行中，`answer_competitor_share` 允许 0–100 或空；空时 numerator 和 denominator 必须同时为 0。失败行的指标单元格保持为空。
- numerator、denominator 为非负整数，且 numerator 不得大于 denominator。
- `competition_entities_json` 必须通过对象数组、关系枚举、理由长度和计数校验。
- 同一文件不得混合不同指标语义版本。
- imported 报告继续只读，不进入项目级指标聚合。

### 5.11 状态与错误

新增或明确稳定错误码：

| 错误码 | 阶段 | 行为 |
| --- | --- | --- |
| `analysis_context_missing` | 分析校验前 | 问题或原回答缺失，分析失败 |
| `analysis_input_too_long` | 分析请求 | 提供商拒绝完整输入，不重试为截断输入 |
| `analysis_output_truncated` | 分析完成 | 输出因长度限制不完整，整条失败 |
| `invalid_analysis_output` | 结构校验 | JSON、枚举、覆盖或实体引用不合法 |
| `analysis_relation_incomplete` | 结构校验 | 非目标实体关系未完整覆盖 |
| `analysis_relation_reason_invalid` | 结构校验 | 理由为空或超长 |
| `metric_semantics_mismatch` | 持久化/读取 | 记录、运行或指标版本不一致 |

`AIPlatformRequestService` 只依据受控提供商错误码和有限错误模式，将上下文超限归一为 `input_too_long`；不得把原始提供商错误正文返回前端或写入日志。

分析输入过长：

- 保留完整 `ResultDetail.ai_response_original`。
- `QuestionRecord.status=failed`。
- `result_summary.failure.stage=analysis_request`。
- `result_summary.failure.error_code=analysis_input_too_long`。
- 不创建或更新 `VisibilityMetric`。
- analysis-only 重试仍使用完整原回答；不得自动分段或调用旧分析器。

## 6. 关键技术决策

- KTD-001：分析契约必须包含问题文本。
  - 竞品是“当前问题和回答场景中的替代关系”，只看回答无法稳定确定用户需求。
- KTD-002：新 SOV 使用独立 `answer_competitor_share` 字段。
  - 不让旧 `share_of_voice` 在不同记录中承载两种语义；历史读取也不需要重算。
- KTD-003：版本同时固化到任务、指标、运行和报告快照。
  - 分析失败没有 `VisibilityMetric`，只在指标表存版本无法正确计算分析覆盖率。
- KTD-004：所有企业实体仍只使用 `brand/company`，竞争关系作为回答级属性。
  - 满足当前需求，避免建设角色体系和永久竞品身份。
- KTD-005：新 SOV 的 `N/A` 使用数据库 null 和显式样本数。
  - 不能用零值代替不可计算，否则会污染平均值、趋势、告警和洞察。
- KTD-006：完整回答直接发送给分析平台。
  - 不维护应用字符或 Token 上限，不发送输出 Token 上限；提供商上下文超限时明确失败，首版不分段。
- KTD-007：项目级历史平台来自实际记录。
  - 当前项目平台配置是未来采集计划，不是历史查询条件。
- KTD-008：项目报告快照内固化全部和分平台视图。
  - 既保持报告不可变，也允许前端切换平台，不需要保存全部原始指标行。
- KTD-009：模型或提示词升级不自动改变指标语义版本。
  - 只有指标定义或公式改变才隔离趋势；分析平台、模型和契约仍用于审查。
- KTD-010：正式切换采用硬切。
  - 新任务只运行 `ai_structured_v3`；不保留 v2 fallback、隐藏开关或新失败时的旧 SOV。
- KTD-011：历史读取适配器不是旧运行实现。
  - 它只能把已存旧值包装为版本化只读响应，不能参与新任务、重算、聚合或失败回退。

### 6.1 旧实现退役清单

| 旧实现或契约 | 新实现 | 退役要求 |
| --- | --- | --- |
| `ai_structured_v2` 运行时提示词、解析和调用分支 | `ai_structured_v3` | 所有正式入口和重试入口改用 v3 后删除，不保留开关或 fallback |
| `competitor_matches` 与人工配置竞品计数 | `competitor_relations` 与当前回答语境判断 | 新契约测试、正式入口测试通过后删除运行时代码 |
| `responseText.slice(0, 12000)` | 完整原回答；超限明确失败 | v3 接入时直接删除，不保留截断重试 |
| 新记录写 `share_of_voice` | 新记录写 `answer_competitor_share` | 数据迁移完成后禁止任何新写入；旧列仅供历史读取 |
| 前端直接读取 `share_of_voice` / `avg_share_of_voice` | 版本化 `sov` / `sov_summary` | 所有正式消费者迁移后，旧 scalar 仅在旧报告兼容响应中存在 |
| “可见度得分”文案及依赖该名称的判断 | “品牌提及次数”与明确的竞品提及次数比较 | 页面、导出、告警、洞察和文档同时清理 |

退役完成的判据是：代码搜索只允许在迁移、历史读取适配器、旧 fixture 和明确标注的历史文档中出现旧符号；任何新任务、聚合、告警、洞察或重试路径出现旧实现引用，都视为切换未完成。

## 7. 实现切片

### U1. 指标语义字段与迁移

**目标：** 建立新旧指标的物理隔离和记录级版本事实源。

**依赖：** 无。

**涉及文件：**

- `backend/models/VisibilityMetric.js`
- `backend/models/QuestionRecord.js`
- `backend/models/QuestionSetRun.js`
- `backend/models/ReportSnapshot.js`
- `backend/app.js`
- `backend/services/GeoMetricSemanticsMigrationService.js`
- `backend/scripts/migrateGeoMetricSemantics.js`
- `backend/tests/GeoMetricSemanticsMigration.test.js`
- `backend/tests/AIPlatformRecordSchema.test.js`
- `backend/package.json`

**方案：**

- 添加 5.5 定义的字段和组合索引。
- 实现 audit/apply 两阶段幂等迁移。
- 存量数据统一标记为旧指标语义，只补元数据，不改旧值。
- 验证 SQLite 与 Postgres 分支都能保持旧 SOV。

**测试场景：**

- 全新数据库初始化。
- 已有旧指标数据库迁移。
- 重复执行迁移。
- 迁移中断后再次执行。
- 未知旧分析契约。
- SQLite 旧值和索引保留。
- Postgres 可空列与组合索引。

**验收方式：** 迁移前后旧记录数量和值一致，新列和索引存在，新记录可写当前版本和 null 旧字段。

### U2. `ai_structured_v3` 与确定性计算

**目标：** 让 AI 输出逐实体竞争关系，由程序使用完整回答计算新 SOV。

**依赖：** U1。

**涉及文件：**

- `backend/services/AIResponseAnalysisService.js`
- `backend/services/AIPlatformRequestService.js`
- `backend/tests/AIResponseAnalysisService.test.js`
- `backend/tests/AIPlatformRequestService.test.js`

**方案：**

- 增加 question 和目标品牌业务上下文。
- 移除 12,000 字符截断和 `competitor_matches`。
- 新增 `competitor_relations` 结构与完整覆盖校验。
- 将人工竞品改名为 `competitorHints`，只影响提示内容。
- 生成 `competition_entities`、SOV 分子、分母和可空结果。
- 上下文超限归一为稳定错误，不使用截断重试。

**测试场景：**

- 已配置竞品不是当前竞品。
- 未配置实体被识别为竞品。
- 客户、合作方、平台和机构为非竞品。
- 同一实体在不同问题中得到不同关系。
- 目标品牌缺失、仅目标品牌、仅竞品、两者都缺失。
- 相邻全称/别名去重及后文重复计数。
- 关系缺失、重复、非法枚举、空理由、无效引用。
- 超过 12,000 字符的尾部实体仍参与分析。
- 提供商输入超限与输出截断。

**验收方式：** 固定结构化输入重复计算得到相同结果，模型输出中没有次数或 SOV，所有失败路径均不生成部分指标。

### U3. 正式运行持久化与失败覆盖率

**目标：** 所有正式入口都固化新版本，分析失败只影响覆盖率。

**依赖：** U1、U2。

**涉及文件：**

- `backend/services/ProjectRunService.js`
- `backend/services/ProjectRecordFinalizationService.js`
- `backend/services/SchedulerService.js`
- `backend/routes/detection.js`
- `backend/routes/geoProjects.js`
- `backend/tests/ProjectRunService.test.js`
- `backend/tests/ProjectRecordFinalizationService.test.js`
- `backend/tests/QuestionRecordLeaseFencing.test.js`
- `backend/tests/QuestionSetRunStart.test.js`
- `backend/tests/QuestionSetRetryPersistence.test.js`

**方案：**

- 创建任务时写入分析契约和指标语义版本。
- `buildVisibilityMetricPayload()` 传入问题并写新字段。
- 新记录的旧 `share_of_voice=null`、`competitor_mentions=[]`。
- 终态事务校验 record、run 和 metric 版本一致。
- 分析失败保留原回答、版本和稳定错误码，不写指标。
- analysis-only 重试继续使用完整原回答和新契约。

**测试场景：**

- 单问题、问题集、自动监测成功。
- 分析请求失败、结构失败、输入过长。
- 失败后 analysis-only 重试。
- 迟到 worker 被 fencing 拒绝。
- run 与 record 版本不一致。

**验收方式：** 三个正式入口新生成记录均为当前版本；失败样本有原回答但没有指标；代码中不存在新任务调用 v2 的路径。

### U4. 聚合、历史平台与项目 API

**目标：** 正确聚合新指标，并让项目级页面查看全部或单平台历史。

**依赖：** U1、U3。

**涉及文件：**

- `backend/services/ProjectMetricsService.js`
- `backend/services/ReportSnapshotService.js`
- `backend/services/SourceAnalysisService.js`
- `backend/routes/geoProjects.js`
- `backend/tests/ProjectMetricsService.test.js`
- `backend/tests/ReportSnapshotService.test.js`
- `backend/tests/GeoProjectDashboardApi.test.js`

**方案：**

- 建立唯一的可空 SOV reducer，全部聚合层复用。
- 只聚合当前指标语义版本。
- 通过已保存完整原回答与指标记录计算分析覆盖率。
- 移除项目当前平台列表对历史指标和记录的过滤。
- dashboard 增加平台筛选和周期实际平台列表。
- report snapshot 一次生成全部及分平台核心指标视图。

**测试场景：**

- 单条 SOV 等权平均，而非汇总提及次数后计算。
- N/A、0%、100% 同时存在。
- 分析失败不进入指标。
- 移除当前平台后历史仍可见。
- 默认合并和单平台筛选。
- 周期内无数据的平台。
- 旧新版本同周期存在但不混合。
- 报告快照平台视图不可变。

**验收方式：** 项目 API 的数值、分母和平台范围与固定样本手算一致；查询条件不再依赖项目当前平台配置。

### U5. 问题/问题集报告与 CSV

**目标：** 新运行报告展示竞品判断证据，旧报告继续原样可读。

**依赖：** U1–U4。

**涉及文件：**

- `backend/services/QuestionSetRunService.js`
- `backend/services/QuestionSetRunCsvService.js`
- `backend/routes/geoProjects.js`
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/QuestionSetRunCsvValidation.test.js`
- `backend/tests/QuestionSetRunApi.test.js`
- `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
- `nextjs-frontend/src/utils/questionSetReportPage.test.cjs`
- `nextjs-frontend/src/utils/questionSetReportPdf.test.cjs`

**方案：**

- 根据 run 指标语义版本选择旧/新 summary 和 row serializer。
- 两种历史版本都输出统一 `sov` / `sov_summary` 判别联合；旧 scalar 只为旧报告兼容保留。
- 新报告展示新字段、有效回答数、覆盖率和竞争关系理由。
- CSV 追加新列并保持旧 v1 可导入。
- 新文件禁止把新 SOV 写入旧 `share_of_voice` 列。
- PDF 和页面对 `N/A`、长理由和多实体列表提供稳定布局。

**测试场景：**

- 历史 native、snapshot-only、imported 报告。
- 新报告 0%、100%、N/A。
- 新旧 CSV 往返。
- 混合版本 CSV、错误分子分母和非法关系。
- 多页 PDF 中实体理由换行。

**验收方式：** 新报告可逐条核对分母实体，旧报告数值和标签不变，CSV 往返不丢版本及证据。

### U6. 项目页面、告警与洞察语义切换

**目标：** 所有用户可见消费者使用新名称、样本信息和平台视图。

**依赖：** U4、U5。

**涉及文件：**

- `nextjs-frontend/src/app/geo/project-dashboard/page.tsx`
- `nextjs-frontend/src/app/geo/reports/page.tsx`
- `nextjs-frontend/src/app/geo/prompts/page.tsx`
- `nextjs-frontend/src/app/geo/alerts/page.tsx`
- `nextjs-frontend/src/utils/historyAnalysisDisplay.cjs`
- `nextjs-frontend/src/utils/reportCsv.cjs`
- `nextjs-frontend/src/utils/projectDashboardState.test.cjs`
- `nextjs-frontend/src/utils/reportPageState.test.cjs`
- `nextjs-frontend/src/utils/reportCsv.test.cjs`
- `nextjs-frontend/src/utils/historyAnalysisDisplay.test.mjs`
- `backend/services/AlertEvaluationService.js`
- `backend/services/OpportunityInsightService.js`
- `backend/tests/AlertEvaluationService.test.js`
- `backend/tests/OpportunityInsightService.test.js`

**方案：**

- 使用完整名称“回答内竞品提及占比（SOV）”。
- 比例展示分子/分母，平均展示“X 条有效回答”。
- 增加“全部平台 / 单个平台”选择器，默认全部。
- N/A 不转成零，不进入图表和告警数值比较。
- `visibility_score` 相关文案统一为“品牌提及次数”。
- `competitor_ahead` 内部类型可保留兼容，但展示和判断改为“竞品提及次数领先”，不再声称综合可见度得分。
- 机会洞察使用提及次数和新 SOV，不再比较所谓综合得分。

**测试场景：**

- 平台切换、空平台、N/A 和旧历史展示。
- 合并与单平台采用同一公式。
- 告警在 SOV N/A 时不把它当 0。
- 竞品领先文案和阈值单位为提及次数。
- CSV、页面和图表不存在旧“综合得分”说明。

**验收方式：** 用户无需技术文档即可看懂数值口径和样本数，项目页面可切换平台，所有旧误导文案被清理。

### U7. 离线人工基线

**目标：** 用人工审查量化新分析契约的误差，不改变生产运行。

**依赖：** U2。

**涉及文件：**

- `backend/scripts/geoBaselineSample.js`
- `backend/scripts/geoBaselineEvaluate.js`
- `work/geo-baseline-2026-07-28/LABELING.md`
- `work/geo-baseline-2026-07-28/BASELINE-REPORT.md`

**方案：**

- 缓存键升级到 `ai_structured_v3`，旧 v2 缓存不得冒充新结果。
- 40 条样本继续标注目标品牌提及、次数、推荐、排名和情绪。
- 10 条多实体样本增加完整实体清单、竞品/非竞品真值和错误纳入/排除统计。
- 报告输出分平台结果、混淆矩阵、Wilson 95% 区间和 SOV 影响。
- 约 10% 目标只写入离线报告结论，不影响生产代码或配置。

**测试场景：**

- 未完成标注拒绝正式报告。
- partial 模式只处理完整样本。
- 非法关系标注。
- 旧缓存版本不匹配。
- 分平台无样本。

**验收方式：** 人工报告能明确给出错误纳入、错误排除及对 SOV 的影响，且生产运行路径不读取报告结果。

### U8. 正式硬切、清理与入口级验收

**目标：** 让新实现成为唯一正式路径，并完成文档和证据闭环。

**依赖：** U1–U7。

**涉及文件：**

- `README.md`
- `CONTEXT.md`
- `docs/README.md`
- `docs/API.md`
- `backend/services/AIResponseAnalysisService.js`
- 所有仍引用旧 `share_of_voice`、`avg_share_of_voice`、`competitor_matches` 或“可见度得分”的生产消费者和测试

**方案：**

- 先完成数据库备份、迁移审计和可用分析平台检查。
- 前后端同一发布将新契约设为默认。
- 删除 v2 运行时分析、旧配置竞品 SOV 计算、静默截断和所有隐藏 fallback。
- 旧字段只允许历史读取适配器使用。
- 更新运行说明、API 和指标术语。
- 从真实单问题、问题集和自动监测入口采集并查看报告。

**测试场景：**

- 三个正式入口的新记录版本。
- 新分析失败不调用旧分析器。
- 项目看板、项目报告、问题报告、导出、告警和洞察。
- 代码搜索验证旧生产引用清理。
- 生产数据库迁移后重启。

**验收方式：** 入口级证据同时证明 `ai_structured_v3` 被调用、旧 SOV 未被调用、历史旧结果仍可读；未满足时需求目录不能改为 `closed`。

## 8. 验收标准

本方案必须逐项满足 PRD AC-001 至 AC-038，并增加以下技术门禁：

- AC-T01：新运行的分析输入包含完整问题和完整原回答，代码不存在 `responseText.slice(0, 12000)` 或等价静默截断。
- AC-T02：新分析输出完整覆盖每个非目标实体的二选一关系和理由。
- AC-T03：固定样本手算结果与程序的单条 SOV、分子和分母完全一致。
- AC-T04：聚合只平均 `answer_competitor_share != null` 的单条值，并返回可计算回答数。
- AC-T05：分析失败记录保存完整原回答、分析契约和指标语义版本，但不存在对应新指标。
- AC-T06：旧 `share_of_voice` 只在历史读取适配器和迁移代码中出现；新运行不写该值。
- AC-T07：项目级查询不再以项目当前 `platforms` 排除周期内历史记录。
- AC-T08：全部平台和单平台视图使用同一 reducer，平台筛选只改变回答集合。
- AC-T09：新旧指标在数据库、API、CSV、快照和页面均可明确区分且不混合。
- AC-T09A：正式前端只通过版本化 `sov` / `sov_summary` 消费指标，不通过字段缺失或数值猜测版本。
- AC-T10：SOV 的 N/A 在存储、API、页面、图表、CSV、告警和洞察中均不被转换为 0。
- AC-T11：单问题、问题集和自动监测真实入口生成的新记录均使用当前版本。
- AC-T12：旧配置竞品计算、v2 运行时分支和静默 fallback 已从正式路径删除。
- AC-T13：历史旧报告和旧快照保留原值、原标签和只读能力。
- AC-T14：40 条基线和 10 条多实体抽查只产生离线报告，不形成生产门禁代码。

## 9. 测试与验证计划

### 9.1 单元测试

- v3 提示词字段和输出结构。
- 竞争关系完整覆盖、枚举、理由和实体引用。
- 别名、重叠和提及次数。
- 单条 SOV 边界。
- 等权聚合与 N/A。
- 分析错误归一化。
- 版本一致性。
- 平台筛选和实际平台列表。
- CSV 新旧判别联合。
- 告警与洞察的 N/A 和提及次数语义。

### 9.2 集成测试

- 临时 SQLite 旧库迁移、重启和幂等执行。
- Postgres 字段、索引和旧值保留。
- 单问题、问题集、自动监测及 analysis-only 重试。
- ResultDetail、VisibilityMetric 和 QuestionRecord 原子终态。
- 新旧记录同时存在时的项目 API 和报告快照。
- 问题集 CSV 导出、导入和只读恢复。

### 9.3 手工验证

- 单条详情核对目标品牌、竞品、非竞品、理由和提及次数。
- 项目看板默认全部平台，切换到每个实际历史平台。
- 从项目配置移除平台后，旧周期数据仍可见。
- 长回答尾部实体参与分析；超出模型上下文时页面显示明确失败。
- 旧问题集报告和旧项目报告显示旧口径。
- 新报告的 N/A、0%、100% 和有效回答数。

### 9.4 入口级证据

- 真实单问题运行记录及报告截图。
- 真实问题集运行记录、CSV 和 PDF。
- 自动监测产生的新版本记录。
- 数据库版本字段与新旧值字段查询结果。
- 分析失败样本的原回答保留和无指标证明。
- 代码搜索证明正式路径没有 `ai_structured_v2`、`competitor_matches`、旧 SOV 计算和 12,000 字符截断。
- 后端测试、前端测试、lint、build 和 `/api/ready` 结果。

## 10. 可观测性

新增结构化日志或计数：

- `geo_analysis_completed`
- `geo_analysis_input_too_long`
- `geo_analysis_output_truncated`
- `geo_analysis_relation_invalid`
- `geo_metric_semantics_mismatch`
- `geo_sov_not_applicable`
- `geo_dashboard_platform_filter`
- `geo_legacy_metric_excluded`

日志只包含内部记录 ID、项目 ID、平台代码、分析契约、指标语义版本、阶段和错误码；不得包含完整问题、完整回答、原始模型输出或敏感配置。

项目页面和报告展示：

- 已采集回答数。
- 有效分析回答数。
- 分析覆盖率。
- SOV 可计算回答数。
- 当前指标语义版本对应的用户可读名称。

## 11. Rollout 与回滚

### 11.1 Rollout

1. 完成人工确认的数据库备份。
2. 执行只读迁移审计并处理未知或不一致记录。
3. 在隔离副本执行迁移和新旧值核对。
4. 生产执行幂等迁移并完成 postflight。
5. 确认至少一个分析平台可用且能接受 v3 JSON 请求。
6. 同一发布部署后端、前端和文档。
7. 将 v3 和新指标语义设为所有正式入口唯一默认。
8. 完成真实单问题、问题集和自动监测验收。
9. 检查项目看板、项目报告、历史报告、导出、告警和洞察。
10. 删除旧运行时实现和误导文档后，才允许把需求目录改为 `closed`。

### 11.2 回滚

- 新字段和索引可保留，不执行破坏性逆迁移。
- 在尚未接受新流量前，可以整体回滚发布产物。
- 一旦已经产生新版本记录，不得通过重新启用 v2 或旧 SOV 作为静默止血方案。
- 发生问题时默认暂停新的项目运行并修复新实现；历史读取继续可用。
- 确需版本回滚时，必须明确记录当前正式路径、受影响记录、再次切回 v3 的条件，并禁止旧代码把新记录当作旧 SOV。
- 数据库备份只用于灾难恢复，不覆盖迁移后产生的新业务数据。

## 12. 风险与缓解

- 风险：AI 将客户、合作方、平台或机构错误识别为竞品。
  - 缓解：完整问题语境、逐实体理由、严格结构校验、单条可审查证据和离线人工评估。
- 风险：AI 漏抽取实体导致分母偏小。
  - 缓解：要求完整实体清单；10 条多实体样本单独测漏抽取和错误排除。
- 风险：长回答超过分析模型上下文。
  - 缓解：不截断；明确失败并保留原回答；通过覆盖率暴露，不伪造部分指标。
- 风险：旧新字段被误用或混合。
  - 缓解：独立值字段、记录级版本、查询强制过滤、判别联合 API 和代码搜索门禁。
- 风险：分析失败没有指标，导致覆盖率分母无法归属版本。
  - 缓解：任务创建时就在 `QuestionRecord` 固化分析契约和指标语义版本。
- 风险：移除当前平台过滤后查询数据量上升。
  - 缓解：周期最大 365 天、组合索引、单次查询后内存分组；用真实数据量验证查询时间。
- 风险：项目报告保存分平台视图增加快照体积。
  - 缓解：只保存聚合 summary 和 trend，不复制原始回答或指标行。
- 风险：SQLite 改变旧列可空属性触发表重建。
  - 缓解：显式迁移服务、生产备份、隔离副本演练、quick_check 和旧值 postflight。
- 风险：旧告警或洞察继续读取缺省零值。
  - 缓解：N/A 契约贯穿聚合、API 和消费者；增加源码搜索与行为测试。

## 13. 假设与开放问题

### 13.1 已确认假设

- 每个项目只有一个目标品牌，名称和别名来自项目配置。
- 竞品关系按单条问题和回答判断，不形成永久身份。
- 人工竞品配置只作提示。
- 项目级页面默认合并平台，也允许单平台查看。
- 平台配置只影响未来采集。
- 问题/问题集报告只描述本次运行。
- 模型或提示词升级不自动切换指标语义版本。
- SOV 监测问题由运营侧保证不直接包含目标品牌名称或别名。

### 13.2 开放问题

无阻塞开放问题。后续若修改 SOV 定义、公式或问题集比较规则，应先更新 PRD，再增加新的指标语义版本。

## 14. 后续衔接

- 可使用 `$to-issues` 按 U1–U8 拆分为可独立验收的 issue。
- 建议第一个 issue：U1“指标语义字段与迁移”。
- U1–U6 适合使用 TDD；U7 需要人工标注参与；U8 必须包含真实入口和数据库证据，不能只依赖单元测试。
- Plan 阶段完成后，目录仍保持 `draft-2026-07-28-001-geo-entity-share-metrics`；开始实现时再改为 `active-...`。

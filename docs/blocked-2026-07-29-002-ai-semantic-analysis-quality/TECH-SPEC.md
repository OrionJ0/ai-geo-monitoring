---
title: AI 语义实体分析质量优化技术方案
date: 2026-07-29
status: blocked
source: docs/blocked-2026-07-29-002-ai-semantic-analysis-quality/prd.md
scope: deep
---

# AI 语义实体分析质量优化技术方案

## 1. 背景与目标

方案编写时的正式分析链路使用 `ai_structured_v3` / `geo_metric_input_v3`，由 `AIResponseAnalysisService` 在一次 DeepSeek Pro 请求中提取实体、别名、竞品关系、候选清单、推荐、主张和情绪，再由程序计算目标品牌提及次数、品牌排名和回答内竞品提及占比（SOV）。该描述是实施前基线，不是当前运行入口。

2026-07-29 的 40+10 人工基线表明：

- 40 条分析全部成功，目标品牌提及判断准确率为 100%。
- 8 条有排名样本只识别正确 2 条，漏掉 6 条，没有虚假排名和错误名次。
- 20 条目标品牌已提及样本的情绪一致率为 80%，错误均为正面判断成中性。
- 10 条多实体样本中，错误纳入 4 个、错误排除 8 个、漏抽 22 个、多抽 5 个。
- SOV 数值仍较稳定，10 条平均绝对误差为 0.51 个百分点，聚合偏差为 -0.06 个百分点。

本方案将正式分析升级为 `ai_structured_v4` / `geo_metric_input_v4`。模型仍在一次请求中完成任务，但提示词按“完整抽取 → 竞争关系 → 候选顺序 → 目标情绪 → 输出前自检”组织；关键语义结论增加可定位原文证据。生产分析不再接收人工竞品提示。

SOV 公式、回答级等权聚合和失败隔离规则均不变化，因此 `metric_semantics_version` 继续使用 `contextual_competitor_mentions_sov_v1`。

## 2. 范围与非目标

### 2.1 范围

- 新增并硬切到 `ai_structured_v4` 分析契约。
- 新增 `geo_metric_input_v4` 结构版本。
- 提示词改为语义分阶段任务，不使用企业名单和关键词规则。
- 实体类型增加 `other_organization`。
- 竞争关系、候选清单和目标品牌情绪增加原文证据。
- 正式分析输入删除 `competitorHints`。
- 保持原文表面词的确定性提及计数和现有 SOV 公式。
- 更新持久化透传、问题集报告、CSV 往返、设置页提示词预览和版本展示。
- 使用 40+10 基线、补充情绪边界集和真实入口验证新版本。
- 保留历史 v3 结果，所有新分析和 analysis-only 重试统一走 v4。

### 2.2 非目标

- 不建设企业知识库、品牌白名单或竞品词典。
- 不使用情绪关键词、排名正则或 Markdown 编号解析器。
- 不把实体输出顺序解释为品牌排名。
- 不修改 SOV 公式或聚合方式。
- 不让 AI 输出提及次数、SOV、比例、最终排名数字或指标分数。
- 不引入第二次语义复核、多模型投票或在线人工审核。
- 不批量重算历史 v1/v2/v3 记录。
- 不重构引用指标、采集平台或项目报告的其他功能。

### 2.3 延后事项

- 积累更多真实正面、中性、负面样本后，再评估是否需要第二次独立 AI 复核。
- 有可靠校准数据后，再评估置信信息是否具备展示价值。

## 3. 实施前系统认知

### 3.1 版本与指标语义

实施前，`backend/services/GeoMetricSemanticsService.js` 集中声明：

- `CURRENT_ANALYSIS_CONTRACT = ai_structured_v3`
- `CURRENT_STRUCTURE_VERSION = geo_metric_input_v3`
- `CURRENT_METRIC_SEMANTICS = contextual_competitor_mentions_sov_v1`

分析契约与结构版本控制新记录、运行快照、基线缓存和报告版本；指标语义版本控制 SOV 公式、历史隔离与聚合。此次只升级前两者。

### 3.2 分析服务

实施前，`backend/services/AIResponseAnalysisService.js` 负责：

1. 构建包含问题、目标品牌、品牌上下文、竞品提示和完整回答的提示词。
2. 调用设置页选定的分析平台和模型。
3. 使用 JSON mode；该阶段曾对 DeepSeek 开启高强度思考，2026-07-30 已改为默认关闭，管理员可在二次确认后显式修改分析请求参数。
4. 不设置应用层 Token 上限，超时为 120 秒，最多尝试 2 次。
5. 校验实体、原文表面词、目标映射、逐实体竞争关系、候选清单、推荐、主张和情绪。
6. 根据表面词在原回答中的实际出现位置生成非重叠提及记录。
7. 从首个包含目标品牌的有序候选清单计算品牌排名。
8. 根据目标品牌与竞品的实际提及次数计算单回答 SOV。

实施前主要限制：

- `entities.type` 只允许 `brand / company`。
- `competitorHints` 仍进入正式提示词。
- 四个 few-shot 示例的情绪均为 `neutral`。
- 候选清单只返回 `ordered / entries`，没有判断理由和原文证据。
- 竞争关系和情绪只有理由，没有可定位证据。
- 第二次校验重试要求“不改变语义判断”，当首轮漏实体或证据错误时不利于重新审阅完整回答。

### 3.3 正式入口与持久化

`backend/services/ProjectRunService.js` 是单问题、问题集、定时监测和 analysis-only 重试的共同指标生成链路：

- 读取完整问题和完整回答。
- 调用 `AIResponseAnalysisService.analyze`。
- 将分析结果写入 `VisibilityMetric`。
- 分析失败时保留原回答并将记录标为失败，不写部分指标。

`VisibilityMetric.analysis_structure` 和 `competition_entities` 已是 JSON 字段，可以保存新增证据而不增加数据库列。`QuestionRecord` 与 `QuestionSetRun` 已保存 `analysis_contract_version`。

### 3.4 报告与数据往返

`backend/services/QuestionSetRunService.js` 将分析结构、竞争实体、情绪、排名和版本透传到运行报告。

`nextjs-frontend/src/app/geo/question-set-reports/page.tsx` 当前展示：

- 分析方式和模型；
- 识别到的品牌/公司；
- 目标品牌映射；
- 竞品判断及理由；
- 候选顺序；
- 品牌主张。

前端目前只认识 v1/v2/v3，实体类型只显示品牌或公司，尚未展示 v4 证据。

`backend/services/QuestionSetRunCsvService.js` 已把 `analysis_structure` 和 `competition_entities` 作为 JSON 列导出/导入。v4 采用加法字段后可以沿用 `question_set_run_v1` 文件协议，但必须验证新增字段不会在往返中丢失。

### 3.5 设置与评测

- `GET /api/settings/analysis-api/prompt` 返回当前提示词、输出契约和真实请求参数。
- `POST /api/settings/analysis-api/test` 通过管理员输入从真实分析模型临时运行一次，不持久化。
- `backend/scripts/geoBaselineEvaluate.js` 使用分析契约、结构版本和提示词修订作为缓存键，并支持隔离实验目录。
- 现有人工基线位于 `work/geo-baseline-2026-07-28/`。

## 4. 需求、约束与规则

### 4.1 功能要求

- REQ-001：正式分析输入必须包含当前问题、完整回答、目标品牌及必要的目标品牌上下文。
- REQ-002：正式分析输入不得包含人工企业清单或竞品提示。
- REQ-003：AI 必须先抽取回答中的全部品牌、公司和其他具名组织，再判断竞争关系。
- REQ-004：每个实体必须映射至少一个可在完整原回答中定位的表面词。
- REQ-005：每个非目标实体必须恰好有一条 `competitor` 或 `non_competitor` 判断。
- REQ-006：竞争关系必须包含简短理由和至少一条可在原回答定位的证据。
- REQ-007：候选清单是否有序由 AI 根据完整语境判断；有序清单至少包含两个不同实体。
- REQ-008：候选清单必须包含理由和至少一条原文证据。
- REQ-009：目标品牌被提及时，情绪必须为正面、中性或负面，并包含理由和至少一条目标品牌相关证据。
- REQ-010：目标品牌未被提及时，不产生有效情绪样本；兼容存储中的中性占位不得进入情绪聚合。
- REQ-011：AI 不输出提及次数、SOV、比例或最终品牌排名数字。
- REQ-012：程序继续根据表面词在完整回答中的实际出现次数计算提及次数和 SOV。
- REQ-013：分析失败不写部分指标，也不进入 SOV、排名、推荐率和情绪指标。
- REQ-014：报告能够展示 v4 的实体类型、竞争证据、排序证据和情绪证据。
- REQ-015：历史 v3 结果保持原样；新记录和 analysis-only 重试统一使用 v4。

### 4.2 约束

- CON-001：默认分析平台和模型继续由设置中心决定，正式环境默认为 DeepSeek Pro。
- CON-002：单条回答每次尝试只执行一次完整语义分析，最多尝试 2 次；第二次仅用于首轮请求或结构校验失败后的完整重试，不额外增加独立复核模型。
- CON-003：不设置应用层 Token 上限，不对完整回答做字符截断或分段拼接。
- CON-004：所有语义判断由 AI 完成；程序规则只校验结构、引用和可定位性。
- CON-005：新字段优先存入现有 JSON 字段，避免无必要数据库迁移。
- CON-006：SOV 指标语义版本不变化，现有聚合和历史隔离不得回归。
- CON-007：正式硬切后不保留 v3 fallback、兼容开关或按失败条件回退。

### 4.3 需要沿用的模式

- PAT-001：版本常量集中由 `GeoMetricSemanticsService` 导出。
- PAT-002：第三方模型输出在 `AIResponseAnalysisService` 边界完成严格校验。
- PAT-003：语义失败抛出带错误码和有界诊断信息的 `AIResponseAnalysisError`。
- PAT-004：原回答始终由 `ResultDetail.ai_response_original` 保存，analysis-only 重试复用同一原文。
- PAT-005：历史分析结果只读，新旧版本通过记录字段显式区分。
- PAT-006：真实请求参数继续通过管理员设置页可见。

## 5. 接口与数据契约

### 5.1 版本

新版本常量：

```text
CURRENT_ANALYSIS_CONTRACT = ai_structured_v4
CURRENT_STRUCTURE_VERSION = geo_metric_input_v4
CURRENT_METRIC_SEMANTICS = contextual_competitor_mentions_sov_v1
PROMPT_REVISION = semantic_evidence_few_shot_v6
```

不新增指标语义版本，因为以下定义均不变化：

```text
单回答 SOV =
目标品牌实际提及次数
÷（目标品牌实际提及次数 + 当前回答真实竞品实际提及次数）

聚合 SOV = 所有可计算单回答 SOV 的算术平均
```

### 5.2 分析输入

v4 提示词运行时输入：

```json
{
  "question": "当前问题完整文本",
  "target_brand": "目标品牌名称",
  "target_aliases": ["目标品牌已知别名"],
  "target_industry": "可选行业背景",
  "target_keywords": ["可选业务关键词"],
  "answer": "待分析的完整 AI 回答"
}
```

变化：

- 删除 `competitor_hints`。
- 删除 `AIResponseAnalysisService.analyze`、`buildPrompt` 和正式调用方中的 `competitorHints` 参数。
- `ProjectRunService` 仍可读取项目竞品供引用来源归类使用，但不得传给结构化实体分析。
- 基线脚本也不得把人工竞品配置传给分析器。

### 5.3 分析输出

```json
{
  "entities": [
    {
      "name": "上海光拓",
      "type": "brand"
    },
    {
      "name": "某研究院",
      "type": "other_organization"
    }
  ],
  "mentions": [
    {
      "entity_name": "上海光拓",
      "surface_forms": ["上海光拓", "光拓"]
    }
  ],
  "target_entity_name": "上海光拓",
  "competitor_relations": [
    {
      "entity_name": "竞品甲",
      "relation": "competitor",
      "reason": "在当前问题中提供可替代方案",
      "evidence": ["竞品甲同样提供……"]
    }
  ],
  "candidate_lists": [
    {
      "ordered": true,
      "entries": ["上海光拓", "竞品甲"],
      "reason": "回答表达了明确先后关系",
      "evidence": ["综合推荐顺序为……"]
    }
  ],
  "recommendations": [
    {
      "entity_name": "上海光拓",
      "kind": "explicit"
    }
  ],
  "claims": [
    {
      "subject_name": "上海光拓",
      "predicate": "能力",
      "value": "回答声称的能力",
      "qualifier": ""
    }
  ],
  "sentiment": {
    "label": "positive",
    "reason": "回答给出了选择目标品牌的明确理由",
    "evidence": ["上海光拓更适合……"],
    "risk_terms": []
  }
}
```

### 5.4 字段语义

#### 实体

- `brand`：回答把该名称作为产品或服务品牌使用。
- `company`：回答把该名称作为商业公司或企业主体使用。
- `other_organization`：院校、研究团队、事业单位、客户单位等其他具名组织。
- 类型不决定竞争关系；任何实体是否进入 SOV，只看 AI 返回的当前场景竞争关系。
- `entities` 顺序只服务结构输出，不具有排名语义。

#### 原文表面词

- `mentions.surface_forms` 只包含回答中真实出现的实体短名称、全称或别名。
- 每个表面词必须能在完整回答中精确定位。
- 程序继续处理别名相邻表达和重叠匹配，生成非重叠提及。
- AI 不返回次数。

#### 竞争关系

- `competitor`：在当前问题表达的购买或选择场景中，可以被用户视为目标品牌替代选择。
- `non_competitor`：回答提及该实体，但它在当前场景中不是替代选择。
- `reason` 是简短语义说明。
- `evidence` 是一条或多条原回答原文片段，必须精确定位。
- 不允许通过实体类型或项目配置自动覆盖 AI 判断。

#### 候选清单和排名

- `candidate_lists` 记录回答中的同一候选集合。
- `ordered=true` 表示作者在语义上表达了相对先后；并不要求固定编号形式。
- `ordered=false` 表示只是同一集合中的并列、比较或无序罗列。
- `entries` 按回答表达的清单顺序引用 `entities.name`。
- `reason` 和 `evidence` 解释为什么该清单被判断为有序或无序。
- 品牌排名继续从回答顺序中的首个、包含目标品牌的 `ordered=true` 清单计算。
- 程序不得从实体顺序、文本编号或关键词另行推导排名。

#### 情绪

情绪只评价目标品牌：

- `positive`：回答整体上增加用户选择目标品牌的理由或意愿。
- `neutral`：回答主要陈述事实，或正反信息平衡，没有明显选择方向。
- `negative`：回答整体上降低用户选择目标品牌的理由或意愿。

目标品牌已提及时：

- `reason` 必须说明整体选择方向。
- `evidence` 至少包含一条目标品牌相关原文片段。

目标品牌未提及时：

- `target_entity_name = null`。
- `sentiment.label = neutral` 仅作为现有非空数据库字段的传输占位。
- `sentiment.reason` 明确为未提及目标品牌。
- `sentiment.evidence = []`。
- 所有聚合继续以 `brand_mentioned=true` 为情绪样本前提，不把该占位解释为真实中性。

### 5.5 证据校验

新增统一证据校验器：

- 输入必须为数组。
- 每项必须为非空字符串。
- 每项必须能在完整原回答中精确定位。
- 同一字段中的重复证据去重。
- 不使用证据内容推导语义，只验证模型结论有原文锚点。
- 不对完整回答或模型请求设置应用层 Token 限制。
- 可保留防御异常输出规模的结构安全上限；超限时整条重试或失败，不静默截断内容。

### 5.6 计算结果

`calculate` 输出保持现有指标字段：

- `brand_mentioned`
- `brand_mentions`
- `brand_position`
- `brand_rank`
- `brand_recommended`
- `answer_competitor_share`
- `sov_numerator`
- `sov_denominator`
- `sentiment`
- `sentiment_reason`
- `sentiment_risk_terms`

`competition_entities` 增加：

```json
{
  "name": "竞品甲",
  "relation": "competitor",
  "reason": "当前场景可替代",
  "evidence": ["原回答证据"],
  "mentions": 2,
  "surface_forms": ["竞品甲"]
}
```

完整的候选清单和情绪证据保存在 `analysis_structure`。

### 5.7 状态与错误

沿用现有失败语义：

- `analysis_context_missing`
- `analysis_input_too_long`
- `analysis_output_truncated`
- `analysis_relation_incomplete`
- `analysis_relation_reason_invalid`
- `invalid_analysis_output`
- 平台请求错误码

新增证据相关输出错误统一归入 `invalid_analysis_output`，错误信息指出具体字段。

首轮输出无效时，第二次提示不再要求冻结首轮语义判断，而是要求：

1. 重新通读原问题和完整回答；
2. 根据校验错误重新检查实体、关系和证据；
3. 输出一份完整 v4 JSON；
4. 不复用无法在原文定位的内容；
5. 不输出解释或 Markdown。

两次均失败后：

- 保存有界诊断，不保存原始模型输出到错误日志。
- 保留已取得的原回答。
- 不写 `VisibilityMetric`。
- 记录不进入指标。

### 5.8 兼容性

- `VisibilityMetric` 不新增字段，不执行数据回填。
- v3 记录的 `analysis_method`、`analysis_structure.schema_version` 和证据缺失状态保持不变。
- v4 证据属于 JSON 加法字段，旧报告读取器忽略时不会破坏基础字段。
- `QuestionSetRunService.STRUCTURED_ANALYSIS_METHODS` 增加 v4，保留 v1/v2/v3 的历史读取。
- 前端把 v4 标为当前版本，v1/v2/v3 标为历史版本。
- CSV 文件协议仍为 `question_set_run_v1`，但必须完整往返 v4 JSON。
- analysis-only 重试创建新记录并写 v4，不覆盖原 v3 记录。

## 6. 关键技术决策

### KTD-001：一次模型请求内做语义分阶段

模型在同一次请求中按完整抽取、关系判断、排序判断、情绪判断和自检完成任务。

理由：

- 用户明确要求首版不增加双请求成本。
- 当前 DeepSeek Pro 40 条结构化失败率已经为 0。
- 主要问题来自任务组织和示例偏置，不足以证明必须拆成两个 API 调用。

取舍：

- 单请求内部阶段不是可独立观测的两个模型步骤。
- 若后续基线仍有严重漏抽，再单独评估第二次复核，不在本需求中预埋隐藏分支。

### KTD-002：删除竞品提示，而不是降低其权重

v4 正式分析完全不接收 `competitorHints`。

理由：

- 只要名单进入提示词，模型就可能优先围绕名单完成实体和竞品判断。
- “配置不决定结论”的说明无法完全消除锚定偏差。
- 当前问题、完整回答和目标品牌业务背景已经足以进行场景判断。

取舍：

- 极短回答可能缺少足够上下文，模型需要依据问题与目标背景判断。
- 无法判断时仍必须做二选一，延续现有产品定义，不增加第三状态。

### KTD-003：证据锚定，不引入语义规则器

程序只验证证据是否来自原回答，不检查其中是否存在特定关键词。定位时允许忽略 Markdown 装饰符和空白差异，并把命中的真实原文片段写回结构；同一结论有多条候选证据时保留全部可定位项，至少一条可定位即可，全部不可定位才让该结论校验失败。

理由：

- 可降低模型凭空补充理由和不可审查结论。
- 不会把排名、情绪或竞品判断退化为关键词匹配。

### KTD-004：升级分析版本，保持指标语义版本

分析契约升级到 v4，SOV 指标语义继续 v1。

理由：

- 输出结构和提示词发生可观测变化，必须区分分析版本。
- SOV 数学定义、分母和聚合方式未变化，不应制造新的指标含义。

### KTD-005：使用现有 JSON 持久化

证据保存在 `analysis_structure` 和 `competition_entities`，不增加列。

理由：

- 当前 JSON 已经是完整结构化分析原料的正式存储位置。
- 避免无必要迁移和历史回填。
- CSV 已能往返 JSON。

### KTD-006：用多样化边界示例替换规则枚举

新提示词提供覆盖正面、中性、负面、目标缺失、长回答、多实体、有序和无序清单的示例。

示例表达概念边界，不枚举品牌、行业关键词和固定句式。输出前自检只要求模型重新检查完整性，不要求暴露推理链。

## 7. 实现切片

### U1. v4 语义契约与管理员测试入口

**目标：** 管理员设置页能够查看并用真实 DeepSeek Pro 临时运行 v4 提示词，输出包含完整实体、逐实体关系、候选顺序和情绪证据。

**依赖：** 无。

**涉及文件：**

- `backend/services/GeoMetricSemanticsService.js`
- `backend/services/AIResponseAnalysisService.js`
- `backend/routes/settings.js`
- `backend/tests/AIResponseAnalysisService.test.js`
- `backend/tests/AIAnalysisSettingsApi.test.js`
- `backend/tests/GeoRuntimeHardCut.test.js`
- `nextjs-frontend/src/app/admin/settings/AIAnalysisSettings.tsx`
- 相关前端设置页测试

**方案：**

- 切换分析契约和结构版本。
- 删除正式分析器的 `competitorHints` 输入。
- 加入 `other_organization` 和统一证据校验。
- 改写分阶段提示词、语义边界、few-shot 和输出前自检。
- 改写第二次校验重试提示。
- 设置页继续展示真实请求参数、提示词修订和输出结构。
- 管理员测试入口使用与正式运行相同的 v4 服务。

**测试场景：**

- 长回答包含品牌、公司、客户和研究机构。
- 未配置实体仍被判断为竞品。
- 同行业实体在当前问题中不是竞品。
- 明确先后关系与普通无序列表。
- 正面、中性、负面和目标未提及。
- 证据不在原回答、关系缺失、实体缺少提及、输出截断。
- 首轮无效、第二次重新审阅后成功。

**验收方式：** 设置页返回 v4 版本、无竞品提示运行字段、DeepSeek Pro 真实请求参数和包含证据的合法输出；源码和测试证明没有 v3 fallback 或程序语义规则。

### U2. 正式记录持久化与报告证据

**目标：** 正式问题运行保存 v4 分析结果，运行报告和 CSV 能完整展示与往返证据。

**依赖：** U1。

**涉及文件：**

- `backend/services/ProjectRunService.js`
- `backend/services/QuestionSetRunService.js`
- `backend/services/QuestionSetRunCsvService.js`
- `backend/tests/ProjectRunService.test.js`
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/QuestionSetRunCsvValidation.test.js`
- `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
- `nextjs-frontend/src/utils/questionSetReportPage.test.cjs`

**方案：**

- 正式分析调用不再传项目竞品。
- 引用来源归类继续使用项目竞品，两条职责保持分离。
- `competition_entities` 透传关系证据。
- `analysis_structure` 透传候选清单和情绪证据。
- 报告显示其他组织、竞争证据、排序证据和情绪证据。
- v4 显示为当前版本，v3 及更早版本显示为历史。
- CSV 导入导出验证新增 JSON 字段不丢失。

**测试场景：**

- 正式指标 payload 保存 v4 结构和证据。
- 项目竞品仍用于引用归类但没有进入 AI 分析输入。
- 历史 v3 报告可读且不伪造证据。
- v4 CSV 导出后重新导入，证据和版本完整。
- 目标未提及不进入情绪统计。

**验收方式：** 从一条正式记录的 API 和页面同时看到 v4 版本、其他组织、关系证据、排序证据和情绪证据；CSV 往返后结构不变。

### U3. 离线基线与提示词校准

**目标：** 用人工基线证明 v4 相对 v3 减少排名漏识别、竞品漏判和情绪中性偏置，且不降低 SOV 精度和结构化成功率。

**依赖：** U1。

**涉及文件：**

- `backend/scripts/geoBaselineEvaluate.js`
- `backend/tests/GeoBaselineScripts.test.js`
- `work/geo-baseline-2026-07-28/experiments/`
- 新增情绪边界评测工作目录

**方案：**

- 基线调用删除竞品提示。
- 缓存键自动使用 v4 契约、v4 结构和新提示词修订。
- 在隔离实验目录用 DeepSeek Pro 重跑 40+10。
- 增加覆盖正面、中性、负面和目标未提及的人工确认情绪边界集。
- 报告继续输出结构失败率、实体关系差异、排名、情绪和 SOV 影响。
- 根据失败样本优化概念说明和 few-shot，不加入企业、关键词或句式规则。

**测试场景：**

- v3 缓存不能冒充 v4。
- 无人工确认时正式报告拒绝生成。
- 新情绪集四种适用状态均被评测。
- 失败样本不进入指标。

**验收方式：** v4 基线报告给出与当前报告可直接比较的结果，并满足 PRD 的成功指标。

### U4. 全入口硬切与真实验收

**目标：** 单问题、问题集、定时监测和 analysis-only 重试均正式使用 v4，历史 v3 保持只读，文档不再把 v3 描述为当前路径。

**依赖：** U2、U3。

**涉及文件：**

- `backend/services/ProjectRunService.js`
- `backend/services/QuestionSetRunService.js`
- `backend/services/SchedulerService.js`
- 入口级相关测试
- `README.md`
- `CONTEXT.md`
- `docs/README.md`
- `docs/API.md`
- 本需求 PRD、Tech Spec 和 issues
- 原 GEO 指标需求中的当前版本说明

**方案：**

- 搜索全部正式入口和版本判断，确保新记录统一写 v4。
- 验证 analysis-only 重试不会复用旧分析结果。
- 验证没有 v3 默认值、fallback、隐藏开关或生产调用。
- 保留 v1/v2/v3 历史读取分支，只从当前运行建议中移除。
- 使用真实 DeepSeek Pro 从全部正式入口运行。
- 保存数据库记录、API 响应、页面和日志证据。

**测试场景：**

- 手动单问题。
- 问题集。
- 定时任务。
- 已有完整原回答的 analysis-only 重试。
- v3 历史报告。
- v4 分析失败。

**验收方式：** 入口级证据同时证明 v4 被调用、v3 未被调用、失败未污染指标、历史 v3 仍可读；未达到时需求目录不得改为 `closed`。

## 8. 验收标准

- AC-001：Given 一个未维护在任何项目竞品配置中的真实厂商，When 它在回答中满足当前购买需求，Then v4 可以抽取并判断为竞品。
- AC-002：Given 回答同时包含竞品、客户和研究机构，When v4 分析完成，Then 全部具名组织均有实体和原文表面词，且逐实体竞争关系完整。
- AC-003：Given 普通无序候选列表，When v4 分析完成，Then 不产生品牌排名。
- AC-004：Given 回答语义上表达候选先后，When v4 分析完成，Then 候选清单为有序并保存原文证据，品牌排名由该清单位置计算。
- AC-005：Given 目标品牌只有事实描述，When v4 判断情绪，Then 结果为中性并提供事实证据。
- AC-006：Given 回答明确增加或降低选择目标品牌的理由，When v4 判断情绪，Then 分别为正面或负面并提供对应证据。
- AC-007：Given 回答未提及目标品牌，When 生成报告，Then 该回答不进入情绪指标。
- AC-008：Given 模型证据无法在原回答定位，When 校验输出，Then 首次触发完整重试，两次失败后整条分析失败且不写部分指标。
- AC-009：Given v4 结构化分析成功，When 持久化并读取运行报告，Then 实体类型、关系证据、排序证据、情绪证据和版本完整一致。
- AC-010：Given v4 报告导出 CSV 后重新导入，When 查看导入报告，Then v4 JSON 字段不丢失。
- AC-011：Given v3 历史记录，When 查看报告，Then 原值和原结构保持不变，缺失证据不显示为零值或空证据结论。
- AC-012：Given 新单问题、问题集、定时监测或 analysis-only 重试，When 创建记录，Then `analysis_contract_version` 均为 `ai_structured_v4`。
- AC-013：Given v4 正式硬切完成，When 搜索生产调用链，Then 不存在 v3 默认值、fallback、竞品提示分析输入或程序情绪/排名规则。
- AC-014：Given 40+10 和补充情绪边界集，When 使用 DeepSeek Pro 评测，Then 满足 PRD 中的比较目标。

## 9. 测试与验证计划

### 9.1 单元测试

- v4 提示词不包含 `competitor_hints`、企业名单或程序规则暗示。
- 输出契约支持 `other_organization`。
- 关系、候选和情绪证据均可定位。
- Markdown 排版等价的证据能定位并还原为真实原文；混合证据只保留可定位项，全部无法定位时拒绝。
- 实体数组顺序不影响品牌排名。
- 无序清单不产生排名，有序清单按 `entries` 位置产生排名。
- SOV 仍按实际提及次数计算。
- 目标未提及不成为有效情绪样本。
- 第二次重试重新审阅完整回答。

### 9.2 服务与接口测试

- 设置页提示词接口返回 v4 版本、新修订和真实 DeepSeek 请求参数。
- 设置页临时测试使用正式 v4 服务且不持久化。
- ProjectRun payload 不向分析器传竞品列表。
- 正式结果持久化并透传新增证据。
- QuestionSetRunService 将 v4 视为结构化分析，同时兼容历史版本。
- CSV v4 JSON 往返无损。

### 9.3 前端测试

- v4、v3 历史标签正确。
- `other_organization` 显示为“其他组织”。
- 竞争、排序和情绪证据可读。
- 历史记录没有证据时不显示误导占位。
- 长证据和多实体列表不破坏页面与 PDF 布局。

### 9.4 离线评测

- 使用现有 40+10 人工确认基线。
- 使用补充情绪边界集。
- 保存独立实验目录，不覆盖 v3 基线。
- 对比结构失败率、实体召回、竞品关系、排名、情绪和 SOV。

### 9.5 真实入口验证

- 管理员临时测试入口。
- 单问题正式入口。
- 问题集正式入口。
- 定时监测入口。
- analysis-only 重试。
- 项目报告和问题集报告。
- CSV 导出/导入。

每条证据至少记录：

- 记录或运行 ID；
- 分析平台和模型；
- `analysis_contract_version`；
- `analysis_structure.schema_version`；
- `analysis_structure.prompt_revision`；
- 指标语义版本；
- 成功或失败状态；
- 页面或 API 可见的证据字段。

## 10. 发布、回滚与观测

### 10.1 发布

1. 在同一交付目标中完成 v4 服务、持久化、报告、基线和入口测试。
2. 将当前常量一次性切到 v4。
3. 新建记录统一写 v4。
4. 历史 v3 仅保留读取能力。
5. 更新当前运行文档，删除将 v3 描述为正式版本的文字。

### 10.2 回滚

默认直接修复 v4，不通过隐藏 fallback 恢复 v3。

如果真实入口出现阻断性故障，需要人工决定显式回滚时，必须记录：

- 触发原因；
- 影响的入口和记录；
- 当前数据库中已生成的 v4 结果；
- 回滚后正式版本；
- 再次切回 v4 的退出条件。

不得把 v3 静默保留为自动保险。

### 10.3 观测

继续使用现有分析诊断字段：

- 请求阶段；
- 尝试次数；
- 平台和模型；
- finish reason；
- 输入/输出 Token 使用量；
- 输出长度；
- 错误码。

报告和基线额外关注：

- 分析失败率；
- 关系不完整；
- 证据无法定位；
- 实体漏抽；
- 竞品漏判；
- 排名漏识别与虚假排名；
- 情绪混淆；
- SOV 数值误差。

不将模型原始输出或完整回答写入错误日志。

## 11. 风险与缓解

### 风险 1：增加证据字段后输出更长，结构失败率上升

缓解：

- 保持一次请求和 JSON mode。
- 证据只要求支持结论的必要原文片段。
- 不设置应用层 Token 上限。
- 第二次重试重新审阅完整回答并重建 JSON。
- 用 DeepSeek Pro 基线确认失败率不回归。

### 风险 2：删除竞品提示后，短回答中的竞品判断波动

缓解：

- 保留当前问题、目标行业和业务关键词。
- 用真实短回答和多实体样本覆盖。
- 只优化语义边界和示例，不重新引入名单。

### 风险 3：`other_organization` 增加后，模型把更多背景组织错误纳入竞品

缓解：

- 明确实体类型不等于竞争关系。
- few-shot 同时展示客户、承载平台、研究机构和真实替代供应方。
- 基线分别统计实体召回和竞品关系，避免用 SOV 数值掩盖关系错误。

### 风险 4：新旧分析版本混合后用户误解趋势

缓解：

- 新旧版本字段显式保存并展示。
- 历史 v3 保持原样。
- 报告允许按版本或平台拆分。
- 当前运行文档明确版本切换日期。

### 风险 5：提示词变成隐性规则器

缓解：

- 文档和测试禁止企业名单、情绪词典、排名正则和固定句式推导。
- 示例覆盖概念边界，不列举生产企业。
- 程序只验证证据来源，不根据证据内容推导结论。

## 12. 假设与开放问题

### 12.1 已确认假设

- DeepSeek Pro 继续作为默认分析模型。
- 首版保持单次语义请求。
- 院校、客户和研究机构保留为 `other_organization` 供审查。
- 是否进入 SOV 只由当前场景竞争关系决定。
- SOV 公式与聚合口径不变化。
- 历史结果不重算。

### 12.2 开放问题

当前实现没有代码阻塞，关闭需求前仍需用户确认：

- 是否接受 SOV MAE 从 0.51pp 改善至 0.34pp、但聚合偏差绝对值从 0.06pp 增至 0.11pp 的轻微波动。
- 是否确认 `work/geo-sentiment-baseline-2026-07-29/LABELING.md` 中 12 条 AI 预标为人工基线；确认前不得把 `human_review_confirmed` 改为 `yes`。

## 13. 后续衔接

- 适合拆为 4 个纵向 issue。
- 建议第一个 issue：v4 语义契约与管理员测试入口。
- 所有实现切片均适合使用 TDD。
- 完成全部 issue 和真实入口验收前，需求目录保持 `draft`；开始实现时改为 `active`，遇到外部阻塞时改为 `blocked`。

## 14. 当前实施与验证结果

- Issue 001、002 已完成并关闭；Issue 003 等待上述两项用户确认；Issue 004 的技术验收已完成，但必须等待 Issue 003 后才能关闭。
- 正式新分析路径为 `ai_structured_v4` / `geo_metric_input_v4`，提示词修订为 `semantic_evidence_few_shot_v6`；SOV 指标语义仍为 `contextual_competitor_mentions_sov_v1`。
- 单问题、问题集、定时监测和 analysis-only 重试均已硬切 v4；不存在 v3 默认值、失败 fallback 或竞品提示分析输入。v3 仅保留历史报告读取能力。
- 后端入口级相关测试 169/169、后端全量测试 879/879、前端工具测试 248/248 通过，Next.js 生产构建通过。
- 历史基线使用独立临时数据库的真实 HTTP 设置入口返回 v4、DeepSeek Pro、JSON mode、高强度思考、120 秒超时、最多 2 次尝试、关闭 Web 搜索和无应用层 Token 上限；当时真实 DeepSeek Pro 主基线 40/40、补充情绪边界集 12/12 分析成功。2026-07-30 后正式默认值改为关闭思考，历史基线结果不改写。

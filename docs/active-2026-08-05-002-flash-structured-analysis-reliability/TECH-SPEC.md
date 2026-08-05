---
title: DeepSeek Flash 分阶段结构化分析可靠性技术方案
date: 2026-08-05
status: active
source: docs/active-2026-08-05-002-flash-structured-analysis-reliability/prd.md、2026-08-05 真实 Flash 复现与资料调研
scope: deep
---

# DeepSeek Flash 分阶段结构化分析可靠性技术方案

## 1. 背景与目标

当前正式 GEO 指标链路使用 `ai_structured_v4` / `geo_metric_input_v4`。`backend/services/AIResponseAnalysisService.js` 在一次 DeepSeek 请求中要求模型同时完成开放实体抽取、实体归一、目标映射、逐实体竞品关系、候选集合与顺序、明确推荐、品牌主张、目标情绪和可定位证据，再由程序校验与计算指标。

2026-08-05 的真实复现证明，当前失败不是 JSON 语法层问题：模型可以返回语法正确且结束原因是 `stop` 的 JSON，但会把提示上下文中的目标品牌“广拓”写进原回答并不存在的 `mentions`。严格校验正确地拒绝了这类输出。只修改温度不能解决任务污染；放宽校验则会把虚假品牌提及写入正式指标。

本方案在必须使用 `deepseek-v4-flash` 的约束下，把一个全有或全无的概率任务拆成三条独立状态轨，并把 AI 调用拆成两个有明确边界的阶段：

```text
完整原回答
  → 确定性片段与偏移映射
  ├→ 目标事实轨：程序按注册名称/别名直接扫描原文
  └→ Flash 阶段 1：尽力抽取原文实体表面词
       → 程序锚定、隔离坏项、保守归并、分配实体 ID
       ├→ 程序用冻结的 brand_competitors 快照做身份归一；表外实体保留
       └→ Flash 阶段 2：使用匹配前投影，只引用实体 ID / 片段 ID 做闭集语义判断
            → 程序按 entity_id 回接身份映射，不回写模型结论
  → 目标事实、目标语义、开放竞品分别校验和标记状态
  → 程序按字段状态计算指标
  → 原子写入 VisibilityMetric
```

目标是将新分析升级为 `ai_structured_v5` / `geo_metric_input_v5`。issue 001–008 已实现的候选合同为 `three_track_partial_v1`；009 真实 Flash 门禁未通过后，本轮修复合同升级为 `three_track_partial_v2`，语义证据合同升级为 `semantic_evidence_v2`。目标提及事实必须达到确定性可用；推荐、排名、情绪和开放竞品允许按字段部分完成，但未知不得冒充业务否定值。SOV 计算公式可以保留，语义版本继续使用带范围的 `contextual_competitor_mentions_sov_v2_scoped`，开放发现结果明确标记 `observed_only / open_discovery / not_proven`。只有新修订真实同题对比证明 v5 达到 PRD 门槛后，才硬切正式入口。

当前代码状态是：issue 001–008 已完成，v5 已贯通候选运行、持久化、API、CSV、页面与历史兼容，但仅在显式 `analysisProvider='v5'` 时生效；009 已完成真实对比并作出“不批准硬切”决定。正式入口默认仍是 `ai_structured_v4 / geo_metric_input_v4`，当前 DeepSeek 默认分析配置为 `deepseek-v4-pro`；v5 候选自身强制 `deepseek-v4-flash`。010 尚未执行，v4 运行时、默认值和现役兼容文档仍存在。

## 2. 范围与非目标

### 2.1 范围

- 为结构化分析增加确定性原文分段、偏移映射和稳定 ID。
- 增加 Flash 实体抽取阶段、程序锚定与实体目录构建。
- 增加 Flash 闭集语义判断阶段和字段级修复协议。
- 增加目标事实、目标语义、开放竞品三轨独立状态及字段级聚合合同。
- 复用现有 `brand_competitors` 作为模型外已验证身份注册表，增加冻结快照、确定性匹配和表外实体保留合同。
- 固定正式分析平台、模型与有效请求参数：DeepSeek、`deepseek-v4-flash`、`temperature=0`、`thinking.type=disabled`、Web 搜索关闭。
- 新增 v5 结构、错误语义、诊断和历史兼容读取。
- 扩展现有基线工具，建立冻结真实语料、人工真值、A/B/C/D 运行和对比报告。
- 更新单问题、问题集、自动监测、analysis-only 重试、设置页测试、CSV 往返和报告读取。
- 达标后硬切 v5 并清理 v4 运行时代码与误导文档。

### 2.2 非目标

- 不改变目标品牌提及、推荐、排名和情绪的业务含义；只补充 `assessed / not_applicable / unresolved / invalid` 状态。
- 不把开放发现 SOV 表述成完整市场份额，也不在本需求内建设完整竞品知识图谱或封闭竞品全集。
- 不通过模糊匹配、编辑距离或推测文本修复证据。
- 不调用 DeepSeek Pro 或其他模型兜底。
- 不将项目竞品配置或人工真值输入生产提示。
- 不让竞品表成为实体允许列表、关系先验或回答事实来源；不因未匹配注册表而丢弃开放实体。
- 不让模型输出提及次数、最终排名数字、比例或 SOV。
- 不重算或覆盖历史 v4 记录。
- 不在本需求中实现新的品牌主张 KPI；v5 核心链路不生成 `claims`。
- 不新增在线人工审核工作流。

### 2.3 延后事项

- 证据绑定的可选主张抽取。
- v5 上线后的漂移告警和周期性重新标注策略。
- 表外实体的独立人工审核与提升到正式竞品表的产品工作流。
- 基于版本化竞品快照的封闭范围 SOV；当前需求只交付开放发现 SOV，二者不得混算。
- 严格工具调用从实验候选升级为长期正式传输方式；本需求只收集 D 的能力和对比证据，不把 beta 能力设为正式默认。

## 3. 当前系统认知

### 3.1 正式版本与调用入口

`backend/services/GeoMetricSemanticsService.js` 当前导出：

```text
CURRENT_ANALYSIS_CONTRACT = ai_structured_v4
CURRENT_STRUCTURE_VERSION = geo_metric_input_v4
CURRENT_METRIC_SEMANTICS = contextual_competitor_mentions_sov_v1
```

`backend/services/ProjectRunService.js` 是指标生成的共同执行链：

- 单问题和问题集运行创建 `QuestionRecord` 时写入当前分析契约。
- 自动监测由 `backend/services/SchedulerService.js` 创建同一版本的运行和记录。
- `analysis_only` 重试从 `ResultDetail.ai_response_original` 读取原回答，不再调用监测平台。
- `buildVisibilityMetricPayload` 统一调用 `AIResponseAnalysisService.analyze`。
- 事务仍原子写入一条 `VisibilityMetric`，但记录内部允许三轨和单字段处于不同状态。
- 只要输入有效且目标事实轨完成，就可写入确定性目标提及事实；语义和开放竞品按各自状态参与聚合。真正失败仍保留原回答和有界诊断。

该原子写入和 fail-closed 边界必须保留。

### 3.2 当前 v4 分析器

`backend/services/AIResponseAnalysisService.js` 当前具有以下特征：

- 提示词修订为 `semantic_evidence_field_repair_v8`。
- 完整提示包含约 10 组示例，并在一次输出中要求 `entities`、`mentions`、`target_entity_name`、`competitor_relations`、`candidate_lists`、`recommendations`、`claims` 和 `sentiment`。
- 第一轮或普通结构错误会重新生成整份 JSON；仅 evidence 类错误可使用字段补丁。
- 最多 2 次尝试，单次超时 120 秒，不设应用层 Token 上限。
- `parseOutput` 对表面词、实体引用、关系覆盖和证据做严格校验；`calculate` 只用验证后的结构计算指标。

当前校验器的严格失败是正确行为，根因位于模型任务合同和请求参数，而不是校验器“太严格”。

### 3.3 实际请求参数偏差

`AIResponseAnalysisService.ANALYSIS_REQUEST_PROFILE` 把 `temperature` 展示为 `null`；对 DeepSeek 构造请求时也没有显式温度。`backend/services/AIPlatformRequestService.js` 的 `buildRequestBody` 会先写入通用默认 `temperature: 0.7`，因此最终 HTTP 请求实际使用 0.7。

现有分析服务测试检查了提示定义和服务传参，但没有在真实 `queryConfig → buildRequestBody → httpClient.post` 边界断言分析专用最终请求体，导致“展示参数”和“线上参数”不一致未被测试发现。

v5 必须在最终请求体层证明参数有效，不能只测试中间对象。

### 3.4 持久化与消费者

- `QuestionRecord.analysis_contract_version` 和 `QuestionSetRun.analysis_contract_version` 区分分析契约。
- `VisibilityMetric.analysis_method`、`analysis_structure`、`competition_entities`、`analysis_platform`、`analysis_model` 可保存 v5；三轨与字段状态先以 `analysis_structure` 作为权威事实，既有标量只作兼容投影。
- `QuestionSetRunService` 和报告 API 透传分析结构与失败诊断。
- `backend/services/QuestionSetRunCsvService.js` 对当前 v4 证据做导入校验，需要显式认识 v5，而不能用 v4 字段形状猜测。
- 前端报告当前展示分析方式、模型、实体、关系、候选顺序、主张和证据，需要为 v5 增加版本标签与分阶段诊断，历史 v4 继续只读。

### 3.5 现有竞品表的真实职责与缺口

- `backend/models/BrandCompetitor.js` 已提供项目级 `brand_competitors`，当前字段为 `name`、`aliases`、`website`，并由 `backend/routes/geoProjects.js` 提供项目管理员增删改接口。
- 当前表用于目标/竞品名称与官网冲突校验、竞品官网引用识别、推荐监测问题生成、项目展示，以及 `QuestionSetRun.competitor_snapshot` 运行快照。
- 当前 `ProjectRunService.buildVisibilityMetricPayload` 调用正式 v4 分析器时只传 `question / responseText / brand`，没有传入 `competitors`；因此该表不参与当前实体发现、上下文关系判断或 `contextual_competitor_mentions_sov_v1`。
- 当前候选 v5 的阶段 1/2 同样没有接入竞品表。该事实避免了现役 closed-world bias，但也意味着已确认别名没有用于安全归一，候选代码仍通过模型 canonical name 和程序派生短名尝试补齐。
- `QuestionSetRun` 已有竞品快照，单问题、自动监测和 analysis-only 尚无统一的不可变注册表快照合同；若直接读取实时表，同一回答重试可能因配置变更而得到不同身份映射。

### 3.6 现有测试缺口

- 相关单元测试可以证明坏 `surface_forms` 被拒绝，却没有用真实 Flash 证明生成端能稳定满足合同。
- 设置页测试没有覆盖分析专用最终 HTTP 请求体中的温度、模型、思考模式和搜索参数。
- 既有 20 条 Flash 验收重点覆盖 evidence 字段修复，无法代表新的“目标未出现 + 长回答 + 多类别 + 英文别名”故障簇。
- 单次成功率没有衡量同输入重复运行的稳定性，也没有区分“结构合法但语义错误”。
- 现有测试没有证明竞品表为空时可运行、表外实体不会被丢弃、表内未出现品牌不会被制造，以及增删竞品配置不会改变阶段 1 请求体。

### 3.7 2026-08-05 已完成的可行性探针与正式对比

以下结果来自本地直接调用真实 DeepSeek API，输入为同一真实问题和完整回答；它们是方案方向证据，不是正式验收：

| 方案 | 模型与参数 | 结果 | 观察 |
| --- | --- | --- | --- |
| 当前完整 v4 | `deepseek-v4-flash`，当前实际参数 | 2 / 2 最终失败 | 每次均尝试 2 次，目标品牌“广拓”被虚构为原文实体，最终在 `mentions[0].surface_forms` 失败 |
| 完整 v4 降温 | `deepseek-v4-flash`，显式 `temperature=0` | 1 / 1 最终失败 | 同一错误，证明温度不是充分修复 |
| 简化阶段 1 探针 | `deepseek-v4-flash`，关闭思考，`temperature=0` | 1 / 1 首次成功 | 46 个原文片段中返回 17 条全部可定位的提及，归并为 11 个实体；未虚构“广拓” |

阶段 1 探针的提示长度为 4,381 字符，Token 用量为输入 2,212、输出 739、合计 2,951；它正确把 `Hikvision` 归一为“海康威视”、把 `Dahua Tech` 归一为“大华股份”，也没有把 `iVMS-9800`、`DSS` 当成组织实体。

此后已完成 41 条真实完整回答、每条每臂 3 次的 A/B/C Flash 对比。v5 完成率由 A 的 82.11% 提升到 98.37%，用户挑战样本由 A/B 的 3/3 失败变为 C 的 3/3 成功；C 的完整签名稳定率为 74.79%，未达到首轮历史预注册的 99% 门槛。用户确认竞品允许遗漏后，该完整签名已降为诊断项，但候选仍因自我修复路径、三轨状态和新合同全量重跑未完成而不能上线。完整数据见同目录 `validation-report.md`。

## 4. 需求、约束与不变量

### 4.1 功能要求

- REQ-001：v5 正式分析平台必须为 `deepseek`，模型必须为 `deepseek-v4-flash`。
- REQ-002：最终 HTTP 请求体必须显式包含 `temperature=0`、`thinking.type=disabled` 和适配器支持的 JSON 约束，且不得含 Web 搜索工具或参数。
- REQ-003：完整原回答必须无损转换为稳定片段和原文偏移，不截断、不重排、不改写。
- REQ-004：阶段 1 输入不得包含当前问题、目标品牌、目标别名、竞品配置或人工真值，只允许读取待分析回答的原文片段。
- REQ-005：阶段 1 只允许输出原文片段 ID、精确表面词、标准显示名和实体类型。
- REQ-006：阶段 1 进入实体目录的每条表面词必须存在于原回答。修复后仍无法锚定的单行必须隔离并记录，不得进入目录或指标；竞品实体允许漏掉，隔离单行不得导致目标事实轨失败。
- REQ-007：程序按首次出现位置生成稳定实体 ID，并保存全部已验证表面词与提及位置。
- REQ-008：目标事实轨直接使用已配置目标名称/别名扫描完整原回答；不得依赖阶段 1 是否抽到目标。模型标准名或派生短名不能单独产生目标映射。
- REQ-009：阶段 2 只能引用实体目录中的 `entity_id` 和原文片段中的 `source_id`，不得输出新实体或自由文本证据。
- REQ-010：阶段 2 返回的每条场景关系必须引用唯一、已验证的非目标实体；未知和重复 ID 无效。缺失关系允许存在，由程序写入 `unresolved_entity_ids`，不进入竞品指标分母，也不使目标事实轨失败。
- REQ-011：候选集合、顺序、明确推荐和目标情绪均须引用真正支持该结论的 `source_id`；程序不得自动补写语义证据。
- REQ-012：目标未出现时，阶段 2 不得生成目标推荐、排名或有效情绪；最终结构使用 `not_applicable` 状态。
- REQ-013：模型不得返回提及次数、最终品牌排名、SOV 或其他聚合指标。
- REQ-014：程序只从验证后的提及、关系、候选顺序和推荐计算 `VisibilityMetric`。
- REQ-015：`claims` 不进入 v5 核心合同和完成门禁；历史 v4 主张保持只读。
- REQ-016：实体阶段和语义阶段分别使用定向修复；每阶段最多 2 次。达到上限后，坏竞品项进入隔离/未解决，坏目标语义字段进入 `unresolved/invalid`，已经完成的目标事实不得被连带清空。
- REQ-017：成功与失败均保存分阶段的有界诊断，包括实际模型、请求策略、结束原因、尝试次数、Token 和耗时。
- REQ-018：正式对比必须使用冻结真实原回答，全部候选使用同一 Flash 模型，按 PRD 预注册门槛出具报告。
- REQ-019：v5 未通过真实对比和入口门禁前不得写成正式默认；通过后所有正式调用方一次性硬切。
- REQ-020：最终结构必须分别保存 `target_fact`、`target_semantics` 和 `competition_analysis` 状态；目标语义的推荐、排名、情绪各自有独立状态。
- REQ-021：聚合器只把目标语义字段的 `assessed` 结果放入对应分母；`unresolved/invalid/not_applicable` 不得映射成未推荐、中性或无排名参与统计。
- REQ-022：开放发现 SOV 必须使用 `contextual_competitor_mentions_sov_v2_scoped`，携带 `observed_only / open_discovery / not_proven`；不得与历史 v1 静默混算。
- REQ-023：`canonical_name` 只作显示候选；未经注册或原文证明的派生短名/别名不得影响提及、目标映射、关系或 SOV。
- REQ-024：阶段 1 的函数输入、提示词和最终 HTTP body 不得包含竞品注册表、快照、名称、别名、官网、`competitor_id` 或匹配状态；同一 source map 在任意竞品表配置下必须产生字节级相同的阶段 1 请求。
- REQ-025：阶段 1 原文校验完成后，程序使用本次运行冻结的竞品注册表快照做确定性身份匹配；匹配结果只允许为 `matched / unmatched / ambiguous`。
- REQ-026：注册表匹配不得创建实体、增加表面词/提及位置、修改 source ID 或改变 occurrence 数量；`unmatched/ambiguous` 实体必须继续保留并进入第二阶段。
- REQ-027：阶段 2 只接收注册表匹配前的 grounded 实体投影及目标事实；实体显示名也必须来自原文/阶段 1，而不是注册表标准名。不得接收完整竞品表、未出现的表内实体、`competitor_id`、`registry_name`、`registry_match_status` 或“已知竞品”布尔值。
- REQ-028：表内但原回答未出现的品牌不得进入实体目录、关系、证据或 SOV；注册表存在性不能单独产生任何回答级事实。
- REQ-029：开放 SOV 对 matched 与 unmatched 的已证明竞品使用相同规则；注册表只统一身份，不作为过滤器。封闭范围 SOV 延后并使用不同语义版本。
- REQ-030：所有入口必须绑定不可变竞品注册表快照或稳定空快照，并把快照版本与哈希写入 v5 结构；analysis-only 复用原记录快照，不读取最新配置改变历史分析身份。

### 4.2 约束

- CON-001：不在数据库事务中调用外部模型。
- CON-002：不修改 `contextual_competitor_mentions_sov_v1` 的历史公式或历史语义；新开放发现结果使用 v2 范围合同，禁止把 v1/v2 当同一时间序列。
- CON-003：不新增运行时 v4 fallback、模型 fallback 或按错误码切换提示词的隐藏分支。
- CON-004：管理员保存的分析请求选项不得覆盖 v5 固定的模型、温度、思考、搜索和响应格式策略；设置接口必须返回最终有效值。
- CON-005：每阶段最多一次定向修复，整条最多 4 次模型调用；实验和生产均记录实际调用数。
- CON-006：原回答超出 Flash 上下文时不静默截断或分片后拼接语义/竞品指标；目标事实仍由程序扫描，Flash 两轨标为 `unavailable` 并记录 `analysis_input_too_long`。
- CON-007：生产诊断不持久化无界模型原始输出；基准实验可在脱敏、访问受控的 `work/` 目录保存完整输出。
- CON-008：历史 v4、v3 及更早记录不迁移、不覆盖，只通过版本分支读取。
- CON-009：严格工具调用属于独立实验臂；如果能力不满足，v5 JSON mode 仍须独立通过全部门槛。
- CON-010：程序只验证、拒绝、隔离和计算，不得补造语义证据、扩大别名集合或覆盖模型语义结论来提高表面完成率。
- CON-011：复用现有 `brand_competitors`，不得创建第二张含义重叠的竞品主表；新增字段采用 additive 迁移，历史行继续有效。
- CON-012：竞品表匹配失败、表外品牌出现、竞品遗漏和注册表为空不得增加模型调用次数；正常 2 次、最坏 4 次的调用预算不变。

### 4.3 不变量

- INV-001：没有精确原文表面词的实体永远不能进入指标。
- INV-002：目标事实轨独立于开放实体目录，且目标命中集合只来自已配置名称/别名的确定性原文扫描；用于阶段 2 的目标实体映射最多一个。
- INV-003：阶段 2 输出引用的每个实体 ID、片段 ID 都必须在阶段 1 后的封闭目录中存在。
- INV-004：已返回关系的实体 ID 必须是“全部实体 ID 减去目标实体 ID”的无重复子集；未覆盖实体明确进入 `unresolved_entity_ids`。
- INV-005：模型输出的数组位置不直接等于品牌排名；排名只从 `ordered=true` 且包含目标实体的候选组计算。
- INV-006：一次分析以单事务写入一条 v5 `VisibilityMetric`，其中三轨可处于不同状态；任何标量业务值都必须能回溯到对应状态和证据。事务本身不得部分写入。
- INV-007：analysis-only 复用原回答和引用，不调用监测平台、不消耗监测配额。
- INV-008：所有新正式记录写 v5；所有历史 v4 结果保持其原版本身份。
- INV-009：开放竞品遗漏、关系未判出或 Flash 语义超时不能把 `target_fact.status=complete` 降为失败。
- INV-010：`unresolved` 与业务值 `false / neutral / null rank` 语义不同，任何消费者不得合并两者。
- INV-011：阶段 1 请求是 `sourceMap + prompt revision + fixed request policy` 的纯函数，与竞品表内容无关。
- INV-012：注册表匹配前后的 grounded occurrence 集合完全相等；只能增加身份映射元数据，不能增加回答事实。
- INV-013：进入阶段 2 的每个实体必须至少有一个目标确定性 span 或阶段 1 已验证 span；任何表内未出现实体都没有合法进入路径。
- INV-014：`unmatched` 不是无效状态，不能被过滤、降级为 `non_competitor` 或阻止关系判断。
- INV-015：匹配状态与上下文关系正交；`matched` 不等于 `competitor`，`unmatched` 也不等于 `non_competitor`。
- INV-016：改变注册表只能改变身份归一结果和未来封闭范围指标，不能改变同一回答的阶段 1 原始发现结果或模型调用次数。
- INV-017：同一 grounded 实体目录在任意注册表快照下产生字节级相同的阶段 2 实体投影；注册表结果只在阶段 2 判断完成后按 `entity_id` 回接。

## 5. 接口与数据契约

### 5.1 版本合同

```text
CURRENT_ANALYSIS_CONTRACT = ai_structured_v5
CURRENT_STRUCTURE_VERSION = geo_metric_input_v5
ANALYSIS_CONTRACT_REVISION = three_track_partial_v1
CURRENT_METRIC_SEMANTICS = contextual_competitor_mentions_sov_v2_scoped
SOURCE_MAP_VERSION = answer_source_lines_v1
ENTITY_PROMPT_REVISION = grounded_entity_catalog_v1
SEMANTIC_PROMPT_REVISION = closed_entity_semantics_v3
REPAIR_PROTOCOL_VERSION = structured_field_repair_v1
COMPETITOR_REGISTRY_SNAPSHOT_VERSION = competitor_registry_snapshot_v1
```

v5 是新的分析合同，因为模型输出从自由文本名称交叉引用改为实体 ID / 片段 ID，并改变了调用拓扑。不能只更新提示词修订号继续写 v4。

### 5.2 原文片段合同

程序从完整原回答生成：

```json
{
  "version": "answer_source_lines_v1",
  "answer_sha256": "<完整原回答哈希>",
  "segments": [
    {
      "source_id": "L001",
      "start": 0,
      "end": 43,
      "text": "大工业园区安防核心是全域覆盖……"
    }
  ]
}
```

规则：

- `start` 包含、`end` 不包含，均指向原始 JavaScript 字符串索引。
- `source_id` 按原文顺序递增，与文本内容无关；同一原文和分段版本重复生成必须字节级一致。
- 分段优先使用原始逻辑行；空行可不发给模型，但其偏移仍计入后续片段。
- 不执行 Unicode 归一化、标点替换或空白压缩；模型看到的 `text` 与原回答子串完全相同。
- 单行过长时不截断。若完整提示超出上下文，在请求前返回 `analysis_input_too_long`。

### 5.3 阶段 1 输入与输出

#### 输入

```json
{
  "source_map_version": "answer_source_lines_v1",
  "segments": [
    { "source_id": "L010", "text": "……访客管理Hikvision ...。" },
    { "source_id": "L036", "text": "视频监控：海康威视、大华股份、宇视科技……" }
  ]
}
```

输入明确不含 `question`、`target_brand`、`target_aliases`、`competitor_hints` 和人工真值。问题可能本身包含目标品牌，因此也必须后置到闭集语义阶段。

#### 模型输出

```json
{
  "mentions": [
    {
      "source_id": "L010",
      "surface_form": "Hikvision",
      "canonical_name": "海康威视",
      "entity_type": "brand"
    },
    {
      "source_id": "L036",
      "surface_form": "大华股份",
      "canonical_name": "大华股份",
      "entity_type": "brand"
    }
  ]
}
```

字段规则：

- `source_id` 必须存在。
- `surface_form` 必须是对应 `segments[].text` 的非空精确子串，长度有界，不允许整句充当实体词。
- `canonical_name` 是展示和归并建议，不构成原文证据；长度有界。
- `entity_type` 只允许 `brand / company / other_organization`。
- 不允许未知字段、空行、重复四元组或阶段 2 字段。

### 5.4 程序锚定、归并与目标映射

阶段 1 校验通过后，程序构建：

```json
{
  "entities": [
    {
      "entity_id": "E001",
      "name": "海康威视",
      "type": "brand",
      "surface_forms": ["Hikvision", "海康", "海康威视"],
      "mentions": [
        {
          "source_id": "L010",
          "start": 301,
          "end": 310,
          "surface_form": "Hikvision"
        }
      ]
    }
  ],
  "target_entity_id": null
}
```

归并规则：

1. 每个有效表面词在所指片段中展开为原回答的绝对位置。
2. 重叠提及使用“起点更早、表面词更长优先”的确定性规则生成非重叠计数，与现行计数原则一致。
3. 第一轮只按相同原文表面词和原文明确表达的别名关系做保守归并；模型 `canonical_name` 仅为显示候选，不得自动派生短名或别名参与扫描。竞品注册表匹配在全部原文 span 固定后单独执行，不得回头扩大 occurrence 集合。
4. 实体类型冲突时进入阶段 1 修复，程序不以多数票猜测。
5. 目标事实轨在阶段 1 之前或并行执行：使用目标名称和项目已配置别名直接扫描完整原回答，采用 NFKC、大小写折叠和边界感知比较，不使用编辑距离、模型标准名或程序派生别名猜测。
6. `target_fact.mentions` 由该确定性扫描直接产生；阶段 1 漏掉目标实体不影响目标事实。
7. 阶段 2 如需 `target_entity_id`，程序只可把目标事实命中的原文 span 与已验证实体 span 做精确对齐；无法唯一对齐时目标事实仍为 `complete`，同时写 `target_mapping.status=ambiguous`、`target_entity_id=null`，目标语义标为 `unavailable`，不能任选实体或抛出整条 `analysis_target_mapping_ambiguous`。
8. `target_mapping` 与 `target_fact` 分离，状态为 `resolved / not_applicable / ambiguous / unavailable`。S55 这类同时出现品牌短名与公司全称、并被阶段 1 拆成多个实体的输入必须保留全部 grounded 实体和确定性目标 mentions。

### 5.5 竞品注册表快照与身份归一

#### 冻结快照

所有入口在创建运行/记录时生成稳定快照；`QuestionSetRun.competitor_snapshot` 沿用现有字段，单问题和自动监测增加等价的不可变记录级快照或引用。analysis-only 必须复用原快照。

```json
{
  "version": "competitor_registry_snapshot_v1",
  "sha256": "<按 competitor_id 排序后的规范 JSON 哈希>",
  "entries": [
    {
      "competitor_id": 12,
      "name": "海康威视",
      "aliases": ["海康", "Hikvision"],
      "website": "hikvision.com"
    }
  ]
}
```

空竞品表生成合法空快照而不是 `null`：

```json
{
  "version": "competitor_registry_snapshot_v1",
  "sha256": "<空 entries 的稳定哈希>",
  "entries": []
}
```

#### 确定性匹配输出

```json
{
  "entity_id": "E001",
  "name": "海康威视",
  "surface_forms": ["Hikvision"],
  "registry_match": {
    "status": "matched",
    "competitor_id": 12,
    "registry_name": "海康威视",
    "matched_term": "Hikvision"
  }
}
```

匹配合同：

1. 只使用已经通过原文校验的 `surface_forms` 与快照中的 `name/aliases` 做 NFKC、大小写折叠、受控空白/标点归一后的精确相等匹配；不使用编辑距离、前缀猜测或模型 canonical name 单独命中。
2. 唯一命中时为 `matched`；零命中时为 `unmatched`；同时命中多个 `competitor_id` 时为 `ambiguous` 并保存候选 ID，但不任选一个。
3. `matched` 可在最终展示/聚合层绑定注册表标准身份；`unmatched/ambiguous` 保留原实体 ID、原文表面词和阶段 1 显示候选。三种状态进入阶段 2 时都使用匹配前的同形 grounded 投影。
4. 多个开放实体唯一映射到同一 `competitor_id` 时，只在阶段 2 之后建立 `identity_group` 用于最终聚合；不得合并或重编号阶段 2 实体，所有原文 span、逐实体关系和提及计数原样保留。
5. 匹配器不得扫描回答补充注册别名的额外出现位置，不得创建表内未出现实体，也不得赋予 `competitor/non_competitor` 关系。
6. 快照和匹配结果写入 `analysis_structure` 供审计，但完整快照、`competitor_id`、`registry_name`、匹配状态和“已知竞品”标记不进入任何模型提示；resolver 输出按 `entity_id` 在阶段 2 之后回接。

### 5.6 阶段 2 输入与输出

#### 输入

```json
{
  "question": "大工业园区用什么安防设备比较好？",
  "target_entity_id": null,
  "entities": [
    {
      "entity_id": "E001",
      "name": "海康威视",
      "type": "brand",
      "surface_forms": ["Hikvision", "海康", "海康威视"],
      "source_ids": ["L010", "L025", "L036", "L038"]
    }
  ],
  "segments": [
    { "source_id": "L010", "text": "……" }
  ]
}
```

阶段 2 可以看到程序依据目标事实生成的目标实体 ID 和目标命中证据，但不能创建新的目标表面词。实体 `name` 使用注册表匹配前、由原文或阶段 1 给出的显示候选；输入不得包含完整注册表、注册表标准名、`competitor_id`、`registry_match` 或已知/未知标签。同一 grounded 目录在不同注册表快照下必须生成字节级相同的阶段 2 实体投影。`target_fact.brand_mentioned=false` 时，提示词明确禁止构造目标情绪、推荐或排名。

#### 模型输出

```json
{
  "competitor_relations": [
    {
      "entity_id": "E001",
      "relation": "competitor",
      "reason": "回答将其作为当前园区安防采购的可选供应品牌",
      "semantic_context_source_ids": ["L036", "L038"]
    }
  ],
  "candidate_groups": [
    {
      "ordered": false,
      "entries": ["E001", "E002", "E003"],
      "reason": "同一类别内并列列举，没有表达先后",
      "semantic_context_source_ids": ["L036"]
    }
  ],
  "recommendations": [
    {
      "entity_id": "E001",
      "kind": "explicit",
      "semantic_context_source_ids": ["L036"]
    }
  ],
  "sentiment": {
    "status": "not_applicable",
    "label": null,
    "reason": "目标品牌未在回答出现",
    "semantic_context_source_ids": [],
    "risk_terms": []
  }
}
```

字段规则：

- `competitor_relations` 是已解决关系的子集，关系只允许 `competitor / non_competitor`；程序以实体目录减去该子集得到 `unresolved_entity_ids`。开放发现范围固定标记为 `competition_scope=open_discovery`、`competition_completeness=not_proven`。
- `candidate_groups.entries` 至少两个不同实体 ID；多个类别必须分组，不得压平成全局排名。
- `recommendations.kind` 首版只允许 `explicit`。
- 阶段 2 模型只返回 `semantic_context_source_ids`；程序从 source map 生成最终可展示的语义上下文文本。模型不负责重复输出实体 occurrence 证据。
- 目标存在时 `sentiment.status=assessed` 且 `label` 为 `positive / neutral / negative`；目标不存在时必须为 `not_applicable` 且 `label=null`。
- `claims` 不在本合同中。

#### `semantic_evidence_v2` 证据角色

最终持久化的每个语义断言使用同形证据包：

```json
{
  "entity_id": "E001",
  "evidence": {
    "entity_occurrence_source_ids": ["L010"],
    "semantic_context_source_ids": ["L036", "L038"]
  }
}
```

- `entity_occurrence_source_ids` 由程序从阶段 1 已冻结的 `entities[].mentions[].source_id` 投影，只证明实体身份与原文出现；它不是模型语义输出，也不得被当成推荐、关系或情绪证据。
- `semantic_context_source_ids` 由 Flash 返回，只证明当前语义断言。每个 ID 必须存在于本次 source map；不再要求对应片段同时逐字包含该实体，因为真实回答可能先列出实体、后在其他片段使用简称、代词、集合或顺序表达语义。
- 两类证据通过同一个 `entity_id` 绑定。程序可以组装证据包，但不得自动选择、添加或替换 `semantic_context_source_ids`。
- 静态校验继续拒绝未知 ID、越界 ID、空的必需语义上下文、跨实体引用和明显不满足断言类型的上下文；语义是否真正支持结论最终由人工真值评测约束，不能用“片段包含实体字符串”的机械规则替代。
- 修复请求必须携带失败断言、允许引用的 source map 及该实体已知 occurrence IDs，明确要求重新选择语义上下文；仍失败时只把对应字段或竞品项降级，不清空目标事实。

### 5.7 最终 v5 结构

程序在目标事实完成后合并两个 Flash 阶段的可用结果，生成持久结构。开放竞品或单个目标语义字段未解决不会阻止结构生成：

```json
{
  "schema_version": "geo_metric_input_v5",
  "contract_revision": "three_track_partial_v2",
  "source_map_version": "answer_source_lines_v1",
  "answer_sha256": "<hash>",
  "competitor_registry_snapshot": {
    "version": "competitor_registry_snapshot_v1",
    "sha256": "<hash>",
    "entry_count": 1
  },
  "target_fact": {
    "status": "complete",
    "brand_mentioned": false,
    "brand_mentions": 0,
    "mentions": []
  },
  "target_mapping": {
    "status": "not_applicable",
    "target_entity_id": null,
    "candidate_entity_ids": []
  },
  "target_semantics": {
    "status": "complete",
    "recommendation": { "status": "not_applicable", "value": null, "evidence": { "entity_occurrence_source_ids": [], "semantic_context_source_ids": [] } },
    "rank": { "status": "not_applicable", "value": null, "evidence": { "entity_occurrence_source_ids": [], "semantic_context_source_ids": [] } },
    "sentiment": { "status": "not_applicable", "value": null, "evidence": { "entity_occurrence_source_ids": [], "semantic_context_source_ids": [] } }
  },
  "competition_analysis": {
    "status": "partial",
    "scope": "open_discovery",
    "completeness": "not_proven",
    "entities": ["E001"],
    "relations": [],
    "unresolved_entity_ids": ["E001"],
    "quarantined_items": []
  },
  "sov": {
    "status": "observed_only",
    "scope": "open_discovery",
    "completeness": "not_proven",
    "numerator": 0,
    "denominator": 0,
    "value": null
  },
  "entities": [
    {
      "entity_id": "E001",
      "name": "海康威视",
      "type": "brand",
      "registry_match": {
        "status": "matched",
        "competitor_id": 12,
        "registry_name": "海康威视",
        "matched_term": "Hikvision"
      }
    }
  ],
  "mentions": [
    {
      "entity_id": "E001",
      "source_id": "L010",
      "start": 301,
      "end": 310,
      "surface_form": "Hikvision"
    }
  ],
  "target_entity_id": null,
  "competitor_relations": [],
  "candidate_groups": [],
  "recommendations": [],
  "sentiment": {
    "status": "not_applicable",
    "label": null,
    "reason": "目标品牌未在回答出现",
    "semantic_context_source_ids": []
  },
  "claims": {
    "status": "not_collected",
    "items": []
  },
  "diagnostics": {
    "entity_prompt_revision": "grounded_entity_catalog_v1",
    "semantic_prompt_revision": "closed_entity_semantics_v4_evidence_roles",
    "model": "deepseek-v4-flash",
    "stages": []
  }
}
```

最终结构中的所有 `mentions.start/end` 必须再次与 `answer_sha256` 对应原文校验。对当前报告需要的 occurrence 与 semantic context 文本，由程序分别从证据包中的两类 source IDs 和原回答提取，不信任模型自由文本。顶层旧字段可暂时保留为兼容镜像，但三轨结构是 v5 的权威事实。

`competitor_registry_snapshot` 只保存本次使用的版本、哈希和数量；完整快照由运行/记录的不可变配置保存。CSV 和报告可展示每个实体的匹配状态，但不能据此改变关系语义。`unmatched/ambiguous` 的实体结构与 `matched` 等价可用。

状态派生规则：

- `target_fact.status=complete`：输入有效、哈希一致、目标注册别名无歧义，程序完成全量原文扫描。
- `target_semantics.status=complete`：三个字段均为 `assessed` 或 `not_applicable`；任一字段为 `unresolved/invalid` 时总状态为 `partial`；目标已出现但 Flash 整体不可用时为 `unavailable`。
- `competition_analysis.status=complete` 只表示“所有已发现实体均已处理”，不表示实体发现完整；因此 `completeness` 在开放模式始终为 `not_proven`。存在未解决/隔离项时为 `partial`，Flash 阶段不可用时为 `unavailable`。
- `sov.status=observed_only` 不是质量通过状态，而是指标范围声明；分母为 0 时 `value=null`。

### 5.8 指标输出兼容

`AIResponseAnalysisService.analyze` 对调用方继续返回现有顶层指标字段，减少正式入口改动：

```json
{
  "analysis_method": "ai_structured_v5",
  "analysis_platform": "deepseek",
  "analysis_model": "deepseek-v4-flash",
  "metric_semantics_version": "contextual_competitor_mentions_sov_v2_scoped",
  "brand_mentioned": false,
  "brand_mentions": 0,
  "brand_position": null,
  "brand_rank": null,
  "brand_recommended": false,
  "answer_competitor_share": null,
  "sov_numerator": 0,
  "sov_denominator": 0,
  "sov_status": "observed_only",
  "sov_scope": "open_discovery",
  "sov_completeness": "not_proven",
  "competition_entities": [
    {
      "name": "海康威视",
      "relation": "competitor",
      "mentions": 4
    }
  ],
  "sentiment": "neutral",
  "analysis_structure": {}
}
```

注意：`brand_recommended=false`、`brand_rank=null` 和 `VisibilityMetric.sentiment=neutral` 可能只是旧数据库/接口的兼容投影，不能单独证明 v5 已判断为“未推荐、无排名、中性”。v5 聚合、报告和 CSV 必须读取 `analysis_structure.target_semantics.<field>.status`；只有 `assessed` 进入对应分母。若任何消费者无法证明会读取状态，应在硬切前修改消费者或新增可查询状态列，不能继续扩大占位语义。

### 5.9 修复协议

每个阶段最多一次修复，整条最多 4 次模型调用：

```text
entity_extract → entity_repair? → semantic_judge → semantic_repair?
```

阶段 1 修复输入只包含：

- 原始 segments；
- 已通过的 mention 行；
- 失败行的字段路径、错误代码和有界摘要；
- 允许返回的替换/删除动作。

阶段 2 修复输入只包含：

- 不可变实体目录和 segments；
- 已通过字段；
- 缺失或无效字段路径；
- `repairs[]` 合同。

修复响应不得覆盖未列出的字段，不得创建实体。补丁合并后必须对受影响结构重新校验。第二次仍无效时：实体坏行进入 `quarantined_items`，缺失关系进入 `unresolved_entity_ids`，目标语义字段进入 `unresolved/invalid`；不得自动补证据、扩展别名或重写已通过结论。

### 5.10 错误与诊断

新增或细分内部错误代码：

| 错误代码 | 阶段 | 含义 |
| --- | --- | --- |
| `analysis_model_policy_mismatch` | config | 平台、模型或固定请求参数不满足 Flash v5 策略 |
| `analysis_input_too_long` | prepare | 完整输入超出模型上下文，未截断 |
| `analysis_entity_output_invalid` | entity_extract | 阶段 1 JSON 或字段结构无效 |
| `analysis_entity_grounding_invalid` | entity_validate | 表面词或 source ID 无法精确锚定 |
| `analysis_target_mapping_ambiguous` | target_map | v1 历史错误码；v2 多个实体同时命中目标别名时改写 `target_mapping.status=ambiguous`，不再抛整条错误 |
| `analysis_semantic_output_invalid` | semantic_judge | 阶段 2 JSON 或字段结构无效 |
| `analysis_relation_incomplete` | semantic_validate | 历史错误码；v5 新合同中单纯缺失转为 `unresolved_entity_ids`，只有重复/未知 ID 作为坏项处理 |
| `analysis_evidence_reference_invalid` | semantic_validate | semantic context source ID 不存在、越界或不支持结论；对应字段无效，不自动补语义上下文，也不要求该片段重复实体 occurrence |
| `analysis_output_truncated` | request | 任一阶段输出截断 |

对外不得再把所有非完整结果统一显示为“AI 结构化结果无效，本条未计入品牌指标”。应按状态显示“目标事实已完成；目标语义部分未解决；开放竞品为尽力发现”等信息；只有目标事实轨真实失败时才使用未计入目标提及指标的失败文案。诊断结构示例：

```json
{
  "status": "partial",
  "error_code": "analysis_evidence_reference_invalid",
  "stage": "semantic_validate",
  "field": "target_semantics.recommendation",
  "attempt_count": 2,
  "total_call_count": 2,
  "platform": "deepseek",
  "model": "deepseek-v4-flash",
  "finish_reason": "stop",
  "output_length": 2248,
  "usage": {
    "prompt_tokens": 2212,
    "completion_tokens": 739,
    "total_tokens": 2951
  }
}
```

诊断不保存 API Key、请求头、完整原回答、完整无效输出或服务器绝对路径。

### 5.11 历史与 CSV 兼容

- 新运行和 analysis-only 新记录写 `ai_structured_v5`；历史记录保留原版本。
- `QuestionSetRunService` 的结构化方法白名单增加 v5，同时继续识别 v1–v4 历史数据。
- CSV 协议可继续使用 `question_set_run_v1` 外壳，但导入时根据 `analysis_contract_version` 分派 v4/v5 校验器。
- v5 的实体引用使用 ID；不得为了兼容 CSV 把 ID 降级为自由文本名称。
- v4 的历史 `claims` 正常展示；v5 显示“本版本未采集品牌主张”，不得显示为空即“没有主张”。

## 6. 关键技术决策

### KTD-001：拆成两个模型阶段，而不是继续扩写一个大 JSON

开放信息抽取和闭集语义分类需要不同的注意力目标。一次大调用中的目标品牌、示例和后续任务会污染前面的实体事实。分阶段使每个模型输出更小、约束更局部，并允许程序在两个不可信边界之间建立可信实体目录。

代价是正常路径从 1 次调用变为 2 次，最坏从 2 次变为 4 次。因此必须用 Token、P95 延迟和每个有效分析成本门槛约束，而不能只看完成率。

### KTD-002：目标事实独立于开放抽取且由程序匹配

阶段 1 不接收目标品牌。程序直接以项目注册名称/别名扫描原回答，目标事实不依赖阶段 1 召回；阶段 2 只接收已经由原文证明的目标命中。这从数据流上消除了“提示里出现目标品牌，所以模型把它当成回答实体”的故障模式，也避免开放抽取漏掉目标时丢失确定性指标。

取舍是未配置的生僻目标别名可能产生假阴性。该问题应通过品牌别名维护和人工基线发现，不能让模型凭标准名猜测来换取召回。

### KTD-003：第二阶段只引用 ID

实体名称和证据文本在多字段重复时容易产生拼写差异、改写和幻觉。使用 `E001` / `L001` 的闭集引用可以由程序做集合相等校验，也能显著缩短输出。

### KTD-004：竞品发现允许遗漏，已输出事实继续严格校验

2026-08-05 用户明确确认：竞品不要求穷举，可以漏掉，只需尽量发现，不能因未发现而报错。因此阶段 1 修复后仍无法锚定的单行可以隔离并记录，阶段 2 缺少的关系写入 `unresolved_entity_ids`；两者均不得拖累目标事实轨。

该决策不授权宽松接受错误。被保留的实体必须逐字锚定；被保留的关系、推荐、候选和情绪证据必须真实支持相应结论。程序不得为模型自动补一条仅仅“包含实体”的片段来冒充关系证据。开放竞品集合和 SOV 分母必须标记为 `not_proven`，不能表达为完整市场全集。

### KTD-005：JSON mode 是传输约束，不是语义保证

DeepSeek 官方 JSON mode 保证模型输出可解析 JSON 的能力，但不保证 JSON Schema、跨字段引用和原文真实性。v5 即使使用 JSON mode，也必须做完整程序校验。

严格工具调用只作为实验 D。若使用，schema 必须满足供应商要求的全字段 required 和 `additionalProperties=false`，且要独立验证 `deepseek-v4-flash`、关闭思考和工具选择的兼容性。运行时不得在 strict 失败时静默改走 JSON mode；即使 D 通过，本需求的正式默认仍为通过门槛的 C，D 的升级另行评审。

### KTD-006：固定 Flash 请求策略，覆盖管理员易变参数

正式 v5 的模型、温度、思考和搜索策略是数据合同的一部分。分析服务在合并管理员允许的非关键参数后，最后写入固定策略；设置保存和 prompt 预览都展示最终有效请求体。最终 HTTP body 测试是验收事实。

### KTD-007：不在核心路径生成 claims

当前 `claims` 没有原文证据绑定，也不参与核心 GEO 指标，却扩大输出体积和出错面。v5 将其标记为 `not_collected`。若未来需要，使用独立、可选、带 source ID 的审计阶段，不阻塞品牌指标。

### KTD-008：三轨状态先由 `analysis_structure` 承载，消费者必须读取状态

现有版本字段和 JSON 字段能够表达 v5，`analysis_structure` 是三轨和字段状态的权威事实；顶层布尔、空排名和中性情绪仅作历史兼容投影。U6 必须审计并修改所有聚合、API、CSV 和 UI 消费者，使其按状态筛选。若无法证明查询路径都读取 JSON 状态，则在硬切前新增状态列和迁移，不能让旧标量继续决定业务分母。

### KTD-009：正式切换采用硬切，不设置生产 feature flag

候选 v5 在基准脚本和测试依赖注入中验证，不通过生产隐藏开关灰度。门槛通过后，`AIResponseAnalysisService` 的唯一运行实现改为 v5，所有正式调用方更新当前契约，删除 v4 运行时代码；历史读取器保留。

### KTD-010：程序验证而不自我修复语义事实

程序可以验证 JSON、封闭 ID、原文位置、重复项和聚合不变量，也可以隔离坏项；不能为关系、推荐、排名或情绪自动寻找一条“看起来相关”的片段，不能从 `canonical_name` 派生别名扩大命中，也不能把中性程序性覆盖为正面。否则完成率上升只是把未知伪装成已证明。

### KTD-011：开放 SOV 与封闭 SOV 必须版本隔离

本需求只实现开放发现 SOV：分子、分母都基于本次已发现且已验证的实体，因此结果标记 `observed_only / open_discovery / not_proven`。若未来需要可跨周期严格比较的 SOV，必须引入版本化封闭竞品集合和注册别名，并使用新的 scope 与 `metric_semantics_version`；两种结果不得混在同一趋势中。

### KTD-012：竞品注册表只在模型边界之间做身份归一

竞品表进入阶段 1 提示会形成 anchoring/closed-world bias；进入阶段 2 提示或暴露“已知竞品”标签会把身份先验污染成关系判断。因此完整注册表永远不进入模型上下文。安全接点只有阶段 1 原文锚定之后、阶段 2 之前的纯程序 resolver：它可以把 grounded surface form 映射到稳定 `competitor_id`，但不能新增实体、span、提及或关系。阶段 2 仅看到本条回答已经证明的实体目录。

### KTD-013：复用现有主表，表外观察保留在分析结构

`brand_competitors` 已承担项目配置、别名、官网引用和运行快照职责，新增第二张竞品主表会产生双重真值。本需求复用现有表；表外发现作为 `analysis_structure.entities[].registry_match.status=unmatched` 保存。自动候选池、人工审核和提升流程延后，且未来也不得自动把一次模型发现写入主表。

### KTD-014：目标事实与目标实体映射必须是独立状态机

目标事实回答“目标注册名称/别名是否在原回答出现”，目标实体映射回答“哪个阶段 1 实体承载这些 occurrence”。前者由程序确定性扫描，后者可能因模型把短名、英文名和公司全称拆成多个实体而歧义。映射歧义只关闭需要唯一实体 ID 的目标语义，不得把已证明的 presence/count 变成失败。不得通过猜一个实体或无合同自动合并来提高完成率。

### KTD-015：实体 occurrence 证据与语义上下文证据分轨

009 的主要降级不是 JSON 语法错误，而是单一证据数组被要求同时证明实体出现和语义结论。`semantic_evidence_v2` 让程序持有确定性的 occurrence 证据，让模型只选择 semantic context；两者通过封闭 `entity_id` 组合审计。该设计不恢复自动语义补证据，因为程序永远不能生成 semantic context。代价是静态校验不再把“同一片段含实体字面量”当作语义正确性的充分或必要条件，必须依靠断言类型约束和人工真值评测保证 precision。

## 7. 真实 Flash 对比实验设计

### 7.1 实验问题

实验必须分别回答：

1. 仅把温度从 0.7 改为 0，能否解决失败？
2. 分阶段是否提高结构完成率和真实语义质量？
3. JSON mode 与严格工具调用的差异来自传输约束还是语义质量？
4. 分阶段的 Token、延迟和重试成本是否可接受？
5. 同一输入重复运行时，核心指标是否稳定？
6. 竞品注册表内容变化时，阶段 1 开放发现是否保持完全独立，且表外实体是否不丢失？

### 7.2 冻结语料

使用只读方式从已有完整 `ResultDetail.ai_response_original` 和用户本次失败回答构建至少 40 条去重真实语料。建议产物：

```text
work/geo-flash-structured-2026-08-05/
  manifest.jsonl
  answers/
  LABELING.md
  truth.jsonl
  runs/
    v4-current/
    v4-temperature-zero/
    v5-json-mode/
    v5-strict-tool/
  COMPARISON-REPORT.md
```

`work/` 产物不提交 Git；文档和 issue 只记录哈希、汇总与脱敏结论。

每个样本清单至少保存：

```json
{
  "sample_id": "FSA-001",
  "question": "大工业园区用什么安防设备比较好？",
  "answer_path": "answers/FSA-001.txt",
  "answer_sha256": "<hash>",
  "target_brand": "广拓",
  "target_aliases": ["上海广拓", "GATO"],
  "source_platform": "doubao-web",
  "source_model": "doubao-web-ui",
  "strata": ["target_absent", "long_answer", "multi_category", "english_alias"],
  "historical_failure": "invalid_analysis_output"
}
```

语料约束：

- 全部纳入用户列出的六类真实问题及其可获得的有效完整回答。
- 目标出现与目标未出现各不少于 12 条。
- 多实体回答不少于 10 条；长回答、Markdown/表格、英文品牌别名、产品名非组织等挑战类型均须覆盖。
- 历史失败富集样本不超过总语料 50%，普通样本和失败样本分层报告。
- 每个已有主要采集平台尽量不少于 5 条；平台只是回答来源，结构化分析模型始终为同一 Flash。
- 以 `answer_sha256` 去重；不得重新向监测平台采集来替代同题输入。
- 脱敏并排除凭据、Cookie、联系人信息和私有证据路径。

### 7.3 人工真值

`truth.jsonl` 至少标注：

- 每个组织实体的所有原文 span、标准名和类型。
- 目标是否出现及命中的注册别名。
- 每个实体在当前问题中的 `competitor / non_competitor`。
- 候选分组、是否有序和精确顺序。
- 明确推荐实体。
- 目标出现时的情绪；未出现时为不适用。

标注人员不查看各实验臂输出；有争议样本记录裁决理由。每个进入门槛的语义指标至少有 20 个可评估真值实例，否则只报告结果、不声称通过该项门槛，并补样本后重跑。

### 7.4 实验臂

| 实验臂 | 分析合同 | 温度 | 目的 |
| --- | --- | --- | --- |
| A `v4-current` | 当前完整 v4 | 当前最终 HTTP body 的实际值 | 生产基线 |
| B `v4-temperature-zero` | 当前完整 v4 | 0 | 隔离温度影响 |
| C `v5-json-mode` | 分阶段 v5 + JSON mode | 0 | 主候选 |
| D `v5-strict-tool` | 分阶段 v5 + strict tool | 0 | 可选能力对照，为后续立项提供证据 |

所有实验臂固定：

- `deepseek-v4-flash`；
- 思考模式关闭；
- Web 搜索关闭；
- 相同完整问题、回答、目标配置；
- 每个样本每臂独立运行 3 次；
- 实验臂交错执行，避免只在不同时间段运行某一方案；
- 不只重跑候选的失败项；任何补跑必须对相同配对集合全部重跑并在报告说明。

D 先执行小型能力探针。若官方接口拒绝 schema、工具选择与当前 Flash/关闭思考不兼容，报告为 `unsupported` 并退出该实验臂；C 仍须独立通过门槛。

### 7.5 指标计算

#### 传输与校验

- JSON parse rate。
- schema-valid rate。
- source grounding rate。
- closed-reference validity rate。
- full analysis completion rate 和 first-pass rate。
- wrong-but-schema-valid rate。

#### 事实与语义质量

- `target_fact` 可用率、目标 presence/count 准确率与 grounding precision。
- 被保留实体 span grounding precision；开放实体 precision / recall / micro-F1 和 canonicalization accuracy 作为独立诊断。
- 阶段 1 请求哈希不变率；注册表 `matched / unmatched / ambiguous` 比例、表外实体保留率、表内未出现品牌生成数。
- target presence accuracy、false-positive rate、false-negative rate。
- 已输出 competitor relation precision、coverage、未解决率和隔离率。
- candidate group/order exact-match。
- recommendation precision / recall / F1。
- sentiment accuracy 与混淆矩阵。

#### 稳定性与成本

- 三次运行的目标核心签名一致率。签名包括目标是否出现、目标提及次数、目标排名、推荐和目标情绪；开放竞品集合与依赖它的 SOV 分母不进入核心门槛，另以集合 Jaccard、SOV 波动和未解决率报告。
- 每阶段和总调用次数、Token、耗时；报告 mean、median、P95。
- 注册表为空、全命中或存在表外实体时，正常路径均为 2 次、最坏均为 4 次模型调用；注册表未命中不得触发附加模型调用。
- 每个有效分析的 Token 与估算成本。

#### 统计呈现

- 完成率、目标准确率等比例指标给出 Wilson 95% 区间。
- 同一样本/重复的 A 与 C 结果用配对差值报告，不把不同样本平均值直接比较。
- 报告总体结果及各分层结果；小样本分层明确样本数，不作过度推断。

### 7.6 预注册上线门槛

门槛直接沿用 PRD AC-009 至 AC-028，关键硬门槛为：

- 对全部输入有效的冻结运行，`target_fact` 可用率 100%；目标出现、提及次数和原文证据准确率及重复一致率均为 100%，目标假阳性 0，无效事实写指标 0。
- 被保留实体和语义证据的原文锚定率 100%；语义证据自动补写数 0，未经确认的派生别名影响指标数 0，未解决值进入已判断聚合数 0。
- 已输出竞品关系 precision ≥ 0.95；竞品召回、集合 Jaccard 和未解决率只作诊断，不阻塞目标事实完成。
- 推荐 F1 ≥ 0.95、目标情绪 accuracy ≥ 0.90、明确排名 exact-match ≥ 0.95；每项人工真值实例不少于 20。
- 目标核心签名重复一致率 ≥ 99%，其中目标出现与提及次数一致率为 100%。
- 中位总 Token ≤ A 的 1.5 倍，P95 总耗时 ≤ A 的 2 倍。
- 同一回答、问题和目标配置下，竞品注册表从空表切换为任意快照时，阶段 1 最终请求哈希一致率 100%；表内未出现品牌生成数为 0，grounded 表外实体保留率为 100%。
- A 至少有 4 次目标事实不可用时，C 相对减少至少 75%；否则 C 的目标事实可用率不得低于 A，且仍必须为 100%。

任何硬门槛失败时，结论为“不批准硬切”。可以根据失败分层修改 v5 并创建新实验修订号，但不得修改既有报告或事后降低门槛来宣布成功。

### 7.7 2026-08-05 实际结果与决策

实际 A/B/C 均使用 `deepseek-v4-flash`，41 条真实回答各重复 3 次：

| 实验臂 | 完成率 | 完整签名稳定率 | Token 中位 | P95 耗时 |
| --- | ---: | ---: | ---: | ---: |
| A `v4-current` | 101/123（82.11%） | 36/88（40.91%） | 7,781 | 19,679 ms |
| B `v4-temperature-zero` | 103/123（83.74%） | 71/99（71.72%） | 7,755 | 21,227 ms |
| C `v5-json` | 121/123（98.37%） | 89/119（74.79%） | 5,560 | 11,858 ms |

C 相对 A 减少 90.91% 失败，目标品牌五项人工真值在 121 条有效结果中均为 100%，成本门槛也通过；但完整稳定性硬门槛失败，完整实体/关系人工真值只有 10 条而不可判定。决策为“不批准硬切”，U8 不得开始。详细分层和修复后复测见 `validation-report.md`。

**需求修订说明：** 上表及“不批准硬切”结论是首轮实验历史事实，保留不改写。用户随后明确竞品允许遗漏，因此完整开放竞品集合不再进入目标核心稳定门槛；下一轮改用目标核心签名硬门槛，并将竞品集合 Jaccard、未解决率和已输出关系 precision 分开报告。在新合同重跑完成前仍不批准硬切。

#### `three_track_partial_v1` 第二轮结果（issue 009）

issue 001–008 完成后，41 条冻结语料和 15 条补充样本按新合同再次执行真实 A/B/C。主语料 v5 完成率为 100%，目标出现准确率和 grounding 均为 100%，但目标核心签名稳定率为 95.12%，低于 99%；补充样本 v5 完成率为 93.33%，3 次失败均来自 S55 的多实体目标映射歧义。主语料 73/123（59.3%）在阶段 2 因 `analysis_evidence_reference_invalid` 降级。

assessed 幸存样本中的推荐 21/21、情绪 21/21 和排名 4/4 不能证明整体语义可靠：大量降级形成选择偏差，排名也未达到每项至少 20 个已复核实例的预注册要求。实体 grounding 只证明字符串可定位，不能证明实体切分和 canonicalization 正确。issue 009 因此保持“不批准硬切”，其原始结果不得在 v2 实验中覆盖。

## 8. 实现切片

当前进度：对应 issue 001–008 的 U1–U6 和候选正式入口接线已经完成；U7/issue 009 已完成第二轮真实 A/B/C，但门槛失败。U8/issue 010 未开始，正式生产仍走 v4。U9/issue 011 目标映射歧义隔离已完成并关闭：`target_fact` 与 `target_mapping` 独立，S55 真实 Flash 3/3 保留目标事实且不再整条失败。U10/issue 012 `semantic_evidence_v2` 双角色证据合同已完成并关闭：`CONTRACT_REVISION=three_track_partial_v2`，S43 真实 Flash 3/3 目标语义 complete、推荐/情绪 assessed 且与真值一致。U11/issue 013 真值审计、U12/issue 014–015 探针与全量门禁待执行。

### U1. 冻结真实语料与评测合同

**目标：** 在实现 v5 前固定真实输入、人工真值、实验臂和评价公式，防止按模型输出反向挑样本或改门槛。

**依赖：** 无。

**涉及文件：**

- `backend/scripts/geoBaselineSample.js`
- `backend/scripts/geoBaselineEvaluate.js`
- `backend/scripts/geoFlashStructuredCorpus.js`（新增）
- `backend/scripts/geoFlashStructuredBenchmark.js`（新增）
- `backend/tests/GeoBaselineScripts.test.js`
- `backend/tests/GeoFlashStructuredBenchmark.test.js`（新增）

**方案：**

- 复用既有人工基线脚本的只读抽样、哈希、缓存隔离和报告模式。
- 新脚本只从完整有效回答构建 manifest，不访问监测平台。
- 真值和模型运行缓存分目录；prompt revision、模型、最终请求策略和答案哈希共同构成缓存键。
- 实验脚本支持 A/B/C/D、三次重复、交错执行、断点续跑和配对报告。
- 在执行真实 API 前先输出样本分层、缺失真值和预计调用量供审查。

**测试场景：**

- 同一回答哈希稳定，重复样本拒绝。
- 目标出现/未出现、历史失败和平台分层计数正确。
- 真值不会进入任何提示。
- 缓存键变化时不误用旧输出。
- 中断恢复不重复覆盖已完成结果。
- Wilson 区间、F1、exact-match、P95 和一致率计算有固定 fixture。

**验收方式：** 生成至少 40 条冻结样本的预注册清单，所有门槛和公式在首次 C 全量运行前固定。

### U2. 原文片段、竞品注册表归一和封闭实体目录

**目标：** 用纯函数把完整回答转换为可校验的 source map，并从阶段 1 输出构建唯一可信实体目录。

**依赖：** U1 的 fixture 合同。

**涉及文件：**

- `backend/services/AIAnalysisSourceMapService.js`（新增）
- `backend/services/AIEntityCatalogService.js`（新增）
- `backend/services/AICompetitorRegistryResolverService.js`（新增）
- `backend/tests/AIAnalysisSourceMapService.test.js`（新增）
- `backend/tests/AIEntityCatalogService.test.js`（新增）
- `backend/tests/AICompetitorRegistryResolverService.test.js`（新增）

**方案：**

- 实现无损逻辑行分段、偏移和 SHA-256。
- 校验 `source_id + surface_form`，展开所有绝对位置并确定性处理重叠。
- 先按原文锚定事实做保守归并、排序并分配 `E001...`；模型边界内不接收竞品表。
- 在阶段 1 完成且 occurrence 已冻结后，用本次运行的竞品注册表快照做精确身份归一，输出 `matched / unmatched / ambiguous`；表外实体必须原样保留。
- 注册表匹配不得改变 `surface_forms`、`source_ids`、绝对位置、提及次数、实体集合或任何关系结论；只能附加稳定身份元数据。
- 在模型边界之后执行目标名称/别名匹配；模型标准名不参与单独命中。
- 对类型冲突、目标歧义和无效表面词返回稳定错误。

**测试场景：**

- 中文、英文、全角、Markdown、表格、连续品牌名、重复表面词和重叠别名。
- `Hikvision / 海康 / 海康威视` 的归并与全部位置计数。
- 产品名 `iVMS-9800 / DSS` 不应被 fixture 当作组织。
- 目标缺失时不因 canonical name 等于目标而命中。
- 两个实体同时命中同一目标别名时失败。
- source map 重建与原文哈希不一致时失败。
- 空注册表、唯一别名命中、别名冲突、纯表外品牌、表内但原文未出现品牌、多个原文实体唯一映射同一 `competitor_id` 但只在阶段 2 后形成 identity group。
- 对匹配前后 occurrence 集合做深比较，证明注册表不能补造、删除或移动任何原文事实。

**验收方式：** 纯函数 fixture 全部通过，任何不存在于原文的实体无法进入实体目录；注册表为空、未命中或有歧义时，已有 grounded 实体仍可继续分析。

### U3. Flash 阶段 1 与最终请求策略

**目标：** 使用固定 Flash 参数稳定生成最小、可锚定的实体提及输出。

**依赖：** U2。

**涉及文件：**

- `backend/services/AIResponseEntityExtractionService.js`（新增）
- `backend/services/AIPlatformRequestService.js`
- `backend/services/AIAnalysisConfigService.js`
- `backend/routes/settings.js`
- `backend/tests/AIResponseEntityExtractionService.test.js`（新增）
- `backend/tests/AIPlatformRequestService.test.js`
- `backend/tests/AIAnalysisSettingsApi.test.js`

**方案：**

- 阶段 1 提示只包含 source map、实体定义和小型输出合同，不含当前问题、目标/竞品/人工真值。
- 请求策略在最终合并后强制写入 Flash、温度 0、关闭思考/搜索和 JSON mode。
- 分析设置保存拒绝非 DeepSeek 或非 `deepseek-v4-flash` 的 v5 正式配置；管理员非关键选项不能覆盖固定键。
- 设置页 prompt 接口返回阶段 1/2 两个提示修订、有效模型、最终请求体摘要和最大调用策略。
- 阶段 1 失败只返回阶段 1 定向修复，不生成关系字段。

**测试场景：**

- 最终 `httpClient.post` 请求体精确断言模型、温度、思考、JSON mode 和无搜索字段。
- 管理员保存 `temperature=0.7`、Pro 或工具搜索覆盖时拒绝或显示被策略覆盖，不能静默生效。
- 提示快照断言不出现目标品牌、别名和竞品字段。
- 对空注册表、正常注册表和加入无关品牌后的注册表分别构建阶段 1 请求，最终 prompt 与 HTTP body 字节级一致。
- JSON 无效、未知字段、错误 source ID、整句 surface form、截断、超时和第二次仍失败。

**验收方式：** 设置页真实测试和直接服务测试都能展示最终 Flash 请求策略，且真实挑战样本阶段 1 无目标幻觉。

### U4. Flash 阶段 2 与字段级修复

**目标：** 对封闭实体目录完成关系、候选顺序、推荐和情绪判断，禁止创造事实。

**依赖：** U2、U3。

**涉及文件：**

- `backend/services/AIResponseSemanticJudgmentService.js`（新增）
- `backend/tests/AIResponseSemanticJudgmentService.test.js`（新增）

**方案：**

- 阶段 2 输入只包含实体 ID、有效名称/表面词、source ID、问题和目标实体 ID；不得包含完整竞品表、`competitor_id`、注册表匹配状态或“已知竞品”标签。
- 校验关系覆盖集合、候选组、推荐和情绪状态机。
- 将证据 ID 转为程序提取的原文片段；模型 reason 只作解释，不作为指标事实。
- 修复协议只允许替换已声明字段；完整重校验后才能通过。
- 目标为空时，程序可确定性生成 `sentiment.not_applicable`，不要求模型评价一个不存在的品牌。

**测试场景：**

- 未知/重复/遗漏实体 ID。
- 跨类别错误压平、无序集合误排、推荐缺证据。
- 目标不存在却返回情绪或推荐时拒绝。
- evidence source ID 存在但不包含相应实体的误引用。
- 修复覆盖未授权字段、创建实体或重复路径时拒绝。
- 注册表中存在但原文未出现的品牌不能进入关系输出；表外 grounded 品牌可以判为竞品；表内 matched 品牌也可以根据当前问题判为 `non_competitor`。
- 相同 grounded 目录搭配空、正常和冲突注册表时，阶段 2 实体投影与请求体字节级一致，关系差异不能由注册表身份先验造成。

**验收方式：** 所有进入最终结构的语义字段只引用封闭 ID，并能从原回答生成精确证据。

### U5. v5 编排、指标计算与持久化

**目标：** 将确定性目标事实轨与两个 Flash 阶段组合成 `AIResponseAnalysisService.analyze` 的唯一候选实现，保持正式调用方的事务原子性，同时允许结构内字段级部分状态。

**依赖：** U2–U4。

**涉及文件：**

- `backend/services/AIResponseAnalysisService.js`
- `backend/services/GeoMetricSemanticsService.js`
- `backend/services/ProjectRunService.js`
- `backend/models/QuestionSetRun.js`（若现有运行快照字段需扩展）
- `backend/models/QuestionRecord.js`（若单问题需保存独立快照身份）
- `backend/models/VisibilityMetric.js`（仅在情绪空值审计需要时修改）
- `backend/tests/AIResponseAnalysisV5.test.js`（新增）
- `backend/tests/AIResponseAnalysisService.test.js`
- `backend/tests/ProjectRunService.test.js`

**方案：**

- 编排 source map、独立目标事实扫描、开放实体抽取、目录构建、冻结注册表快照身份归一、目标语义判断、开放竞品判断和 calculate。
- 单问题、问题集、自动监测和 analysis-only 均绑定不可变注册表快照；analysis-only 必须复用原记录的 `version/hash/entries`，不能读取重试时的实时表。
- 删除语义证据自动补齐、未确认短别名派生和程序性情绪覆盖；坏竞品项只隔离/未解决。
- 将每阶段 attempts、usage 和 duration 汇总为有界诊断。
- 更新分析租约预算：正常 2 次、最坏 4 次调用，避免 worker 在合法分析期间失去租约。
- 保持 `buildVisibilityMetricPayload → transaction → persistVisibilityMetric + completed` 的原子边界；事务原子不等于三轨必须全成功。
- 添加新错误码到用户安全文案和报告诊断。
- 用 v5 结构状态排除未提及目标的情绪占位。

**测试场景：**

- 两阶段 happy path、阶段 1 修复、阶段 2 修复、四次上限。
- 阶段 1 或阶段 2 部分失败时，目标事实仍写入；受影响语义字段为 `unresolved/invalid`，开放竞品为 `partial/unavailable`。
- 目标未提及、目标提及、多候选组和零竞品。
- analysis-only 保持原回答哈希、引用和配额。
- 原运行后修改竞品表再执行 analysis-only，仍使用原快照；新运行使用新快照哈希，但相同回答的阶段 1 请求保持不变。
- 事务失败和执行租约失效不产生部分写入。

**验收方式：** 服务级 fixture 和真实 Flash 单条测试返回 v5；开放竞品遗漏不会阻止目标事实写入，真正的目标事实错误不会产生对应业务指标，且事务失败不留下半条记录。

### U6. 报告、设置与数据往返

**目标：** 用户能区分 v5、看到阶段诊断和证据，CSV 往返不丢失 ID 合同。

**依赖：** U5。

**涉及文件：**

- `backend/services/QuestionSetRunService.js`
- `backend/services/QuestionSetRunCsvService.js`
- `backend/routes/settings.js`
- `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
- 与设置页分析配置对应的前端组件
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/QuestionSetRunCsvValidation.test.js`
- `backend/tests/AIAnalysisSettingsApi.test.js`
- 对应前端测试

**方案：**

- v5 报告展示三轨状态、两个 Flash 阶段的尝试和失败位置，不暴露原始模型输出。
- 实体、关系、候选和推荐以最终程序结构展示，证据由 source ID 解析。
- v5 主张显示 `not_collected`，历史 v4 正常显示旧主张。
- API、CSV 和 UI 分别展示推荐、排名、情绪的字段状态；聚合仅纳入 `assessed`。开放 SOV 显示“仅基于本次已发现实体”，并展示 scope/completeness、未解决数和隔离数。
- 注册表 `matched / unmatched / ambiguous` 只作为中性身份诊断展示，不使用“未知品牌”“非竞品”等误导文案，也不改变排序或推荐。
- CSV 导入按版本选择 validator，完整保留 `entity_id`、`source_id`、注册表快照 `version/hash`、每实体匹配状态和诊断。
- 设置页明确显示“正式结构化分析固定使用 Flash”，并显示实际请求策略。

**测试场景：**

- v4 历史、v5 完整、v5 目标不适用、v5 目标语义部分未解决、v5 开放竞品 partial/unavailable、v5 目标事实失败。
- v5 CSV 导出再导入结构相等；未知 ID 和哈希不匹配拒绝。
- CSV 往返不丢失表外实体；注册表状态不能泄漏进阶段 2 判断字段或改变开放 SOV 分母。
- 前端长错误信息有界、移动端可读，历史标签不误称当前版本。

**验收方式：** API、CSV 和页面同时能正确区分 v4/v5 及三轨/字段状态，所有聚合分母符合状态合同，且 v5 证据可从原回答复核。

### U7. 真实 A/B/C/D 对比与决策

**目标：** 用真实 Flash 数据证明或否定 v5 可上线性。

**依赖：** U1、U3–U6。

**涉及文件：**

- `backend/scripts/geoFlashStructuredBenchmark.js`
- `backend/tests/GeoFlashStructuredBenchmark.test.js`
- `work/geo-flash-structured-2026-08-05/`（运行产物，不提交）

**方案：**

- 按 7.4 运行各实验臂，D 能力不满足时明确退出。
- 自动生成逐样本和汇总报告、失败簇、配对差异、置信区间、Token/延迟和门槛判定。
- 人工抽查全部错误及固定比例成功样本，识别 wrong-but-schema-valid。
- 冻结语料增加“表内 + 表外同时出现”“纯表外”“空注册表”“表内品牌未出现”夹具，并对同一答案切换注册表快照做不变性对照。
- 报告写明模型、最终请求体摘要、prompt revision、语料哈希和代码提交。

**测试场景：**

- 用户本次“大工业园区”回答必须在目标未提及层通过，且目标假阳性为 0。
- 六类用户问题全部进入结果。
- 同一答案三次输出核心指标签名比较。
- 报告阶段 1 请求哈希不变率、注册表匹配率/歧义率、表外保留率和表内未出现品牌生成数；匹配率仅作主数据质量诊断。
- 模型请求失败、能力不支持和中断恢复不会被计为成功。

**验收方式：** `COMPARISON-REPORT.md` 对每个预注册门槛给出 pass/fail；任一硬门槛失败即停止硬切。

### U8. 正式硬切与生产入口验收

**目标：** 达标后让全部新分析只走 v5，并从真实入口证明 v4/Pro 未被调用。

**依赖：** U7 全部硬门槛通过。

**涉及文件：**

- `backend/services/GeoMetricSemanticsService.js`
- `backend/services/AIResponseAnalysisService.js`
- `backend/services/ProjectRunService.js`
- `backend/services/QuestionSetRunService.js`
- `backend/services/SchedulerService.js`
- `backend/routes/settings.js`
- 所有相关测试、README、CONTEXT 和当前需求状态文档

**方案：**

- 更新当前契约常量和所有创建记录/运行的默认版本。
- 删除 v4 prompt、运行时 parser、repair 分支、默认值和测试-only 之外的生产引用；保留历史 v4 读取 validator。
- 不保留运行时 feature flag 或错误 fallback。
- 按正式 Git Bundle/systemd 流程发布，不直接编辑服务器源码。
- 从单问题、问题集、自动监测和 analysis-only 四类入口验证新版本，并用请求审计证明实际模型和调用阶段。

**测试场景：**

- 新记录和运行全部写 v5。
- v5 失败不会调用 v4 或 Pro。
- v4 历史报告和 CSV 仍可读。
- 代码搜索不存在 v4 作为“当前/默认/回退”的生产引用。
- 生产服务重启、健康、登录后报告和错误详情正常。

**验收方式：** 入口级证据同时证明 v5 被调用、v4 未被调用、Flash 参数生效、旧运行时已删除；完成后才把需求目录改为 `closed`。

### U9. 目标映射歧义隔离

**目标：** 消除 S55 类多实体命中目标别名导致的整条失败，保持目标事实确定性完成。

**依赖：** U2、U5 已完成能力。

**涉及文件：** 实体目录、v5 编排器、目标事实/目标语义状态测试和真实 benchmark fixture。

**方案：** 把 `target_mapping` 从 `target_fact` 拆出；多个实体命中时保存 `ambiguous` 和候选实体 ID，不任选、不自动合并、不抛整条错误。目标语义标为 unavailable，目标 presence/count 正常持久化。

**测试场景：** 同时出现“广拓（Gato）”与“上海广拓信息技术有限公司”；目标未出现；唯一实体命中；多个实体存在但只有一个覆盖目标 occurrence。

**验收方式：** S55 回归不再返回 `analysis_target_mapping_ambiguous`，真实 Flash 定向 3/3 保留完整目标事实。

### U10. `semantic_evidence_v2` 与定向修复

**目标：** 支持实体列举与推荐/情绪/关系语句分处不同片段的真实回答，同时保持语义证据不可伪造。

**依赖：** U3、U4 已完成能力。

**涉及文件：** 阶段 2 prompt/schema、证据校验器、修复提示、v5 结构版本分派及相关测试。

**方案：** 模型输出 `semantic_context_source_ids`；程序从冻结实体目录投影 `entity_occurrence_source_ids` 并组装证据包。校验两者的角色、ID 闭集和断言一致性，但不再要求语义片段逐字重复实体表面词。定向修复向模型展示错误断言、source map 和 occurrence IDs，仍失败则字段降级。

**测试场景：** 实体与推荐同片段；实体先列举、后用短名推荐；集合推荐；无效或未知 semantic source ID；模型不提供上下文；修复仍失败。

**验收方式：** 程序生成 semantic context 数为 0，已知机械性 evidence-reference fixture 全部按字段正确 assessed 或降级，不影响 target fact。

### U11. 真值与评测合同审计

**目标：** 消除补充标注未复核、幸存者偏差和 grounding 代替实体正确性的评测缺口。

**依赖：** 无，可与 U9/U10 并行准备。

**涉及文件：** 冻结语料 labeling/truth、benchmark 指标与报告文档；真实语料仍保存在忽略目录。

**方案：** 按数据集版本记录人工复核；推荐、排名、情绪和已输出关系分别凑足至少 20 个盲标实例；增加实体 precision/recall/canonicalization、阶段 2 降级率和机械性证据错误率。整体语义指标包含 unresolved，不只评价 assessed 幸存样本。

**测试场景：** 旧语料已确认但补充语料待复核；组合实体；同品牌短名/全名拆分；某语义维度不足 20。

**验收方式：** benchmark 在真值不足时明确 `NOT EVALUABLE`，不能输出 PASS；每个参与门禁的数据集有独立确认记录。

### U12. 定向探针与全量新门禁

**目标：** 先低成本选择可行证据合同，再对最终候选执行不可变的完整对比并决定是否解锁 U8。

**依赖：** U9、U10、U11。

**涉及文件：** benchmark 候选配置、定向样本 manifest、独立 v2 比较报告和 issue 014/015。

**方案：** 先对 10–15 条已知失败样本各运行 3 次，对比 prompt-only 与 `semantic_evidence_v2`；探针通过后冻结 `three_track_partial_v2`，再对相同 41 条主语料、补充真值集和 A/B/C 全量重跑。旧 009 缓存、结果和报告只读。

**测试场景：** S55、推荐跨片段、情绪跨片段、关系证据、长回答和多实体回答。

**验收方式：** 探针先达到目标事实 100%、机械性证据引用错误 0、核心稳定率 ≥99%；完整重跑随后满足全部预注册门槛并取得明确人工批准，才解锁 U8。

## 9. 验收标准

- AC-001：Given 目标品牌只存在于任务配置、不存在于回答，When 分析运行，Then 阶段 1 请求不含目标信息，`target_fact.status=complete`、`brand_mentioned=false`，且不写虚假目标提及。
- AC-002：Given Flash 返回不存在的竞品表面词，When 阶段 1 校验与一次定向修复仍失败，Then 该行进入 `quarantined_items`、不进入指标，其他有效实体和目标事实继续完成。
- AC-003：Given 阶段 1 生成有效实体目录，When 阶段 2 返回未知实体 ID，Then 该项被拒绝且不能新增实体；对应竞品轨或字段标为 partial/invalid，不连带清空目标事实。
- AC-004：Given 目标未出现，When 语义阶段完成，Then 情绪为 `not_applicable`，推荐和排名为空，数据库兼容占位不进入聚合。
- AC-005：Given 同一候选类别并列列举多个品牌，When 阶段 2 判断，Then 可保存无序候选组但不产生品牌排名。
- AC-006：Given 关系覆盖缺失，When 语义阶段结束，Then 缺失实体进入 `unresolved_entity_ids`；Given 已返回关系证据无效且修复失败，Then 该关系隔离。两种情况均不使目标事实失败，也不得自动补证据。
- AC-007：Given 管理员保存 Pro、非零温度或搜索参数，When v5 配置生效，Then 接口拒绝不合法配置或固定策略覆盖并明确展示，最终请求不能静默使用该值。
- AC-008：Given 完整原回答过长，When 预估超过上下文，Then 原文不截断，`target_fact` 仍完成；目标语义和开放竞品标为 `unavailable` 并记录 `analysis_input_too_long`，不得分片后拼接这些指标。
- AC-009：Given 40 条冻结真实回答和人工真值，When A/B/C 各运行 3 次，Then 报告按预注册公式计算全部门槛，不遗漏失败输出。
- AC-010：Given C 任一硬门槛失败，When 评审上线，Then v5 不设为默认，生产保持当前 v4，文档明确“尚不可切换”。
- AC-011：Given C 全部门槛通过并批准硬切，When 从四类正式入口运行，Then 新记录均为 v5、模型均为 Flash，v4 和 Pro 调用数均为 0。
- AC-012：Given 正式硬切完成，When 搜索代码、配置和当前文档，Then 不存在 v4 运行时、隐藏开关、fallback 或把 v4 写成当前正式流程的说明。
- AC-013：Given 推荐、排名或情绪为 `unresolved/invalid/not_applicable`，When API、CSV、页面和聚合运行，Then 该字段不进入对应已判断分母，也不被显示为未推荐、中性或无排名。
- AC-014：Given 开放发现产生 SOV，When 持久化与展示，Then 使用 `contextual_competitor_mentions_sov_v2_scoped` 并携带 `observed_only / open_discovery / not_proven`；历史 v1 不与其静默混算。
- AC-015：Given 全部输入有效的冻结回答，When C 重跑 3 次，Then `target_fact` 可用率、目标出现/次数准确率和重复一致率均为 100%，被保留实体与证据 grounding 为 100%，自动语义补证据数和未确认派生别名影响指标数均为 0。
- AC-016：Given 同一问题、回答和目标配置，以及空、正常、加入无关品牌三种竞品注册表快照，When 构建阶段 1 请求，Then 最终 prompt、消息和 HTTP body 字节级一致，请求哈希一致率为 100%。
- AC-017：Given 回答同时出现注册表内品牌和表外品牌，When 完成身份归一，Then 两者都保留在封闭实体目录；前者可为 `matched`，后者为 `unmatched`，均继续进入相同的阶段 2 关系判断。
- AC-018：Given 竞品注册表为空，When 分析有效回答，Then 开放发现、目标事实和目标语义仍可执行，注册表未命中不产生失败或附加模型调用。
- AC-019：Given 注册表包含回答中未出现的品牌，When 完成任一阶段，Then 该品牌不能产生实体、span、提及、证据、关系、推荐、排名或 SOV 贡献。
- AC-020：Given grounded occurrence 集合已经冻结，When 注册表解析返回 `matched / unmatched / ambiguous`，Then 解析前后的实体 occurrence、source ID、绝对位置和提及次数深度相等；歧义不得猜测或删除实体。
- AC-021：Given 阶段 2 判断当前问题中的竞品关系，When 构建模型请求，Then 请求中不存在完整注册表、注册表标准名、`competitor_id`、匹配状态或“已知竞品”标签；同一 grounded 目录在不同注册表下的阶段 2 实体投影字节级一致，matched 与 unmatched 实体适用同一关系 schema 和校验规则。
- AC-022：Given 原运行完成后管理员修改竞品表，When 对原记录执行 analysis-only，Then 使用原运行冻结快照；新运行使用新快照，但相同回答的阶段 1 请求不变。
- AC-023：Given 正常、一次阶段 1 修复、一次阶段 2 修复和双阶段各一次修复，When 统计模型调用，Then 分别为 2、3、3、4 次；注册表命中、未命中或歧义均不增加调用次数。
- AC-024：Given 同一目标品牌的短名、英文名和公司全称映射到多个 grounded 实体，When 构建目标映射，Then `target_fact.status=complete`、`target_mapping.status=ambiguous`、`target_entity_id=null`，仅目标语义不可用，整条分析不失败。
- AC-025：Given 一个实体在 L005 出现、在 L019 被明确推荐，When Flash 返回该推荐，Then最终证据包包含 occurrence L005 与 semantic context L019；校验不要求 L019 重复实体表面词。
- AC-026：Given semantic context ID 未知、为空或不支持断言且定向修复仍失败，When 编排完成，Then 只把对应字段/竞品项标为 unresolved/invalid；程序不得自动选择上下文，target fact 保持 complete。
- AC-027：Given 新增补充真值仍为待复核或某语义维度少于 20 个实例，When benchmark 汇总，Then 对应门禁为 `NOT EVALUABLE`，不得用 assessed 幸存样本准确率宣布 PASS。
- AC-028：Given grounded 组合字符串可以逐字定位但错误合并多个品牌，When 评价实体质量，Then grounding 仍单独报告且该实体在 precision/canonicalization 中计错。
- AC-029：Given v2 定向探针任一硬门槛失败，When 决定是否执行全量实验，Then 停止并保留 010 阻塞；不得直接消耗全量调用或改写 009。
- AC-030：Given v2 探针通过，When 执行独立全量 A/B/C，Then 使用新缓存键、修订号和报告，不覆盖 009；全部门槛通过并经人工批准后才允许开始 U8/010。

## 10. 测试与验证计划

### 10.1 单元测试

- source map 无损性、偏移、哈希和稳定 ID。
- 实体表面词精确定位、非重叠计数、保守归并，以及独立目标名称/别名原文扫描。
- 两阶段 JSON/schema/ID/evidence 校验，坏竞品行隔离、关系未解决和目标语义字段状态转换。
- `target_mapping` 独立状态机，以及多个目标实体命中不影响 `target_fact` 的 S55 回归。
- `semantic_evidence_v2` 双角色校验：occurrence 程序投影、semantic context 模型提供、跨片段组合、未知 ID 和禁止程序补语义上下文。
- 目标情绪状态机、候选组和推荐计算。
- 字段级修复授权边界与四调用上限。
- 指标计算保留 SOV 数学公式，但输出 v2 scope/status/completeness 并阻止与历史 v1 混算。
- 禁止自动语义证据补齐、未注册别名影响指标和 `unresolved` 进入业务分母的回归测试。
- 竞品注册表独立性十二项回归：表内+表外、纯表外、空表、表内未出现不生成、唯一别名归一、别名歧义不猜、unmatched 保留、目标事实不受影响、阶段 2 不接收注册表标签、证据 occurrence 不变、开放 SOV 同等纳入、重试不增调用。
- 对比指标和置信区间计算。

### 10.2 服务与集成测试

- 用可编程假模型覆盖所有成功、失败和修复路径。
- 在 `AIPlatformRequestService` 的 HTTP 客户端边界捕获最终请求体。
- `ProjectRunService` 原子写入、租约、失败隔离和 analysis-only 复用。
- 四类入口冻结相同形状的注册表快照；analysis-only 在实时竞品表变化后仍复用原快照。
- `QuestionSetRunService`、CSV、设置 API 和历史兼容。
- 全部后端标准测试、前端 lint、TypeScript 和生产构建。

### 10.3 真实模型验证

验证分三层，不能互相替代：

1. **可行性探针**：已完成真实挑战样本的 v4、降温 v4、阶段 1 和完整 v5 调用。
2. **正式对比基线**：旧合同和 `three_track_partial_v1` 的两轮 A/B/C 均已完成并明确不批准硬切；结果保留为历史证据，不覆盖。
3. **v2 定向探针**：修复后先对 10–15 条已知失败样本比较 prompt-only 与 `semantic_evidence_v2`，各重复 3 次；未通过不进入全量实验。
4. **v2 全量门禁**：探针通过后按 `three_track_partial_v2` 重跑 A/B/C，并使用每项至少 20 个已复核实例作语义结论。
5. **真实入口验收**：尚未执行。只有 v2 全量门禁全部通过后才能硬切，并从四类入口证明 v5 实际生效、v4 未调用。

### 10.4 生产验证证据

- 部署提交、服务器 `HEAD`、工作区状态和 systemd 状态。
- 公网 `/api/ready` 与登录后页面。
- 每类入口产生的记录 ID、`analysis_contract_version`、`analysis_model`、分阶段诊断和指标结果。
- 请求审计中的有效模型、温度、思考和搜索状态；不得包含 API Key。
- v4/Pro 生产调用计数为 0 的日志或测试 spy 证据。
- 历史 v4 报告只读回归。

## 11. 发布、回滚与观测

### 11.1 发布门禁

只有以下条件全部满足才允许发布：

- PRD/Tech Spec 评审完成。
- v5 自动化、全量回归和构建通过。
- 真实 A/B/C 报告全部硬门槛通过。
- 实验语料、真值和输出可追溯，未泄露敏感信息。
- v4 运行时清理和历史读取边界已完成代码审查。
- 正式入口验收计划和失败停止条件明确。

### 11.2 发布策略

- 本地实现、测试、提交和推送。
- 使用项目正式 Git Bundle workflow 快进服务器 `main` 并执行正式部署入口。
- 部署后立即验证健康、配置和四类入口。
- v5 作为唯一默认路径，不启用双写或隐式 fallback，避免同一回答产生两套可竞争的指标事实。

### 11.3 回滚

切换后发现一般问题，默认直接修复 v5。不得通过配置或隐藏分支把单条失败静默交给 v4/Pro。

若出现大面积无法生成指标且需要版本级回滚，必须：

- 明确说明触发原因、影响记录范围和当前正式路径；
- 使用已验证发布版本进行显式部署回滚，而不是代码内 fallback；
- 保留切换期间 v5 记录的版本身份，不改写为 v4；
- 定义重新切回 v5 的修复项、门槛和退出条件。

### 11.4 生产观测

按分析版本、阶段和模型观察：

- 完成率、首次通过率、修复率、失败率。
- 错误代码和失败字段分布。
- 目标未出现比例与目标假阳性人工抽检。
- 每阶段调用数、Token、median/P95 延迟。
- analysis-only 重试成功率。

生产观测不得自动降低门槛或恢复旧路径。超过告警阈值时停止批量重试并调查 v5。

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 分成两次调用增加延迟 | 单条运行变慢 | 缩小每阶段提示和输出；设置 P95 ≤ 2× 基线的发布门槛 |
| 阶段 1 漏实体但结构合法 | 开放 SOV 分母和竞品关系不完整 | 明示 `observed_only / open_discovery / not_proven`；报告 recall、Jaccard、未解决率和分母波动，不把遗漏升级为整条失败 |
| canonical name 错误归并 | 多个品牌被合并或拆分 | 原文 span 保留；canonical 仅展示，未经注册/原文证明的派生别名不得影响扫描或指标 |
| 目标别名未配置 | 目标假阴性 | 将真实别名作为品牌资料质量问题暴露；不使用模型猜测兜底 |
| 阶段 2 reason 正确但 semantic context 不支持结论 | 审计结论不可信 | occurrence 与 semantic context 分轨校验；上下文必须存在且支持断言，人工语义基线检查 wrong-but-schema-valid |
| 单一证据数组同时承担实体出现与语义结论 | 合法的跨片段推荐/关系被机械拒绝并随机降级 | 使用 `semantic_evidence_v2` 分离 occurrence 与 semantic context；程序只能投影前者，后者仍由 Flash 提供 |
| 多个 grounded 实体命中同一目标别名 | 已证明的目标事实被错误中断 | 独立 `target_mapping` 状态机；歧义只关闭目标语义，不抛整条错误、不猜实体 |
| 只评价 assessed 幸存样本 | 大量 unresolved 被排除后产生虚假的 100% | 报告整体可用率与降级率；每个语义维度至少 20 个已复核真值，否则 NOT EVALUABLE |
| strict tool beta 能力变化 | 实验 D 不稳定 | C 不依赖 D；D 不支持时明确退出，不运行时 fallback |
| 管理员请求参数覆盖固定策略 | 重现 0.7 温度偏差 | 固定键最后合并、设置接口校验、最终 HTTP body 测试与运行诊断 |
| 最坏 4 次调用超过执行租约 | 迟到 worker 被 fencing 拒绝 | 更新分析时间预算和租约测试；保持外部调用不在事务内 |
| v5 与历史 v4 字段不同 | 报告/CSV 回归 | 显式版本分派，不用字段存在性猜版本；历史 fixture 回归 |
| 小样本看似 100% | 错误上线判断 | 至少 40 条 × 3、预注册门槛、置信区间、失败分层和人工抽检 |
| 为追求完成率放松校验 | 虚假指标进入报告 | 100% grounding 和 0 无效写入为不可谈判硬门槛 |
| 兼容标量把未知伪装成业务否定 | 推荐率/情绪/排名分母被污染 | `analysis_structure` 状态为权威；审计全部消费者，必要时新增状态列后再硬切 |
| 程序自动补语义证据或覆盖结论 | 表面完成率上升但事实不可审计 | 自动补证据、派生别名影响指标和程序性情绪覆盖均设为 0 容忍测试门槛 |
| 把竞品注册表放进阶段 1 提示 | 模型只找已知品牌，表外品牌召回下降 | 阶段 1 请求体禁止任何注册表数据，并做空表/非空表请求哈希不变性测试 |
| 把 `matched` 当作竞品关系先验 | 表内品牌被默认判竞品，表外品牌被忽略 | 阶段 2 不接收 `competitor_id` 或匹配状态；身份和当前问题关系使用独立字段与测试 |
| 注册表解析器补实体或合并证据 | 表面完成率提高但原文事实被改写 | resolver 只附加身份元数据；解析前后 occurrence 深度相等，表内未出现品牌生成数必须为 0 |
| analysis-only 使用实时竞品表 | 同一回答重试结果随配置漂移，无法审计 | 运行时冻结 `version/hash/entries`；analysis-only 强制复用原快照，新运行才读取新快照 |

## 13. 方案依据与外部参考

本方案遵循以下已公开实践，但不把供应商声明替代本地真实验证：

- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)：JSON mode 用于约束输出为 JSON；业务字段真实性仍需应用校验。
- [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)：strict 模式可以约束 JSON Schema 子集，但属于 beta 能力，且要求严格 schema 形状。
- [DeepSeek Chat Completion API](https://api-docs.deepseek.com/api/create-chat-completion)：请求参数具有供应商默认值，因此应用必须检查最终 HTTP body，而不是假定省略字段等于确定性配置。
- [OpenAI Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/)：严格 schema 能解决结构匹配，但不能消除字段值错误；复杂任务仍应拆分并提供校验。
- [Microsoft TypeChat](https://github.com/microsoft/TypeChat)：采用“模型输出 → 类型校验 → 针对错误修复”的边界，而不是信任一次生成。
- [Instructor](https://github.com/567-labs/instructor) 与 [Guardrails](https://github.com/guardrails-ai/guardrails)：将 schema 验证、字段验证和定向重试作为结构化模型调用的一部分。
- [Grammar-Constrained Decoding](https://arxiv.org/abs/2305.13971)：语法约束主要控制可生成形状，仍需单独评估任务正确性。
- [JSONSchemaBench](https://arxiv.org/abs/2501.10868)：约束覆盖、效率和输出质量应分别衡量，支持本方案把 parse、schema、grounding 和语义准确率拆开报告。

第一性原理结论是：结构化输出可靠性至少包含四层——语法、schema、引用完整性、语义真实性。越靠后的层越不能由 JSON Schema 单独保证；必须通过缩小任务、封闭引用、程序不变量和真实人工基线共同建立。

## 14. 假设与开放问题

### 14.1 已确认假设

- 正式分析必须继续使用 `deepseek-v4-flash`，不以 Pro 作为解决方案。
- 完整原回答和目标品牌别名可以从现有记录与品牌资料读取。
- v5 可以保留现行 SOV 数学公式，但开放发现结果必须升级为带 scope/status/completeness 的 v2 语义版本；历史 v1 保持只读。
- 用户接受增加第二次正常模型调用，但要求用对比证明质量和成本可接受。
- 现有 `brand_competitors` 继续作为项目级已核验身份注册表；它不是完整竞品知识图谱，也不是模型抽取候选白名单。

### 14.2 非阻塞开放问题

- strict tool 实验 D 是否得到当前供应商账户和模型支持，只能通过能力探针确认。
- `VisibilityMetric.sentiment` 的非空兼容占位是否被所有消费者正确排除，需要在 U5 做调用方审计；若不能证明，应新增迁移允许空值。
- 40 条语料中若某一语义标签实例不足 20，需要补充真实回答而不是降低该指标门槛。

## 15. 后续衔接

- Tech Spec path: `docs/active-2026-08-05-002-flash-structured-analysis-reliability/TECH-SPEC.md`
- Validation report: `docs/active-2026-08-05-002-flash-structured-analysis-reliability/validation-report.md`
- 可拆 issue：U1–U7 已由 001–009 承接；U9–U12 对应 011–015。010/U8 只能在 015 的 `three_track_partial_v2` 全部门槛通过并人工批准后开始。
- 建议下一个 issue：先执行 011，消除 S55 的确定性目标映射失败；012 与 013 随后完成证据合同和真值审计，014 做小样本真实 Flash 探针，015 做独立全量门禁。
- 是否适合 TDD：适合。source map、ID 合同、验证器、指标计算、请求体和报告兼容均应先写失败测试；真实 Flash 基线作为单元测试之外的独立验收层。
- 当前正式路径：仍为 `ai_structured_v4` / `geo_metric_input_v4`，默认 DeepSeek 分析配置为 `deepseek-v4-pro`；v5 显式候选路径强制 `deepseek-v4-flash`。v5 未设为默认，v4 运行时代码、兼容和现役调用方尚未删除。

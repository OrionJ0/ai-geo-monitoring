# DeepSeek Flash 结构化分析真实验证报告

> 阅读规则：本报告按时间保留两轮真实实验。首轮旧候选及当时状态是历史证据；issue 001–008 完成后的 `three_track_partial_v1` 结果从“2026-08-05 新合同 41×3”一节开始，是当前硬切判定依据。009 的失败结果保持不可变，后续使用独立 `three_track_partial_v2 / semantic_evidence_v2` 实验，不回写旧报告为 PASS。

## 结论

issue 001–008 已完成，候选 v5 在 41×3 主语料上达到 100% 完成率、目标出现准确率 100%、目标假阳性 0、实体字符串 grounding 100%，成本也通过门槛；但目标核心签名稳定率仅为 95.12%，15 条补充样本完成率为 93.33%。因此它**尚未证明可以替换生产 v4**，009 明确“不批准硬切”，010 保持阻塞。

当前有两个直接技术阻塞：S55 同时出现目标品牌短名与公司全称，被拆成多个 grounded 实体后触发整条目标映射歧义错误；阶段 2 的单一证据数组同时承担实体出现与语义结论证明，造成 73/123（59.3%）主语料机械性 evidence-reference 降级。前者应由独立 `target_mapping` 状态机修复，后者应通过 `semantic_evidence_v2` 分离 occurrence 与 semantic context；二者都不能靠猜实体、放宽原文真实性或恢复自动语义补证据处理。

竞品表边界已经由 issue 003–008 实现并通过自动化不变性测试：复用 `brand_competitors` 作为模型外的已核验身份注册表，阶段 1 继续开放发现，程序在两个模型阶段之间做快照化身份归一，阶段 2 不接收完整表或匹配标签。表外实体保留，表内但原文未出现的品牌不得生成；开放 SOV 仍基于本次回答中已发现、已锚定的相关实体，而不是只统计表内品牌。真实语料本轮使用空注册表，因此自动化请求不变性通过不等于真实非空注册表质量已被全量证明。

因此当前决策为：

- 保留 v5 为显式候选实现，不设为默认。
- 当前正式入口继续使用 `ai_structured_v4` / `geo_metric_input_v4`，当前 DeepSeek 默认分析配置为 `deepseek-v4-pro`。
- v5 候选请求固定 `deepseek-v4-flash`，不回退 Pro、v4 或其他提示词；不要为了满足 Flash 要求单独修改当前 v4 生产基线。
- 需求目录保持 `active`，不得关闭或宣称已正式解决。

## 当前 API 分析链路与竞品表作用

当前生产正式链路仍是 v4：一次完整分析调用，失败时最多一次修复调用，即通常 1 次、最坏 2 次；它没有把项目竞品表传给结构化分析模型。候选 v5 是两个 Flash 阶段，阶段 1 做开放实体抽取，阶段 2 只对已锚定实体做语义判断；每阶段最多一次定向修复，因此通常 2 次、最坏 4 次。竞品注册表匹配是纯程序步骤，不得增加任何模型调用。

现有 `brand_competitors` 已有实际用途：保存项目级核验名称/别名/官网，支撑配置冲突校验、引用归属、提示建议和运行快照。它不是开放抽取白名单，因此现役 v4 和候选 v5 都不存在“因为表中没有就不抽取”的直接偏置；v5 候选已经具备受不变量约束的模型外 resolver 和四类入口/analysis-only 快照合同，但尚未通过硬门槛成为正式默认。

批准后的目标链路为：

```text
完整回答
  ├─ 程序：独立目标品牌原文扫描
  └─ Flash 阶段 1：开放实体抽取（请求中无竞品表）
       └─ 程序：原文锚定与冻结 occurrence
            ├─ 程序：用本次运行快照做身份归一
            │    ├─ matched：映射稳定 competitor_id
            │    ├─ unmatched：保留表外实体
            │    └─ ambiguous：保留实体，不猜身份
            └─ Flash 阶段 2：使用匹配前 grounded 投影判断关系/推荐/排名/情绪
                 └─ 程序按 entity_id 回接身份映射，不回写模型结论
```

该设计把两个问题分开：注册表回答“这个原文实体是否与已核验身份相同”，阶段 2 回答“这个实体在当前问题中是否构成竞品/推荐/候选”。身份命中不能替代关系判断，关系判断也不能反向写入注册表。

## 独立模型审查

根据用户授权，本次使用 Claude CLI 的 safe mode 并显式指定 `claude-sonnet-4-5` 对方案做了独立审查。审查意见与本方案一致：保留并重定义现有表为 verified registry；禁止将完整表注入阶段 1 或阶段 2；采用“开放抽取 → 程序匹配 → 封闭关系判断”；保留 unmatched；表中缺失不得触发附加调用；正常 2 次、最坏 4 次。

这份审查只用于发现设计缺口，不作为实现或真实模型测试通过的证据。可行性仍必须由本地自动化不变量测试、冻结语料对比和正式入口验收证明。

## 真实输入与方法

> 本节至“审查发现与下一步”记录首轮候选实验及当时实现状态；其中“尚未实现/尚未接入”等陈述是历史时点事实。当前状态以本文开头和后续 `three_track_partial_v1` 第二轮结果为准。

- 冻结语料：既有人工确认的 40 条真实完整回答，加用户本次提供的“大工业园区”长回答，共 41 条。
- 重复次数：每条、每实验臂 3 次，共 123 次/臂。
- A：当前 v4 与当前请求参数。
- B：当前 v4，显式 `temperature=0`。
- C：v5 两阶段 JSON mode，显式 `temperature=0`、关闭思考和搜索。
- 所有实验臂的分析模型均为 `deepseek-v4-flash`。
- 输入使用相同冻结问题和完整回答，不重新访问豆包或 DeepSeek 网页。
- 完整签名按预注册定义包含目标字段、有效实体/提及、竞品关系集合、排名、推荐、情绪和 SOV；没有在看到结果后缩小门槛口径。

原始运行证据保存在本地忽略目录：

- A/B：`work/geo-flash-structured-v4-ab-2026-08-05/`
- C：`work/geo-flash-structured-v5-final-2026-08-05/`
- S24 修复后真实复测：`work/geo-flash-structured-v5-s24-normalization-2026-08-05/`
- S12/S27 目标指标回归：`work/geo-flash-structured-v5-target-metric-retest-r2-2026-08-05/`

## A/B/C 结果

| 指标 | A：v4 当前参数 | B：v4 温度 0 | C：v5 分阶段 |
| --- | ---: | ---: | ---: |
| 有效完成 | 101 / 123 | 103 / 123 | 121 / 123 |
| 完成率 | 82.11% | 83.74% | 98.37% |
| 失败数 | 22 | 20 | 2 |
| 相对 A 失败减少 | — | 9.09% | 90.91% |
| 完整签名重复一致 | 36 / 88 | 71 / 99 | 89 / 119 |
| 完整签名稳定率 | 40.91% | 71.72% | 74.79% |
| 目标字段签名稳定率 | 73.86% | 84.85% | 100% |
| Token 中位 | 7,781 | 7,755 | 5,560 |
| P95 总耗时 | 19,679 ms | 21,227 ms | 11,858 ms |

说明：各臂只有成功结果才能形成重复比较对，因此稳定率分母不同。C 相对 A 的 Token 中位为 71.46%，P95 延迟为 60.26%，均通过成本门槛；温度从默认值降为 0 只把完成率提高 1.63 个百分点，证明温度不是根因。

## 目标品牌人工真值

C 的 121 条有效结果经现有人工真值比较：

| 字段 | 结果 |
| --- | ---: |
| `brand_mentioned` | 121 / 121，100% |
| `brand_mentions` exact-match | 121 / 121，100% |
| `brand_recommended` | 121 / 121，100%，FP=0，FN=0 |
| `brand_rank` | 24 / 24，100% |
| `sentiment` | 60 / 60，100% |

这些历史结果证明分阶段方向有能力保护目标指标，但当时的候选仍含待删除的程序自我修复路径，因此不能直接当作 `three_track_partial_v1` 的通过证据，也不能替代新合同的字段状态和真实性门禁。

## 用户挑战样本

用户提供的“大工业园区用什么安防设备比较好？”回答没有出现目标品牌“广拓”。

- A：3 / 3 失败，均因模型把不存在的“广拓”放入实体/表面词。
- B：3 / 3 失败，说明 `temperature=0` 不能消除任务上下文污染。
- C：3 / 3 成功；`brand_mentioned=false`、`brand_mentions=0`、无推荐、无排名、情绪不适用。

这说明 v5 的“阶段 1 不接收问题和目标品牌、程序后置匹配目标”设计确实解决了本次具体假阳性失败链路。

## 修复后真实复测

S24 是目标品牌未出现的真实回答。原 C 全量运行有 1 次因 Flash 多输出了目标情绪而失败。程序现在以已验证的 `target_entity_id=null` 为确定事实，把目标情绪归一为 `not_applicable`。

修复后重新发起 3 次真实 Flash API 请求：

- 完成率：3 / 3。
- 目标出现准确率：3 / 3，假阳性 0。
- Token 中位：4,608。
- P95 耗时：7,628 ms。
- 完整签名稳定率：1 / 3；差异仍来自竞品实体/关系集合。

该复测证明归一规则消除了这类结构失败，同时也再次暴露完整语义稳定性问题。

### 竞品允许遗漏后的 S05 复测

S05 在首轮 C 中曾因关系没有恰好覆盖全部非目标实体而返回 `analysis_relation_incomplete`。按用户确认的新合同修改后，对同一冻结问题和回答重新发起 3 次真实 `deepseek-v4-flash` 请求：

- 完成率：3 / 3。
- 目标核心签名：3 / 3 配对一致。
- 每次状态：`competition_analysis_status=partial`、`competition_scope=open_discovery`、`competition_completeness=not_proven`。
- 每次已解决关系：7 个；未解决实体：4 个，明确保存于 `unresolved_entity_ids`。
- 竞品集合 Jaccard 中位：1.0。
- Token 中位：5,975；P95 耗时：7,207 ms。

这证明“关系遗漏不报错、已解决事实继续使用、未解决范围显式暴露”的合同可以在真实 Flash 输出上运行。它是定向复测，不替代新合同下的 41×3 全量重跑。

## 首轮历史门禁判定

下表按首轮实验当时预注册口径原样保留；其中“完整签名稳定率”在新合同中已降为开放竞品诊断项，不能继续作为整条完成门槛。

| 门禁 | 要求 | 当前结果 | 判定 |
| --- | --- | --- | --- |
| 模型 | 只用 `deepseek-v4-flash` | 满足 | PASS |
| 完成率 | 至少 118 / 120，且无样本 3 / 3 全失败 | 121 / 123；无样本 3 / 3 全失败 | PASS |
| 相对失败减少 | A 失败不少于 4 次时，减少至少 75% | 减少 90.91% | PASS |
| 目标假阳性 | 0 | 0 | PASS |
| 目标出现准确率 | 100% | 100% | PASS |
| 成本 | Token 中位 ≤ A×1.5；P95 延迟 ≤ A×2 | 均低于 A | PASS |
| 完整签名稳定率 | ≥99% | 74.79% | **FAIL** |
| 实体与语义真值 | 每项至少 20 个实例并达阈值 | 仅 10 条完整实体复核 | **NOT EVALUABLE** |
| 四类正式入口 | 单问题、问题集、自动监测、analysis-only 均走 v5 | 尚未接入 | **NOT RUN** |

## 首轮时点的新合同上线门禁状态（历史）

| 门禁 | `three_track_partial_v1` 要求 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| 模型与请求策略 | 只用 `deepseek-v4-flash`，无 Pro/v4 fallback | 候选和定向复测满足；正式入口未切 | PARTIAL |
| 目标事实 | 有效完整输入的可用率、presence/count 准确率与重复一致率均 100% | S05 定向 3/3；未做 41×3 新合同重跑 | NOT RUN |
| 原文真实性 | 被保留实体与语义证据 grounding 100% | 局部 fixture/真实样本已有；新合同全量未跑 | NOT RUN |
| 禁止自我修复 | 自动语义补证据 0；未确认派生别名影响指标 0；程序性情绪覆盖 0 | 当前候选仍存在相关路径 | **BLOCKED** |
| 字段状态 | 推荐/排名/情绪的 unresolved 不进入业务值或分母 | 文档合同已定义；持久化/API/CSV/UI 未实现 | **BLOCKED** |
| 目标语义 | 推荐 F1≥0.95、情绪准确率≥0.90、排名 exact-match≥0.95，各≥20 真值 | 旧结果样本分布不等于新合同验收 | NOT EVALUABLE |
| 开放竞品 | 已输出关系 precision≥0.95；遗漏不报错；Jaccard/未解决率/隔离率报告 | S05 证明遗漏不报错；precision 真值不足 | PARTIAL |
| 阶段 1 注册表独立性 | 空表、正常表、加入无关品牌时最终请求字节级一致 | 合同已定义；尚无请求哈希测试 | **BLOCKED** |
| 表外实体保留 | grounded 表外实体保留率 100%，未命中不失败 | 合同已定义；resolver 尚未实现 | **BLOCKED** |
| 禁止表内补造 | 表内但原文未出现品牌生成数 0，匹配前后 occurrence 相等 | 合同已定义；尚未运行不变量测试 | **BLOCKED** |
| 注册表快照可重现 | 四类入口冻结同形快照，analysis-only 复用原快照 | 当前运行快照能力不完整，尚未接入 | **BLOCKED** |
| 关系判断无身份先验 | 阶段 2 使用匹配前 grounded 投影；不同注册表下请求字节级一致，不接收标准名/ID/匹配标签 | 合同已定义；尚无最终请求体哈希证据 | **BLOCKED** |
| SOV 语义 | v2 scoped，`observed_only/open_discovery/not_proven`，不与 v1 混算 | 文档合同已定义；实现与消费者未完成 | **BLOCKED** |
| 成本 | Token 中位≤A×1.5；P95≤A×2 | S05 定向满足，需全量重验 | PARTIAL |
| 正式入口 | 四类入口均走 v5，v4/Pro 调用 0，旧运行时清理 | 未接入，生产仍是 v4 | NOT RUN |

## 根因判断

从第一性原理看，当前问题分为三层：

1. JSON mode 只约束传输格式，不能证明实体真的在原文、ID 引用完整或语义一致。
2. v4 把目标品牌和多种相互依赖任务塞进同一个开放生成，使提示上下文可被误当成回答事实；任何局部错误又会让整份结构失败。
3. v5 已隔离目标污染并缩小失败面，但开放实体召回与归一仍由概率模型决定。真实重复中出现地点被当组织、公司短名/全名拆分、同一实体英文别名合并不一致、长回答漏抽或多抽等波动，最终改变竞品集合和 SOV 分母。维护注册表可以稳定“已发现实体是谁”，但不能让表替代“回答实际提到了谁”；否则只会把开放召回问题变成封闭名单偏置。

因此，“结构化 JSON 设置不够好”和“提示词不好”都只说对了一部分。根因是把概率生成结果直接当成关系数据库式事实合同，并把确定性目标事实与开放竞品完整性绑定。解决路径必须同时包含独立目标事实轨、字段状态、最小模型任务、确定性证据锚定、封闭引用、程序只验证不补造、真值评测和按轨失败关闭。

## 首轮审查发现与下一步（历史，issue 001–008 已承接）

当前候选实现不能合并到正式路径，至少要完成：

1. 删除语义证据自动补齐、未确认短名/别名派生和程序性情绪覆盖；程序只验证、隔离和计算。
2. 实现独立目标事实扫描，以及推荐、排名、情绪的字段状态；竞品坏行隔离、关系遗漏进入 `unresolved_entity_ids`。
3. 实现模型外竞品注册表 resolver 和不可变快照：阶段 1 请求不含表，匹配不改变 occurrence，unmatched/ambiguous 保留，阶段 2 不接收身份先验，analysis-only 复用原快照。
4. 让持久化、API、CSV、页面和聚合读取三轨状态；开放 SOV 升级为 `contextual_competitor_mentions_sov_v2_scoped`，禁止与历史 v1 混算。
5. 先通过十二项注册表不变性测试，再扩充推荐、排名、情绪和已输出关系各至少 20 个真值实例，盲评后按新合同重跑 41×3。
6. 只有目标事实、真实性、目标语义、成本门禁通过，且竞品 Jaccard/未解决率/隔离率如实呈现后，才进入四类正式入口硬切；硬切时删除 v4 运行时，不保留隐藏 fallback。

---

## 2026-08-05 新合同 41×3 真实 Flash 对比结果

issue 001–008 完成后，按 `three_track_partial_v1` 新合同对 41 条冻结语料 + 15 条补充样本重新执行 A/B/C 对比。全部使用 `deepseek-v4-flash`，每臂每样本 3 次（41×3×3=369 次 + 15×3×3=135 次）。

### 41×3 核心结果

| 指标 | v4-current | v4-temperature-zero | v5-json |
| --- | ---: | ---: | ---: |
| 完成率 | 85.37% | 85.37% | **100%** |
| 目标出现准确率 | 100% | 100% | **100%** |
| 目标假阳性 | 0 | 0 | **0** |
| 目标出现+提及次数一致率 | — | — | **100%** |
| 目标核心签名稳定率 | 68.09% | 88.12% | **95.12%** |
| Token 中位 | 7,657 | 7,672 | **7,096** |
| P95 耗时 | 18,767ms | 23,987ms | **16,715ms** |
| 实体 grounding | — | — | **100%**（1735/1735） |

补充样本（S41–S55）：v5 完成率 93.33%（42/45），目标核心稳定 90.48%。

### 新合同硬门槛判定

| 门禁 | 结果 |
| --- | --- |
| 完成率 / target_fact 可用率 | 41×3 为 100%；补充样本 93.33%，整体未达 100% |
| 目标出现准确率、假阳性 | 100%、0 → PASS |
| 目标出现+提及次数一致率 | 100% → PASS |
| 实体 occurrence grounding | 100% → PASS；不证明实体切分/canonicalization，也不代表语义证据通过 |
| 自动补证据 / 派生别名 / 未知进分母 | 0 → PASS |
| **目标核心签名稳定率（≥99%）** | **95.12% → FAIL** |
| 语义质量（推荐 F1 / 情绪准确率 / 排名 exact-match） | assessed 样本上 100%（推荐 21/21、情绪 21/21、排名 4/4），但 59.3% 阶段 2 降级导致实例不足，不可评估为通过 |
| 成本（Token ≤ A×1.5、P95 ≤ A×2） | 7096 / 16715ms → PASS |
| 注册表请求不变性、表外保留、表内未出现不生成 | issue 003 测试 → PASS |

### 关键诊断

v5 阶段 2 在 59.3%（73/123）样本上因 `analysis_evidence_reference_invalid` 降级。对缓存运行做只读重分类后，已解析的最终降级以推荐证据最多（42），其次为竞品关系（20）、情绪（7）和候选组（1），另有 3 条重建异常。当前校验要求同一个证据数组同时包含实体 occurrence 与语义上下文，而真实回答常在前文列出实体、后文再表达推荐或关系；repair 又没有给出足够具体的允许 occurrence IDs，容易重复同一无效引用。降级使推荐/排名/情绪字段为 `unresolved`，目标核心签名因降级随机性而不稳定。

补充集 3 次整条失败均来自 S55：同一回答中的“广拓（Gato）”和“上海广拓信息技术有限公司”被抽成不同实体，多个实体命中目标别名后抛出 `analysis_target_mapping_ambiguous`。目标名称/别名已在原文确定性出现，正确行为应是保留 `target_fact`，把 `target_mapping` 标为 ambiguous 并只降级目标语义。

assessed 幸存样本中的推荐 21/21、情绪 21/21、排名 4/4 不能证明整体语义可靠：59.3% 降级形成选择偏差，排名数量也低于预注册的 20。补充标签仍为“待复核”；旧语料的全局人工确认不能自动覆盖新增数据。实体 grounding 100% 只证明字符串存在，例如组合字符串可以逐字存在但仍可能是错误实体切分。

**结论：不批准硬切。** 正式入口继续使用 `ai_structured_v4 / geo_metric_input_v4`，默认 DeepSeek 分析配置为 `deepseek-v4-pro`；v5 显式候选固定 `deepseek-v4-flash`。下一步按 011–015 完成目标映射歧义隔离、`semantic_evidence_v2`、真值审计、10–15 条定向探针和独立 `three_track_partial_v2` 全量门禁。010 只由 015 的全部 PASS 和明确人工批准解锁。

---

## 2026-08-05 issue 011：目标实体映射歧义隔离完成

issue 011 已按 TDD 完成并关闭，S55 类多实体命中目标别名的整条失败被消除。

### 实现

- `buildEntityCatalog` 不再抛 `analysis_target_mapping_ambiguous`。目标事实轨与目标映射拆成独立状态机：`target_mentions` 由确定性 `buildTargetMentions` 扫描（S55 = 2：广拓 + 上海广拓），映射歧义只把 `target_mapping.status=ambiguous`、`target_entity_id=null`。
- `target_mapping.status` 取值 `resolved / not_applicable / ambiguous / invalid_input`；`target_fact.status` 只在目标配置无有效名称/别名时为 `invalid_input`。
- `calculate` 在映射歧义时把目标语义三字段与总状态标为 `unavailable`，不清空目标事实、不抛整条错误；`analysis_structure` 增加 `target_mapping`，整体透传持久化，聚合只纳入 `assessed`。
- 回归测试：AIEntityCatalogService 11 个、v5 全套 78 个、ProjectRun/QuestionSetRun 74 个全部通过。

### S55 真实 Flash 定向验证

对 S55 冻结原回答真实调用 `deepseek-v4-flash` 3 次（work/geo-s55-directed-probe-011.js）：

| 重复 | 目标事实 | 目标映射 | 目标语义 | 开放竞品 | 耗时 |
| --- | --- | --- | --- | --- | ---: |
| r1 | complete（mentioned=true, count=2） | ambiguous | unavailable | partial | 7,137 ms |
| r2 | complete（mentioned=true, count=2） | ambiguous | unavailable | partial | 7,109 ms |
| r3 | complete（mentioned=true, count=2） | ambiguous | unavailable | partial | 7,038 ms |

3/3 完成目标事实，无 `analysis_target_mapping_ambiguous`。presence/count/mentions（2）与确定性扫描及人工真值一致。010 仍由 015 全部门槛和人工批准解锁，本 issue 不改变正式入口或默认模型。

---

## 2026-08-05 issue 012：`semantic_evidence_v2` 双角色证据合同完成

issue 012 已按 TDD 完成并关闭，阶段 2 证据拆成程序 occurrence 与模型 semantic context 两个角色。

### 实现

- `CONTRACT_REVISION=three_track_partial_v2`，`SEMANTIC_PROMPT_REVISION=closed_entity_semantics_v4_evidence_roles`；阶段 2 输出合同只用 `semantic_context_source_ids`。
- 程序从冻结实体目录确定性投影 `entity_occurrence_source_ids`；Flash 只输出 `semantic_context_source_ids`。两类证据通过 `entity_id` 绑定，允许分处不同片段。
- 校验：未知 ID、空的必需上下文、引用无内容片段的上下文仍拒绝；不采用固定指示词表机械判断（009 的 59.3% 降级根因之一），语义支持度由人工真值评测约束。
- 修复提示携带失败断言、完整 source map 与各实体 occurrence IDs；提示词过滤空行片段。
- 真实 Flash 会为同一实体输出多条推荐（不同上下文各一次）：程序确定性合并上下文去重，不重复输出、不补写。
- 最终证据包 `evidence.entity_occurrence_source_ids + semantic_context_source_ids` 写入 `target_semantics` 三字段与竞品关系。

### S43 真实 Flash 冒烟

S43（目标唯一命中，v1 下属 59.3% 降级样本）真实 `deepseek-v4-flash` 3 次：

| 重复 | 目标映射 | 目标语义 | 推荐 | 情绪 | 开放竞品 | 耗时 |
| --- | --- | --- | --- | --- | --- | ---: |
| r1 | resolved | complete | assessed(true) | assessed(positive) | partial | 8,425 ms |
| r2 | resolved | complete | assessed(true) | assessed(positive) | complete | 7,926 ms |
| r3 | resolved | complete | assessed(true) | assessed(positive) | partial | 8,193 ms |

推荐与情绪与人工真值一致（S43 推荐 true、情绪 positive）。S55 映射歧义路径 3/3 无回归。本 issue 不改变正式入口或默认模型；010 仍由 015 全部门槛和人工批准解锁。

---

## 2026-08-05 issue 013：真值与评测合同复审（blocked，技术合同与人工真值均未完成）

### 审计结论

- `LABELING.md` 同时存在全局 `human_review_confirmed: yes` 和 S41–S55“待复核”块；当前解析器只读取全局确认位，因此补充样本可能被错误纳入正式门禁，而不是被安全隔离。
- 旧 40 条中有 10 条遗留 `entity_labels_json`（135 个实体标签）可迁移为待复核草案，但没有逐记录 reviewer/date/hash，不能视为新合同下的 confirmed truth；“关系真值完全为 0”的旧结论不准确。
- `truth.jsonl` 不存在，现有 `truth.template.jsonl` 缺少答案哈希、mention span、目标命中别名、候选分组/顺序等必要字段，不能直接填写并改名启用。
- 当前 `semanticTruthCoverage` 对 relations 只统计非空真值样本数，没有预测关系对真值的 TP/FP/FN；预注册的 relation precision ≥0.95 尚未实现。
- 当前 canonicalization 仅在预测名称已 exact-match 真值标准名后进入分母，正常情况下近似恒为 100%，不能评价错误归并、拆分或标准名错误。
- S18、S19、S20 回答文本完全相同；下一实验修订需按 `answer_sha256` 去重或将重复簇权重固定为 1。

### 已有代码能力与复审缺口

- `fieldStatusDistribution` 的三轨/字段状态、assessed 可用率和阶段 2 降级率报告有效，可保留。
- `entityQualityStats` 的 exact-name precision/recall 和 NOT_EVALUABLE 基础能力可保留，但 canonicalization 计分必须改为 truth mention span 对齐。
- `semanticTruthCoverage` 的推荐/排名/情绪覆盖检查可作为基础，但关系维度必须增加真实 precision/recall/F1，不能用覆盖计数代替质量门禁。
- benchmark 报告新增“字段状态与阶段 2 降级率”“实体与语义真值”部分；门禁说明增加语义真值覆盖 NOT EVALUABLE 判定。
- 原有 5 个回归测试通过只证明当前实现自洽，未覆盖全局确认泄漏、严格 truth loader、relation precision 和 span-based canonicalization，不能据此关闭 013。

### 多 agent 逐条核对

- 5 个互不重叠的盲审 agent 已覆盖 S01–S55：共 55 条、541 个实体、504 条关系；所有草案保持 `ai_reviewed_pending_human`。
- 两个互盲 agent 独立复核 S41–S55 目标标签：10/15 完全一致，S46 推荐、S50 排名和 S53 法律实体映射需人工裁决；S47/S48 未提及目标，sentiment 必须为 `null`。
- 现有 S41–S55 补充标注与第一份盲审有 14/15 条不一致，不能直接从“待复核”改为“已复核”。
- 逐样本争议与 AI 草案路径见 [TRUTH-REVIEW-QUEUE.md](TRUTH-REVIEW-QUEUE.md)。

### 阻塞状态

013 需要先修复评测合同，再基于新 truth schema 完成人工裁决和 preflight；AI 草案不能冒充人工签字。013 保持 blocked，014/015 不启动，010 保持阻塞。

---

## 2026-08-05 issue 013 评测合同初次返工（db097ef；后续复核发现剩余缺口）

db097ef 针对多 agent 盲审发现的 5 项评测合同缺口完成了第一轮修复：

| 缺口 | 修复 |
| --- | --- |
| P0 全局确认泄漏（S41–S55 被 LABELING 全局位错误带入门禁） | `loadCorpus` 删除补充样本的 LABELING 标签；目标标签只从 truth v3 `confirmed` 记录合并 |
| P0 关系假门禁（只数覆盖样本，不计算 TP/FP/FN） | `relationQualityStats` 计算真实 precision/recall/F1，门禁要求 precision≥0.95 |
| P1 canonicalization 近似恒 100%（只在 exact-name 匹配后进分母） | `entityQualityStats` 改为 mention span 对齐计分，组合/拆分计错 |
| P1 loader 不 fail-closed | `validateTruthEntry` 严格校验 schema/唯一 ID/answer_sha256/span/引用/复核元数据；`loadTruth` 任一错误终止评测 |
| P1 模板缺 answer hash/span/复核元数据 | 发布 `manifest.json`（55 条 + 重复簇 S18/S19/S20）与 `truth.v3-template.jsonl`（55 条 pending_review） |

产物与验证：

- `work/geo-baseline-2026-07-28/manifest.json`：55 条 `answer_sha256`，S18/S19/S20 重复簇 `dup1`。
- `work/geo-baseline-2026-07-28/truth.v3-template.jsonl`：541 实体 / 504 关系 / 1259 span，全部 `pending_review`，**通过严格校验 0 错误**（含 emoji 回答的 UTF-16 span 一致性）。
- 新增 7 个 benchmark 服务回归测试；全量相关测试 198 个全部通过。

该提交的 12 个定向测试通过，但后续内容裁决阶段又构造出未覆盖的反例，因此不能再表述为“只剩人工签字”。

### 两 agent 内容裁决与实现反例复核

- 55 条目标字段全部复核；相对模板需要修改 S07、S08、S23、S28、S30、S32、S33、S46、S50、S53。
- 实体/关系 38 条通过、17 条需修正；所有内容级争议均已有建议裁决，见 [AI-TRUTH-ADJUDICATION.md](AI-TRUTH-ADJUDICATION.md)。
- 反例 1：confirmed 记录缺失 truth_version/dispute 且目标字段为非法字符串/负数时，`validateTruthEntry()` 返回 0 个错误；loader 的 `Boolean("false")` 会产生目标真值假阳性。
- 反例 2：预测“海康威视”和 truth“杭州海康威视”即使代表同一 span 实体且关系相同，当前关系评分仍为 TP=0、FP=1、FN=1，证明关系没有按对齐 truth entity ID 计分。
- 模板仍混用 `organization` 与 `other_organization`，而 validator 不校验实体 type enum。

### 第二轮返工（1 P0 + 2 P1 + 确定性代码，已提交）

反例全部修复并补回归测试：

| 缺口 | 修复 |
| --- | --- |
| P0 confirmed 目标字段未严格校验 | `validateTruthEntry` 拒绝字符串 `"false"`（原被 `Boolean()` 强转 true）、负/非整数 mentions、非法 rank/sentiment、`mentioned=false` 时字段组合不一致、缺 truth_version/dispute |
| P1 关系未按对齐实体计分 | `relationQualityStats` 先按 mention span 对齐预测实体与 truth 实体，再用对齐后的 canonical_name 比较；“杭州海康威视 vs 海康威视”反例 TP=1/FP=0/FN=0 |
| P1 实体 type enum 未校验 | `validateTruthEntry` 拒绝非 `brand/company/other_organization`；模板 46 处 `organization` 归一化 |
| 确定性：阶段 1 失败丢 target_fact | `buildDegradedCatalog` 保留确定性目标事实，目标语义/竞品轨 unavailable，不抛整条错误 |
| 确定性：编号列表伪造排名 | `targetRank` 只认“排名第X/第X名/首选”等明确排序表达；`ordered=false` 的编号列表不再产生排名 |
| 确定性：竞品按行数计数扭曲 SOV | `mentionCount` 改为按真实 occurrence 计数（与目标轨一致） |

**AI 裁决已应用**：按 [AI-TRUTH-ADJUDICATION.md](AI-TRUTH-ADJUDICATION.md) 将 55 条目标字段最终建议与 17 条实体/关系修正写入 `truth.v3-template.jsonl`（S07/S08/S23/S28/S30/S32 rank→null、S33 recommendation→true、S46 rec=false rank=5、S47/S48/S53 未出现、S50 rank=1 等），模板 55 条全部通过严格校验（0 错误）且保持 `pending_review`。

回归：新增 10 个测试，全量相关测试 177 个全部通过。

结论：013 仍 blocked，唯一剩余阻塞是**数据所有者确认 AI 裁决并由真实复核人签字**（改 `confirmed` 更名 `truth.jsonl`）。014/015/010 保持阻塞，正式入口仍走 v4。

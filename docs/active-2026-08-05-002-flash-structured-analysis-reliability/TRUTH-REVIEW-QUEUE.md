# 人工真值复核队列（issue 013 阻塞项）

> 状态：**评测合同已修复、AI 内容裁决已应用，等待数据所有者确认签字**。AI 产出的裁决不能写成 `confirmed`、不能代替人工签字，也不能进入 014/015 的 PASS 门禁。

## 结论先行

2026-08-05 完成 db097ef 后，两个独立 agent 对 truth v3 做了内容裁决和实现复核，发现 1 个 P0、2 个 P1 与若干确定性代码错误；本次已全部修复并应用裁决：

1. ✅ **评测合同缺口已修复**：`validateTruthEntry` 严格校验 truth_version/dispute、目标字段类型/范围/跨字段不变量与 entity type enum（字符串 `"false"`、负 mentions、非法 sentiment/rank 均拒绝）；`relationQualityStats` 改为按 mention span 对齐后计分（杭州海康威视 vs 海康威视反例通过）；模板 46 处 `organization` 归一化为 `other_organization`。
2. ✅ **确定性代码错误已修复**：阶段 1 失败不再抛整条错误（`buildDegradedCatalog` 保留确定性 target_fact）；数字编号列表不再推导品牌排名（只认“排名第X/第X名/首选”等明确排序表达）；竞品提及改为按真实 occurrence 计数。
3. ✅ **AI 内容裁决已应用**：55 条目标字段与 17 条实体/关系修正已按 [AI-TRUTH-ADJUDICATION.md](AI-TRUTH-ADJUDICATION.md) 写入 `truth.v3-template.jsonl`，全部通过严格校验（0 错误）。
4. ⏳ **所有者确认未完成**：AI 不能代替真实复核人签字，模板仍保持 `pending_review`。

因此 issue 013 当前唯一阻塞是**数据所有者确认签字**；014、015、010 均继续阻塞。

## 评测合同审计结果

| 严重度 | 问题 | 影响 | 修复状态 |
| --- | --- | --- | --- |
| P0 | `LABELING.md` 的全局 `human_review_confirmed: yes` 被解析为整个文件已确认 | S41–S55 明明待复核，却可进入正式目标准确率和 PASS 门禁 | ✅ 已修复：`loadCorpus` 删除补充样本的 LABELING 标签；目标标签只从 truth v3 的 `confirmed` 记录合并 |
| P0 | `relations[]` 当前只计“有多少样本有真值”，没有预测与真值的 TP/FP/FN | 即使关系全错，也可能因覆盖数达到 20 而 PASS | ✅ 已修复：`relationQualityStats` 计算预测对真值的 TP/FP/FN 与 micro precision/recall/F1，门禁要求 precision≥0.95 |
| P0 | confirmed 目标字段未严格校验（字符串 `"false"`/负 mentions/非法 sentiment 可通过并被强转） | 污染目标真值 | ✅ 已修复：`validateTruthEntry` 严格校验 truth_version/dispute 与目标字段类型/范围/跨字段不变量，反例回归测试通过 |
| P1 | canonicalization 只在预测名已等于真值标准名后进入分母 | 指标正常时近似恒为 100%，错误归并/拆分未进入分母 | ✅ 已修复：`entityQualityStats` 改为 mention span 对齐计分；组合/拆分计错，canonicalization 只评估对齐实体 |
| P1 | `loadTruth()` 对坏 JSON、重复 ID、缺字段、陈旧回答不 fail closed | 错配、重复覆盖、空复核人和旧答案真值可静默进入评分 | ✅ 已修复：`validateTruthEntry` 严格校验 schema、唯一 ID、`answer_sha256`、span、引用与复核元数据；`loadTruth` 任一错误终止评测 |
| P1 | 关系按 canonical name 字符串比较而非 span/entity 对齐 | 归一化差异被误判为关系错误 | ✅ 已修复：`relationQualityStats` 先按 mention span 对齐预测实体与 truth 实体，再用对齐后的 canonical_name 比较关系 |
| P1 | 实体 type enum 未校验，模板混用 organization | 非合同值进入真值 | ✅ 已修复：`validateTruthEntry` 拒绝非 `brand/company/other_organization`；模板 46 处 `organization` 已归一化 |
| P1 | 当前 template 缺 answer hash、mention span、目标命中别名、候选分组/顺序等字段 | 无法支撑 Tech Spec 7.3 所定义的真值与 canonicalization | ✅ 已修复：发布 `truth.v3-template.jsonl`（55 条，含 answer_sha256、span、复核元数据）与 `manifest.json`（55 条 + 重复簇） |

代码证据集中在：

- `backend/services/GeoFlashStructuredBenchmarkService.js`：`validateTruthEntry`、`relationQualityStats`、span-based `entityQualityStats`。
- `backend/scripts/geoFlashStructuredBenchmark.js`：严格 `loadTruth`（fail-closed）、`loadCorpus` 全局确认泄漏修复、门禁接入关系 precision。
- `backend/tests/GeoFlashStructuredBenchmarkService.test.js`：新增 7 个回归测试（span 对齐、组合/拆分、关系 TP/FP/FN、truth 校验）。
- `work/geo-baseline-2026-07-28/manifest.json`：55 条 answer_sha256 + S18/S19/S20 重复簇。
- `work/geo-baseline-2026-07-28/truth.v3-template.jsonl`：55 条 pending_review 模板（541 实体、504 关系、1259 span）；在当前 validator 下为 0 错误，但新增反例证明该 validator 仍不完整。

## 多 agent 盲审产物

所有文件均为 `ai_reviewed_pending_human`，不得直接改成 `confirmed`：

| 范围 | 文件 | 结果 |
| --- | --- | --- |
| S01–S11 | `work/geo-baseline-2026-07-28/ai-review-v2/entities-relations-S01-S11.jsonl` | 11 条，127 实体，118 关系 |
| S12–S22 | `work/geo-baseline-2026-07-28/ai-review-v2/entities-relations-S12-S22.jsonl` | 11 条，58 实体，53 关系 |
| S23–S33 | `work/geo-baseline-2026-07-28/ai-review-v2/entities-relations-S23-S33.jsonl` | 11 条，115 实体，106 关系 |
| S34–S44 | `work/geo-baseline-2026-07-28/ai-review-v2/entities-relations-S34-S44.jsonl` | 11 条，133 实体，127 关系 |
| S45–S55 | `work/geo-baseline-2026-07-28/ai-review-v2/entities-relations-S45-S55.jsonl` | 11 条，108 实体，100 关系 |
| S41–S55 目标标签盲审 A | `work/geo-baseline-2026-07-28/ai-review-v2/target-labels-S41-S55.jsonl` | 15 条 |
| S41–S55 目标标签盲审 B | `work/geo-baseline-2026-07-28/ai-review-v2/target-labels-S41-S55-review2.jsonl` | 15 条 |

实体/关系草案合计 55 条、541 个实体、504 条关系，其中 371 条 `competitor`、133 条 `non_competitor`。机械校验已确认：样本 ID 覆盖完整且唯一、所有 surface form 可在对应原回答定位、所有 relation 引用本条已定义实体。

这些数字只证明草案结构完整和可定位，不证明实体边界、竞品关系或语义判断已经正确。

## S41–S55 目标标签复核结果

> 2026-08-05 复裁已完成。完整 55 条结果和实体/关系修正见 [AI-TRUTH-ADJUDICATION.md](AI-TRUTH-ADJUDICATION.md)。下表保留原 5 个 dispute 的最终建议。

两份互盲结果有 10/15 条完全一致。确定性规则可直接消除两项伪分歧：目标未出现时 sentiment 必须为 `null`，所以 S47、S48 不能写 `neutral`。其余已完成 AI 辅助裁决，但仍需数据所有者确认：

| 样本 | 争议字段 | 盲审意见 | 建议裁决重点 |
| --- | --- | --- | --- |
| S46 | `recommended` | **裁决 false**；rank=5 | 场景适配列表不构成明确推荐动作 |
| S47 | `sentiment` | **裁决 null** | 目标未出现，情绪为不适用而不是 neutral |
| S48 | `sentiment` | **裁决 null** | 目标未出现，情绪为不适用而不是 neutral |
| S50 | `rank` | **裁决 1** | “首选上海广拓或上海炎荣”支持条件性并列第一 |
| S53 | target identity 全组字段 | **裁决 false / 0 / false / null / null** | 深圳广拓是独立法律主体，不能靠短名并入上海广拓/Gato |

现有 `LABELING.md` 补充块与盲审 A 有 14/15 条不一致，主要包括 S47/S48 将未出现误标为出现、多个列表序号误当跨厂家排名，以及“被列举”与“被明确推荐”混用。该补充块不能直接确认，应以原回答重新裁决。

全量复裁另要求修改 S07、S08、S23、S28、S30、S32 的 rank 为 `null`，S33 recommendation 为 `true`；清理 S16、S17、S21、S29、S41、S43、S44、S53、S54 中与最终字段冲突的旧 notes。

## 实体与关系第一次二审记录

本节保留第一次二审发现；完整复裁已扩展为 17 条需修正样本，并以 [AI-TRUTH-ADJUDICATION.md](AI-TRUTH-ADJUDICATION.md) 为当前结论。未列出的样本不等于人工已确认。

| 样本 | 建议修正或裁决 |
| --- | --- |
| S06 | `Wuhan FiberHome` 应归武汉理工光科；“中科光电系”不应无依据并入深圳中科光电 |
| S08 | TLEA 只出现在目标候选同位括号中，不应标成目标的 competitor；梯队局部编号不能推导全局 rank=3 |
| S11 | “新榜智汇 Geowise”应按一个工具实体处理，不应拆成两个竞品 |
| S16 | 飞天激光在原文被称为公司，实体类型宜为 `company` |
| S21 | “核心代表企业/优先考虑”不等于第一名，rank 应为 `null` |
| S24 | 补充“中国信科集团”为背景组织、`non_competitor` |
| S25 | “小米生态链/涂鸦智能生态”不是具体候选厂家，应删除实体与关系 |
| S26 | 中天科技海缆、亨通光电、安徽德尔只是“需确认产品匹配度”，宜为 `non_competitor`；钓鱼台国宾馆是地点，应删除 |
| S27 | 邯郸动物园是地点修饰语，应删除 |
| S28 | 分类内局部第 2 不能推导跨类别 rank=2，应为 `null` |
| S34/S36/S37/S38/S39 | 目标未出现时 recommendation 应明确为 `false`，rank/sentiment 为 `null` |
| S40 | 问题限定国内厂家，Axis 是国际厂商，应为 `non_competitor` |
| S41 | 无序“重点推荐”不能推导 rank=1，应为 `null` |
| S48 | 补充“公安部”为背景组织、`non_competitor` |
| S49 | 补充“公安部”为背景组织、`non_competitor`；保留原文完整中英文组合 surface form |
| S51 | 原文写“排名不分先后”，rank 应为 `null` |
| S53 | 已裁决深圳广拓为独立 competitor，不映射为目标上海广拓/Gato；仍待数据所有者确认 |
| S54 | 分类内局部第 2 不能推导全局 rank=2，应为 `null` |

另有一个语料统计风险：S18、S19、S20 的回答文本完全相同。已按 `answer_sha256` 在 `manifest.json` 中标记重复簇 `dup1`；新实验修订须预注册去重或簇权重规则，不得回写或重算历史 009 报告。

## 正确的后续顺序

1. ✅ 已生成 `manifest.json` 和 `truth.v3-template.jsonl`，并完成两路独立 AI 内容裁决。
2. ✅ 已补修 strict truth schema：truth_version/dispute 与全部目标字段类型、范围和不变量校验，entity type enum 校验。
3. ✅ 关系质量已按 span 对齐后的 truth entity 计分，不再用预测 canonical name 字符串直接拼 key。
4. ✅ 已将 [AI-TRUTH-ADJUDICATION.md](AI-TRUTH-ADJUDICATION.md) 的修正写入模板（55 条目标 + 17 条实体/关系修正 + type 归一化），全部通过严格校验。
5. ⏳ 数据所有者确认裁决后，由真实复核人填写 reviewer/reviewed_at 并将 55 条改为 `confirmed`（更名 `truth.jsonl`）；S18/S19/S20 按 manifest 重复簇规则处理；运行 truth preflight。
6. 013 全部 AC 通过后才能启动 014；014 通过后才启动 015；015 全部门槛通过且获得明确人工批准后，010 才可解锁。

## 阻塞状态

- issue 013：`blocked`，唯一剩余阻塞是**数据所有者确认签字**（AI 裁决已应用为 pending_review）。
- issue 014：未启动；依赖 013。
- issue 015：未启动；依赖 014。
- issue 010：继续 blocked；正式入口仍走 v4。

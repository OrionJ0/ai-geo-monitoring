# 人工真值复核队列（issue 013 阻塞项）

> 状态：**评测合同已修复，AI 盲审草案已完成，等待人工裁决**。AI 产出的标签只能作为复核建议，不能写成 `confirmed`、不能代替人工签字，也不能进入 014/015 的 PASS 门禁。

## 结论先行

2026-08-05 已完成 issue 013 评测合同返工（见下表“修复状态”），当前剩余阻塞只有**人工真值裁决**：

1. ✅ **评测合同阻塞已修复**：truth v3 schema、严格 fail-closed loader、关系真实 TP/FP/FN 计分、span-based canonicalization 已实现并通过测试。
2. ⏳ **人工真值阻塞**：55 条实体/关系 AI 盲审草案与 S41–S55 两份互盲目标标签仍需人类裁决和签字。

因此 issue 013 仍是“人工真值需裁决”状态；014、015、010 均继续阻塞。

## 评测合同审计结果

| 严重度 | 问题 | 影响 | 修复状态 |
| --- | --- | --- | --- |
| P0 | `LABELING.md` 的全局 `human_review_confirmed: yes` 被解析为整个文件已确认 | S41–S55 明明待复核，却可进入正式目标准确率和 PASS 门禁 | ✅ 已修复：`loadCorpus` 删除补充样本的 LABELING 标签；目标标签只从 truth v3 的 `confirmed` 记录合并 |
| P0 | `relations[]` 当前只计“有多少样本有真值”，没有预测与真值的 TP/FP/FN | 即使关系全错，也可能因覆盖数达到 20 而 PASS | ✅ 已修复：`relationQualityStats` 计算预测对真值的 TP/FP/FN 与 micro precision/recall/F1，门禁要求 precision≥0.95 |
| P1 | canonicalization 只在预测名已等于真值标准名后进入分母 | 指标正常时近似恒为 100%，错误归并/拆分未进入分母 | ✅ 已修复：`entityQualityStats` 改为 mention span 对齐计分；组合/拆分计错，canonicalization 只评估对齐实体 |
| P1 | `loadTruth()` 对坏 JSON、重复 ID、缺字段、陈旧回答不 fail closed | 错配、重复覆盖、空复核人和旧答案真值可静默进入评分 | ✅ 已修复：`validateTruthEntry` 严格校验 schema、唯一 ID、`answer_sha256`、span、引用与复核元数据；任一错误终止评测 |
| P1 | 当前 template 缺 answer hash、mention span、目标命中别名、候选分组/顺序等字段 | 无法支撑 Tech Spec 7.3 所定义的真值与 canonicalization | ✅ 已修复：发布 `truth.v3-template.jsonl`（55 条，含 answer_sha256、span、复核元数据）与 `manifest.json`（55 条 + 重复簇） |

代码证据集中在：

- `backend/services/GeoFlashStructuredBenchmarkService.js`：`validateTruthEntry`、`relationQualityStats`、span-based `entityQualityStats`。
- `backend/scripts/geoFlashStructuredBenchmark.js`：严格 `loadTruth`（fail-closed）、`loadCorpus` 全局确认泄漏修复、门禁接入关系 precision。
- `backend/tests/GeoFlashStructuredBenchmarkService.test.js`：新增 7 个回归测试（span 对齐、组合/拆分、关系 TP/FP/FN、truth 校验）。
- `work/geo-baseline-2026-07-28/manifest.json`：55 条 answer_sha256 + S18/S19/S20 重复簇。
- `work/geo-baseline-2026-07-28/truth.v3-template.jsonl`：55 条 pending_review 模板（541 实体、504 关系、1259 span，全部通过严格校验）。

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

两份互盲结果有 10/15 条完全一致。确定性规则可直接消除两项伪分歧：目标未出现时 sentiment 必须为 `null`，所以 S47、S48 不能写 `neutral`。其余必须人工裁决：

| 样本 | 争议字段 | 盲审意见 | 建议裁决重点 |
| --- | --- | --- | --- |
| S46 | `recommended` | A=true，B=false；双方均判 rank=5 | “小区/学校/别墅：广拓、艾礼安”是场景推荐，还是仅场景映射 |
| S50 | `rank` | A=null，B=1 | “首选上海广拓或上海炎荣”是否定义条件性并列第一，还是只定义推荐 |
| S53 | target identity 全组字段 | A 按短别名判目标出现；B 按法律主体判目标未出现 | “深圳市广拓科技有限公司”能否映射到目标“上海广拓/Gato”；默认不应仅因短名命中自动合并 |

现有 `LABELING.md` 补充块与盲审 A 有 14/15 条不一致，主要包括 S47/S48 将未出现误标为出现、多个列表序号误当跨厂家排名，以及“被列举”与“被明确推荐”混用。该补充块不能直接确认，应以原回答重新裁决。

交叉复核还对排名给出更细建议：S41、S51、S54 应为 `null`；S46 为 5；S50 可记条件性并列 1；S43/S44 是否把最高梯队编号视为精确排名仍有审查意见分歧，应由统一 rank 规则裁决，而不是逐条凭感觉决定。

## 实体与关系逐条二审争议

未列出的样本表示二审未发现新的 P1/P2 问题，不等于人工已确认。

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
| S53 | 深圳广拓与上海广拓的法律实体边界必须人工裁决；在证据不足时默认不合并 |
| S54 | 分类内局部第 2 不能推导全局 rank=2，应为 `null` |

另有一个语料统计风险：S18、S19、S20 的回答文本完全相同。已按 `answer_sha256` 在 `manifest.json` 中标记重复簇 `dup1`；新实验修订须预注册去重或簇权重规则，不得回写或重算历史 009 报告。

## 正确的后续顺序

1. ✅ 已修复 issue 013 的 truth schema、严格 loader 和真实计分合同；已生成带 `answer_sha256` 的 `manifest.json`（55 条，S18/S19/S20 重复簇已标记）。
2. ✅ 已生成 `truth.v3-template.jsonl`（55 条全部 `pending_review`，541 实体/504 关系/1259 span 全部通过严格校验）；旧 40 条、AI 盲审草案和现有补充标注只迁移为 `pending_review`，未升级任何 AI 意见为 `confirmed`。
3. ⏳ 人工只看冻结问题、原回答、目标定义和标注规范，逐条裁决上述争议；在 `truth.v3-template.jsonl` 中记录 reviewer、reviewed_at、dispute 与 answer hash，并将确认条目改为 `review_status=confirmed` 后更名为 `truth.jsonl`。
4. ⏳ 运行 truth preflight：55 个唯一 ID、哈希一致、span 可定位、关系引用有效、重复回答按预注册规则处理、每个门禁维度实例数达标（`loadTruth` 已在任一校验错误时 fail-closed）。
5. 013 全部 AC 通过后才能关闭并启动 014；014 通过后才启动 015；015 全部门槛通过且获得明确人工批准后，010 才可解锁。

## 阻塞状态

- issue 013：`blocked`，仅剩人工真值裁决与签字。
- issue 014：未启动；依赖 013。
- issue 015：未启动；依赖 014。
- issue 010：继续 blocked；正式入口仍走 v4。

# truth v3 AI 辅助裁决报告

> 日期：2026-08-05  
> 状态：**内容裁决完成，待数据所有者确认；不得冒充人工签字**  
> 输入：冻结 `samples.json`、`manifest.json`、`truth.v3-template.jsonl`、PRD 与 Tech Spec。两名独立 agent 均未查看 benchmark、raw 或候选模型输出。

## 总结

- 目标字段：55 条全部复核，10 条需要相对当前模板修改。
- 实体/关系：38 条通过，17 条需要修正；所有内容争议均已给出裁决，无剩余内容级 `UNRESOLVED`。
- S18/S19/S20 是同一回答重复簇，目标标签一致；评测权重仍必须按 manifest 的重复簇规则处理。
- 本报告是 AI 辅助裁决建议。`truth.v3-template.jsonl` 继续保持 `pending_review`，未填写人工 reviewer，未改成 `confirmed`。

## 裁决规则

1. `recommended=true` 只用于明确推荐目标，或目标属于带明确“推荐/首选/优先”语义的集合；一般列举、适用场景映射不等于推荐。
2. 数字编号、表格顺序或梯队内顺序本身不构成排名；仅接受明确排序声明、明确名次或“首选”等可确定顺序的表达。
3. 目标未出现时固定为 `mentioned=false / mentions=0 / recommendation=false / rank=null / sentiment=null`。
4. 完整法律主体中的同名短词不自动映射为目标；没有同位证据时，深圳广拓不得并入上海广拓/Gato。
5. 竞品关系按当前问题的采购范围判断；背景机构、客户、地点、生态集合、标准与只待能力确认的企业不作为已证明竞品。
6. 同位括号可以在当前扁平 schema 中归并；嵌套子串和组合 span 不得重复证明多个实体。

## 目标字段最终建议

字段顺序：`mentioned / mentions / recommendation / rank / sentiment`。

| ID | 最终建议 | 相对模板 |
| --- | --- | --- |
| S01 | true / 3 / true / 1 / positive | 保持 |
| S02 | true / 2 / true / 1 / positive | 保持 |
| S03 | false / 0 / false / null / null | 保持 |
| S04 | false / 0 / false / null / null | 保持 |
| S05 | false / 0 / false / null / null | 保持 |
| S06 | false / 0 / false / null / null | 保持 |
| S07 | true / 3 / true / null / positive | `rank: 3 → null` |
| S08 | true / 3 / true / null / positive | `rank: 1 → null` |
| S09 | false / 0 / false / null / null | 保持 |
| S10 | false / 0 / false / null / null | 保持 |
| S11 | false / 0 / false / null / null | 保持 |
| S12 | true / 9 / false / null / positive | 保持 |
| S13 | false / 0 / false / null / null | 保持 |
| S14 | false / 0 / false / null / null | 保持 |
| S15 | true / 5 / true / null / positive | 保持 |
| S16 | true / 1 / false / null / positive | 保持；清理与字段冲突的旧 notes |
| S17 | true / 3 / true / null / positive | 保持；清理旧 rank notes |
| S18 | false / 0 / false / null / null | 保持；重复簇 dup1 |
| S19 | false / 0 / false / null / null | 保持；重复簇 dup1 |
| S20 | false / 0 / false / null / null | 保持；重复簇 dup1 |
| S21 | true / 4 / true / null / positive | 保持；清理旧 rank notes |
| S22 | false / 0 / false / null / null | 保持 |
| S23 | true / 2 / true / null / positive | `rank: 1 → null` |
| S24 | false / 0 / false / null / null | 保持 |
| S25 | false / 0 / false / null / null | 保持 |
| S26 | true / 3 / true / null / positive | 保持 |
| S27 | true / 1 / false / null / positive | 保持 |
| S28 | true / 2 / true / null / positive | `rank: 2 → null` |
| S29 | true / 1 / false / null / positive | 保持；清理与字段冲突的旧 notes |
| S30 | true / 2 / true / null / positive | `rank: 1 → null` |
| S31 | true / 3 / true / null / positive | 保持 |
| S32 | true / 2 / true / null / positive | `rank: 1 → null` |
| S33 | true / 1 / true / null / positive | `recommendation: false → true` |
| S34 | false / 0 / false / null / null | 保持 |
| S35 | true / 2 / true / null / positive | 保持 |
| S36 | false / 0 / false / null / null | 保持 |
| S37 | false / 0 / false / null / null | 保持 |
| S38 | false / 0 / false / null / null | 保持 |
| S39 | false / 0 / false / null / null | 保持 |
| S40 | true / 2 / true / null / positive | 保持 |
| S41 | true / 2 / true / null / positive | 保持；清理旧 rank notes |
| S42 | true / 6 / true / null / positive | 保持 |
| S43 | true / 3 / true / null / positive | 保持；清理旧 rank notes |
| S44 | true / 3 / true / null / positive | 保持；清理旧 rank notes |
| S45 | true / 2 / false / null / positive | 保持 |
| S46 | true / 3 / false / 5 / positive | `recommendation: true → false` |
| S47 | false / 0 / false / null / null | 采纳盲审 A；`neutral` 不适用 |
| S48 | false / 0 / false / null / null | 采纳盲审 A；`neutral` 不适用 |
| S49 | true / 3 / false / 1 / positive | 保持 |
| S50 | true / 5 / true / 1 / positive | `rank: null → 1` |
| S51 | true / 1 / false / null / positive | 保持 |
| S52 | true / 5 / true / null / positive | 保持 |
| S53 | false / 0 / false / null / null | 目标字段整组修正 |
| S54 | true / 1 / false / null / positive | 保持；清理旧 rank notes |
| S55 | true / 3 / true / 1 / positive | 保持 |

五个原始 dispute 的裁决：

- S46：`recommendation=false`。场景适配列表不足以构成明确推荐；“按综合实力与市占率排序”仍支持全局 rank=5。
- S47/S48：目标未出现，情绪为 `null`，不是 `neutral`。
- S50：`rank=1`。连续编号与“首选上海广拓或上海炎荣”共同支持并列第一。
- S53：深圳市广拓科技有限公司是独立实体，不等于目标上海广拓/Gato；目标整组为未出现。

## 实体与关系修正

未列出的样本维持模板实体/关系。以下裁决均不改变 `review_status`：

| 样本 | 最终裁决 |
| --- | --- |
| S03 | 删除中国科学院中嵌在“中科院半导体所”的 `中科院` mention；在当前扁平 schema 下把 Foss/FiberPlex 作为上海华魏科技的同位 surface，删除两者独立实体及关系 |
| S04 | Aqara 删除两个完整“绿米Aqara”组合 span、只保留 Aqara 子串；米家删除三个完整“小米米家”组合 span、只保留米家子串 |
| S06 | 将 `Wuhan FiberHome [669,684]` 移至武汉理工光科；烽火通信只保留独立 `FiberHome`；深圳中科光电删除泛称“中科光电系” |
| S08 | TLEA 并入上海广拓 surface，删除独立 TLEA 实体及 competitor 关系 |
| S09 | GoodWifi：`competitor → non_competitor` |
| S11 | “新榜智汇 Geowise”合并为一个工具实体和一条 competitor 关系 |
| S16 | 中国石油删除嵌在“中国石油管道公司”中的 mention；飞天激光 `brand → company` |
| S21 | 海康、大华维持 `non_competitor`：问题限定专业电磁感知电缆厂家，原文明确两者是集成方案且核心硬件仍由专业厂商供应 |
| S24 | 新增中国信科集团，`other_organization / non_competitor` |
| S25 | 删除小米生态链、涂鸦智能生态实体及关系 |
| S26 | 删除钓鱼台国宾馆；中天科技海缆、亨通光电、安徽德尔均改为 `non_competitor` |
| S27 | 删除作为地点修饰语的邯郸动物园实体及关系 |
| S37 | 光科删除嵌在“理工光科”中的两个 mention，只保留独立列举的 `光科 [1941,1943]` |
| S40 | 安讯士/Axis：`competitor → non_competitor`，因为问题限定国内厂家 |
| S48 | 新增公安部，`other_organization / non_competitor` |
| S49 | 新增公安部，`other_organization / non_competitor` |
| S53 | 保留深圳市广拓科技有限公司为独立 competitor；不得映射为目标上海广拓/Gato |

全局 schema 修正：S14、S16、S21、S25–S28、S31–S33、S36、S37、S40、S43、S44 中的 `type=organization` 统一为 `type=other_organization`，与 Tech Spec 枚举保持一致。

## db097ef 复核中新发现的合同缺口

内容裁决之外，本次对真实实现做了两个最小反例，说明 issue 013 仍不能关闭：

1. **P0：confirmed 目标字段未严格校验。** 删除 `truth_version/dispute`，并把 `mentioned="false"`、`mentions=-7`、`recommendation="yes"`、`rank="first"`、`sentiment="excellent"` 写入 confirmed 记录，`validateTruthEntry()` 仍返回空错误数组。随后 loader 使用 `Boolean("false") === true`，会污染目标真值。
2. **P1：关系评分仍按名称字符串，而不是已要求的 span/entity 对齐。** 预测实体 `海康威视` 与 truth 实体 `杭州海康威视` 即使 span 指向同一实体且关系相同，当前 `relationQualityStats()` 仍给出 TP=0、FP=1、FN=1。
3. **P1：实体 type 枚举未校验。** v3 模板仍含 `organization`，而 Tech Spec 只允许 `brand/company/other_organization`；`validateTruthEntry()` 未拒绝该值。

因此 db097ef 已修复原先 5 项缺口的大部分路径，但“严格 truth schema”和“按对齐实体计算关系”仍未完全达到 Tech Spec。必须补回归测试并修复后，才能把经所有者确认的真值用于 014。

## 所有者确认动作

1. 数据所有者确认本报告中的目标与实体/关系裁决，尤其确认 S03 同位归并、S21 采购范围、S46 推荐口径、S50 并列第一和 S53 法律主体隔离。
2. 修复上述 1 个 P0、2 个 P1，并通过反例回归测试。
3. 把裁决写入新模板，保持原 answer hash/span 一致；清理字段与 notes 冲突。
4. 由真实复核人填写 reviewer/reviewed_at，将记录改为 `confirmed`，运行 truth preflight。

在完成以上动作前，013、014、015、010 均不得解锁。

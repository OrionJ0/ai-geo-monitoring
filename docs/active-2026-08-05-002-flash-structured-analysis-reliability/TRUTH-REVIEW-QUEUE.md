# 人工真值复核队列（issue 013 阻塞项）

> 状态：**等待人工复核**。issue 013 的 benchmark 代码与报告合同已完成，但以下真值缺少真实人工确认，按用户约定不得冒充人工签字，013 保持 blocked，不进入 PASS 门禁。

## 审计结论（2026-08-05）

| 真值类别 | 现状 | 是否可进入 PASS 门禁 |
| --- | --- | --- |
| 旧 40 条目标级标注（mentioned/mentions/recommended/rank/sentiment） | `LABELING.md` 头部全局 `human_review_confirmed: yes`（v3 时代标记） | 仅限旧 40 条本身；不得自动扩展到补充样本 |
| 补充样本 S41–S55 目标级标注 | `LABELING.md`“补充样本标注（009 真值扩充，待复核）”块，15 条，**无独立人工确认记录** | **否（待复核）** |
| 已输出竞品关系真值 | **不存在**：LABELING.md 无任何 relations 标注 | **否（缺失）** |
| 实体级真值（实体集合 / span / canonicalization） | `truth.jsonl` **不存在** | **否（缺失）** |
| 排名实例 | 标注 20 个（旧 8 + 补充 12），但补充部分未复核 | 部分（待复核） |

旧语料的全局 `human_review_confirmed` 只覆盖旧 40 条；补充样本与新增维度（关系、实体）必须单独复核后才能进入 015 的语义门禁。

## 需要人工复核的具体条目

### 1. 补充样本目标级标注（15 条，文件 `work/geo-baseline-2026-07-28/LABELING.md` 尾部“补充样本标注”块）

样本：S41、S42、S43、S44、S45、S46、S47、S48、S49、S50、S51、S52、S53、S54、S55。

每条核对四项，基于 `samples.json` 中同 `sample_id` 的 `response_text` 原回答，**不查看任何实验臂输出**：

- `mentioned`：目标品牌“广拓/上海广拓/Gato”是否在回答中出现。
- `mentions`：确定性出现次数。
- `recommended`：回答是否明确推荐目标品牌。
- `rank`：明确排名（无排名填 `none`）。
- `sentiment`：目标出现时的情绪（positive / neutral / negative / none）。

复核后把该块标题由“待复核”改为“已复核”，并追加每条记录：`reviewed_at`、`reviewer`、`dispute`（争议裁决，无争议填 `none`）。

### 2. 已输出竞品关系真值（至少 20 个可评估实例）

新建 `work/geo-baseline-2026-07-28/truth.jsonl`，为至少 20 条样本标注逐实体 `competitor / non_competitor` 判定（实体为回答中实际出现的组织）：

```json
{"sample_id":"S05","truth_version":"truth_v2_2026-08-05","review_status":"confirmed","reviewer":"<姓名>","reviewed_at":"<日期>","dispute":"none","entities":[{"canonical_name":"海康威视","surface_forms":["海康威视","Hikvision"],"type":"brand"}],"relations":[{"canonical_name":"海康威视","relation":"competitor"}],"recommendation":false,"rank":null,"sentiment":null}
```

字段说明：

- `review_status`：`confirmed`（已人工复核）或 `pending_review`；只有 `confirmed` 进入评估。
- `entities[]`：该样本回答中出现的**全部组织实体**（canonical_name + 原文表面词 + 类型）；组合实体（把多个品牌合成一个）与无依据拆分在此如实记录，评估时按组合/拆分规则计错。
- `relations[]`：每个实体在**当前问题**中是 `competitor` 还是 `non_competitor`（回答未给出依据时省略该实体）。
- `recommendation` / `rank` / `sentiment`：与 LABELING.md 一致的目标级标签，供各语义维度实例计数。

### 3. 实体级真值覆盖（同一 truth.jsonl 的 entities[]）

`entities[]` 同时提供实体 precision / recall / micro-F1 / canonicalization 的评估基础。逐字可定位但实体切分错误（组合、拆分）必须如实标注，评估按 issue 013 计分规则计错。

## 复核完成后的自动验收路径

1. 补充样本目标级复核完成 → 更新 `LABELING.md`（复核人/日期/裁决）。
2. `truth.jsonl` 填写完成（relations 与 entities 各 ≥20 个 `confirmed` 实例）→ benchmark 报告“实体与语义真值”从 `NOT_EVALUABLE` 变为 `EVALUATED`，语义真值覆盖门禁从 `NOT EVALUABLE` 变为 PASS/FAIL。
3. 复核确认后，issue 013 由人工确认关闭，014 探针才能按完整真值合同执行。

## 阻塞说明

- issue 013 状态：`blocked`（缺少真实人工复核，需用户或复核人完成上述条目）。
- 014 定向探针依赖 013 满足；在 013 解除阻塞前，014 不启动。
- 所有代码改动（benchmark 报告合同、字段状态/降级率、实体质量与真值覆盖函数）已提交，复核完成后无需再改代码。

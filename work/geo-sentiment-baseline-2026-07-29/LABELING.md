# GEO 情绪边界补充标注表

> 生成时间：2026-07-29；样本数：12
> 分析契约：ai_structured_v4；结构版本：geo_metric_input_v4；指标语义：contextual_competitor_mentions_sov_v1
> 用途：专门复核“目标品牌选择意愿”的正面、中性、负面与未提及边界。每条原回答固定保存，可逐句核验。

ai_panel_prelabelled: yes
ai_panel_review_status: pending_human_confirmation

human_review_confirmed: no

## 标注原则

- `positive`：回答整体增加选择目标品牌的理由，或明确建议、优先、认可目标品牌。
- `neutral`：只陈述事实、条件或平衡信息，没有形成增加或降低选择意愿的总体方向。
- `negative`：回答整体降低选择目标品牌的理由，或明确反对、排除、不建议目标品牌。
- `none`：原回答没有出现目标品牌名称或别名；不作为情绪样本。
- 这里的 12 条标签是 AI 预标，只有用户逐条确认后才能把 `human_review_confirmed` 改为 `yes`。

---

<!-- SAMPLE E01 -->
## E01 · 明确正面

**问题**：这几套云平台中更建议选哪一个？
**目标品牌**：星河云

---ANSWER---
星河云的迁移工具最完整，现有系统通常可以在较短时间内完成切换。虽然星河云的基础套餐并不是最低价，但它明显降低了后续运维复杂度。综合交付风险和长期成本，我建议优先选择星河云。
---LABELS---
mentioned: yes
mentions: 3
recommended: yes
rank: none
sentiment: positive
---END---

<!-- SAMPLE E02 -->
## E02 · 有缺点但总体正面

**问题**：预算有限时北辰智造还值得选吗？
**目标品牌**：北辰智造

---ANSWER---
北辰智造的采购价略高，短期预算压力确实更大。不过它的设备故障率较低，三年维护成本通常能覆盖前期价差。若项目会长期运行，北辰智造仍是更稳妥的选择。
---LABELS---
mentioned: yes
mentions: 2
recommended: yes
rank: none
sentiment: positive
---END---

<!-- SAMPLE E03 -->
## E03 · 基于适配性的正面

**问题**：云脉科技是否适合我们的全国项目？
**目标品牌**：云脉科技

---ANSWER---
云脉科技已经覆盖主要省会城市，并提供统一的跨区域服务流程。对于需要全国交付和集中管理的项目，这种能力能明显减少协调成本，因此云脉科技值得优先考虑。
---LABELS---
mentioned: yes
mentions: 2
recommended: yes
rank: none
sentiment: positive
---END---

<!-- SAMPLE E04 -->
## E04 · 纯事实中性

**问题**：介绍一下海岳安防的产品情况。
**目标品牌**：海岳安防

---ANSWER---
海岳安防提供门禁、视频监控和周界报警产品，支持本地部署与集中管理。公开产品资料显示，海岳安防的项目报价需要根据点位数量和服务范围单独核算。
---LABELS---
mentioned: yes
mentions: 2
recommended: no
rank: none
sentiment: neutral
---END---

<!-- SAMPLE E05 -->
## E05 · 权衡但无方向的中性

**问题**：松石软件的优缺点是什么？
**目标品牌**：松石软件

---ANSWER---
松石软件支持私有化部署，也提供标准接口；相应地，初次实施需要投入较多配置时间。是否选择松石软件取决于团队更看重数据控制还是快速上线，仅凭这些信息无法给出统一结论。
---LABELS---
mentioned: yes
mentions: 2
recommended: no
rank: none
sentiment: neutral
---END---

<!-- SAMPLE E06 -->
## E06 · 仅确认参与的中性

**问题**：蓝港数科参加了这个项目吗？
**目标品牌**：蓝港数科

---ANSWER---
项目公告将蓝港数科列为参与单位之一，但没有披露各参与方的具体工作范围。现有材料只能确认蓝港数科参与了项目，无法据此评价其方案表现。
---LABELS---
mentioned: yes
mentions: 2
recommended: no
rank: none
sentiment: neutral
---END---

<!-- SAMPLE E07 -->
## E07 · 明确负面

**问题**：远川系统适合用在核心生产环境吗？
**目标品牌**：远川系统

---ANSWER---
远川系统目前缺少大规模生产环境的公开案例，最近两个版本还出现过升级中断。对于不能停机的核心业务，这些风险尚未得到充分验证，因此现阶段不建议选择远川系统。
---LABELS---
mentioned: yes
mentions: 2
recommended: no
rank: none
sentiment: negative
---END---

<!-- SAMPLE E08 -->
## E08 · 有优点但总体负面

**问题**：晨星网络虽然便宜，是否值得采购？
**目标品牌**：晨星网络

---ANSWER---
晨星网络的报价有吸引力，基础功能也能满足日常使用。但其关键备件交付周期过长，故障后的恢复时间无法满足本项目要求。即使价格较低，也不适合作为本次采购选择。
---LABELS---
mentioned: yes
mentions: 1
recommended: no
rank: none
sentiment: negative
---END---

<!-- SAMPLE E09 -->
## E09 · 风险导致排除的负面

**问题**：拓原数据能否满足合规要求？
**目标品牌**：拓原数据

---ANSWER---
拓原数据尚未提供本项目要求的审计证明，对数据留存期限的说明也不完整。在这些材料补齐之前，采用拓原数据会带来明显合规风险，不应进入当前候选范围。
---LABELS---
mentioned: yes
mentions: 2
recommended: no
rank: none
sentiment: negative
---END---

<!-- SAMPLE E10 -->
## E10 · 问题提及但回答未提及目标

**问题**：凌峰科技在这些供应商中的表现怎么样？
**目标品牌**：凌峰科技

---ANSWER---
现有材料只介绍了安桥网络和启明系统：安桥网络交付更快，启明系统的定制能力更强。由于资料不完整，无法对其他供应商作出评价。
---LABELS---
mentioned: no
mentions: 0
recommended: no
rank: none
sentiment: none
---END---

<!-- SAMPLE E11 -->
## E11 · 泛化回答未提及目标

**问题**：微澜数据值得推荐吗？
**目标品牌**：微澜数据

---ANSWER---
判断供应商是否值得推荐，需要结合实际功能测试、合同条款、服务范围和客户案例。目前没有提供任何候选方案的资料，因此无法形成品牌层面的结论。
---LABELS---
mentioned: no
mentions: 0
recommended: no
rank: none
sentiment: none
---END---

<!-- SAMPLE E12 -->
## E12 · 仅列评估维度未提及目标

**问题**：清源智控和其他厂商相比如何？
**目标品牌**：清源智控

---ANSWER---
回答仅列出了本次评估维度，包括稳定性、实施周期、接口兼容性和售后响应。没有给出任何厂商名称或评测结果，不能据此进行品牌比较。
---LABELS---
mentioned: no
mentions: 0
recommended: no
rank: none
sentiment: none
---END---

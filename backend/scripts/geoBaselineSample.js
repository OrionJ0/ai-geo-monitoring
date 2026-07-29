#!/usr/bin/env node
/**
 * GEO 基线测量 - 抽样脚本
 *
 * 从真实监测记录（question_records + result_details）分层抽样，
 * 生成人工标注工作表 LABELING.md 与机器可读样本 samples.json。
 *
 * 用法：node backend/scripts/geoBaselineSample.js [--size 40] [--multi-entity-size 10]
 *   [--database backend/database.sqlite] [--out work/geo-baseline-2026-07-28]
 */
const path = require('path');

const databaseArgIndex = process.argv.indexOf('--database');
process.env.DB_STORAGE = databaseArgIndex >= 0
  ? path.resolve(process.argv[databaseArgIndex + 1])
  : path.resolve(__dirname, '../database.sqlite');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('fs');
const {
  CURRENT_ANALYSIS_CONTRACT,
  CURRENT_STRUCTURE_VERSION,
  CURRENT_METRIC_SEMANTICS
} = require('../services/GeoMetricSemanticsService');
const {
  QuestionRecord,
  ResultDetail,
  VisibilityMetric,
  BrandProject,
  BrandCompetitor
} = require('../models');

const SEED = 20260728;
const MIN_TEXT_LENGTH = 50;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    size: 40,
    multiEntitySize: 10,
    database: process.env.DB_STORAGE,
    out: path.resolve(__dirname, '../../work/geo-baseline-2026-07-28')
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--size') options.size = Number(args[index + 1]);
    if (args[index] === '--multi-entity-size') options.multiEntitySize = Number(args[index + 1]);
    if (args[index] === '--database') options.database = path.resolve(args[index + 1]);
    if (args[index] === '--out') options.out = path.resolve(args[index + 1]);
  }
  if (!Number.isInteger(options.size) || options.size < 1) throw new Error('--size 必须是正整数');
  if (
    !Number.isInteger(options.multiEntitySize)
    || options.multiEntitySize < 0
    || options.multiEntitySize > options.size
  ) {
    throw new Error('--multi-entity-size 必须是 0 至样本数之间的整数');
  }
  return options;
}

// 固定种子的可复现随机数（mulberry32）
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(rows, rand) {
  const copy = [...rows];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rand() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

/** 在“曾被分析为提及 / 未提及”两类之间交替取样，保证样本对两类 case 都有覆盖 */
function pickBalanced(records, target, rand) {
  const mentioned = shuffle(records.filter((row) => row.proxy_mentioned === true), rand);
  const notMentioned = shuffle(records.filter((row) => row.proxy_mentioned !== true), rand);
  const picked = [];
  let left = 0;
  let right = 0;
  while (picked.length < target && (left < mentioned.length || right < notMentioned.length)) {
    if (left < mentioned.length) picked.push(mentioned[left++]);
    if (picked.length < target && right < notMentioned.length) picked.push(notMentioned[right++]);
  }
  return picked;
}

function buildLabelingDoc(samples) {
  const multiEntityCount = samples.filter((sample) => sample.multi_entity_review).length;
  const header = `# GEO 基线测量标注表

> 生成时间：${new Date().toISOString()}；样本数：${samples.length}；种子：${SEED}
> 分析契约：${CURRENT_ANALYSIS_CONTRACT}；结构版本：${CURRENT_STRUCTURE_VERSION}；指标语义：${CURRENT_METRIC_SEMANTICS}
> 用途：测量当前分析器逐字段误差，并复核 ${multiEntityCount} 条多实体回答。请**不要**参考系统已有结果，独立盲标。

human_review_confirmed: no

## 标注规则（先读完再标）

对每条回答，针对**目标品牌**填写 5 个字段（写在每条回答末尾的 \`\`\`labels 块中）：

| 字段 | 取值 | 判定标准 |
| --- | --- | --- |
| mentioned | yes / no | 回答正文是否出现目标品牌的名称或别名。纯代词指代（“该公司”“它”）不算。 |
| mentions | 非负整数 | 品牌名/别名实际出现次数。同一位置的中英文连写（如“广拓（Guangtuo）”）算 1 次；代词不计；未提及填 0。 |
| recommended | yes / no | 回答是否**明确**推荐/首选/优先认可该品牌（“推荐”“首选”“值得优先考虑”“是更好的选择”等）。仅仅被列举在候选清单中填 no。 |
| rank | none 或 正整数 | 回答含**明确序号或名次**的候选榜单且品牌在其中时，填名次（1 起）。普通项目符号列表、正文自然顺序不算；无榜单或品牌不在榜填 none。 |
| sentiment | positive / neutral / negative / none | 回答对目标品牌的总体倾向；未提及填 none。 |

一致性约定：mentioned=no 时，mentions=0、recommended=no、rank=none、sentiment=none。

标有“多实体复核：是”的样本还必须填写一行 \`entity_labels_json\`。值是 JSON 数组，必须列出回答中的**全部企业实体**：

\`[{"name":"标准名称","aliases":["原文别名"],"mentions":2,"relation":"competitor"},{"name":"客户甲","aliases":[],"mentions":1,"relation":"non_competitor"}]\`

- \`name\`：人工归并后的企业标准名称。
- \`aliases\`：同一企业在原文中的其他名称；用它审查一个企业被拆成多个实体。
- \`mentions\`：该企业在原回答中的独立实际提及次数。
- \`relation\`：相对于当前问题和目标品牌，只能是 \`target\`、\`competitor\` 或 \`non_competitor\`。
- 人工复核全部完成后，将文首 \`human_review_confirmed\` 改为 \`yes\`。未确认只能运行 partial 报告。

填完后运行：\`node backend/scripts/geoBaselineEvaluate.js\`

---

`;
  const body = samples.map((sample) => {
    const aliasText = sample.brand.aliases.length ? sample.brand.aliases.join('、') : '无';
    const competitorText = sample.competitors.length
      ? sample.competitors.map((item) => item.name).join('、')
      : '无';
    return `<!-- SAMPLE ${sample.sample_id} -->
## ${sample.sample_id} · 平台 ${sample.platform} · 记录 #${sample.question_record_id}

**问题**：${sample.question}

**目标品牌**：${sample.brand.name}（别名：${aliasText}；已配置竞品：${competitorText}）
**多实体复核**：${sample.multi_entity_review ? '是' : '否'}

---ANSWER---
${sample.response_text}
---LABELS---
mentioned:
mentions:
recommended:
rank:
sentiment:
${sample.multi_entity_review ? 'entity_labels_json:' : ''}
---END---
`;
  }).join('\n');
  return header + body;
}

async function main() {
  const options = parseArgs();
  const rand = mulberry32(SEED);
  const database = require('../config/database');
  const queryInterface = database.getQueryInterface();
  const [questionColumns, metricColumns] = await Promise.all([
    queryInterface.describeTable('question_records'),
    queryInterface.describeTable('visibility_metrics')
  ]);
  const existing = (columns, names) => names.filter((name) => Object.hasOwn(columns, name));

  const records = await QuestionRecord.findAll({
    attributes: existing(questionColumns, [
      'id',
      'project_id',
      'platform',
      'question'
    ]),
    include: [
      {
        model: ResultDetail,
        as: 'resultDetail',
        required: true,
        attributes: ['id', 'question_record_id', 'ai_response_original']
      },
      {
        model: VisibilityMetric,
        as: 'visibilityMetric',
        required: false,
        attributes: existing(metricColumns, [
          'id',
          'question_record_id',
          'brand_mentioned',
          'brand_mentions',
          'brand_recommended',
          'brand_rank',
          'sentiment',
          'analysis_method',
          'metric_semantics_version',
          'analysis_structure',
          'answer_competitor_share',
          'sov_numerator',
          'sov_denominator'
        ])
      }
    ],
    order: [['id', 'ASC']]
  });
  const projects = await BrandProject.findAll();
  const competitors = await BrandCompetitor.findAll();
  const projectMap = new Map(projects.map((item) => [item.id, item.toJSON()]));

  const candidates = records
    .filter((record) => String(record.resultDetail?.ai_response_original || '').length > MIN_TEXT_LENGTH)
    .map((record) => {
      const project = projectMap.get(record.project_id) || {};
      const storedMetric = record.visibilityMetric?.toJSON
        ? record.visibilityMetric.toJSON()
        : (record.visibilityMetric || null);
      const storedEntities = Array.isArray(storedMetric?.analysis_structure?.entities)
        ? storedMetric.analysis_structure.entities
        : [];
      return {
        analysis_contract_version: CURRENT_ANALYSIS_CONTRACT,
        structure_version: CURRENT_STRUCTURE_VERSION,
        metric_semantics_version: CURRENT_METRIC_SEMANTICS,
        question_record_id: record.id,
        project_id: record.project_id,
        platform: record.platform,
        question: String(record.question || '').trim(),
        brand: {
          name: project.name || '',
          aliases: Array.isArray(project.aliases) ? project.aliases : [],
          website: project.website || null,
          primary_keywords: Array.isArray(project.primary_keywords) ? project.primary_keywords : []
        },
        competitors: competitors
          .filter((item) => item.project_id === record.project_id)
          .map((item) => ({
            id: item.id,
            name: item.name,
            aliases: Array.isArray(item.aliases) ? item.aliases : [],
            website: item.website || null
          })),
        proxy_mentioned: storedMetric
          ? Boolean(storedMetric.brand_mentioned)
          : null,
        stored_metric: storedMetric ? {
          analysis_method: storedMetric.analysis_method || null,
          metric_semantics_version: storedMetric.metric_semantics_version || null,
          brand_mentioned: Boolean(storedMetric.brand_mentioned),
          brand_mentions: Number(storedMetric.brand_mentions || 0),
          brand_recommended: Boolean(storedMetric.brand_recommended),
          brand_rank: Number(storedMetric.brand_rank) > 0 ? Number(storedMetric.brand_rank) : null,
          sentiment: storedMetric.sentiment || null,
          answer_competitor_share: storedMetric.answer_competitor_share ?? null,
          sov_numerator: storedMetric.sov_numerator ?? null,
          sov_denominator: storedMetric.sov_denominator ?? null
        } : null,
        proxy_entity_count: storedEntities.length,
        response_text: record.resultDetail.ai_response_original
      };
    });
  if (candidates.length < options.size) {
    throw new Error(
      `可用真实回答只有 ${candidates.length} 条，少于要求的 ${options.size} 条；拒绝覆盖现有标注文件`
    );
  }

  // 网页版样本（真实用户登录页面证据）全部保留；API 平台按配额平衡抽取
  const webSamples = candidates
    .filter((row) => row.platform.endsWith('-web'))
    .slice(0, options.size);
  const apiPlatforms = [...new Set(candidates.map((row) => row.platform))]
    .filter((platform) => !platform.endsWith('-web'))
    .sort();
  const remaining = Math.max(0, options.size - webSamples.length);
  const baseQuota = Math.floor(remaining / apiPlatforms.length);
  const quotas = new Map(apiPlatforms.map((platform) => [platform, baseQuota]));

  const picked = [...webSamples];
  const leftovers = [];
  for (const platform of apiPlatforms) {
    const pool = candidates.filter((row) => row.platform === platform);
    const chosen = pickBalanced(pool, quotas.get(platform), rand);
    picked.push(...chosen);
    const chosenIds = new Set(chosen.map((row) => row.question_record_id));
    leftovers.push(...pool.filter((row) => !chosenIds.has(row.question_record_id)));
  }
  // 配额不足的平台由其余平台的剩余样本补足
  if (picked.length < options.size) {
    picked.push(...shuffle(leftovers, rand).slice(0, options.size - picked.length));
  }

  picked.sort((a, b) => (
    a.platform.localeCompare(b.platform) || a.question_record_id - b.question_record_id
  ));
  const samples = picked.map((row, index) => ({
    sample_id: `S${String(index + 1).padStart(2, '0')}`,
    ...row
  }));
  const multiEntityIds = new Set([...samples]
    .sort((a, b) => (
      b.proxy_entity_count - a.proxy_entity_count
      || a.sample_id.localeCompare(b.sample_id)
    ))
    .slice(0, options.multiEntitySize)
    .map((sample) => sample.sample_id));
  samples.forEach((sample) => {
    sample.multi_entity_review = multiEntityIds.has(sample.sample_id);
    delete sample.proxy_entity_count;
  });

  fs.mkdirSync(options.out, { recursive: true });
  fs.mkdirSync(path.join(options.out, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(options.out, 'samples.json'), JSON.stringify(samples, null, 2));
  fs.writeFileSync(path.join(options.out, 'LABELING.md'), buildLabelingDoc(samples));

  const byPlatform = {};
  const byProxy = { mentioned: 0, not_mentioned: 0, unknown: 0 };
  samples.forEach((sample) => {
    byPlatform[sample.platform] = (byPlatform[sample.platform] || 0) + 1;
    if (sample.proxy_mentioned === true) byProxy.mentioned += 1;
    else if (sample.proxy_mentioned === false) byProxy.not_mentioned += 1;
    else byProxy.unknown += 1;
  });
  console.log(`抽样完成：共 ${samples.length} 条（候选 ${candidates.length} 条），其中多实体复核 ${multiEntityIds.size} 条`);
  console.log('平台分布：', JSON.stringify(byPlatform));
  console.log('分层分布（历史分析提及情况，仅供平衡）：', JSON.stringify(byProxy));
  console.log(`输出目录：${options.out}`);
  console.log('下一步：打开 LABELING.md 完成人工标注');

  await require('../config/database').close();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('抽样失败：', error);
    process.exit(1);
  });
}

module.exports = {
  buildLabelingDoc,
  mulberry32,
  pickBalanced,
  parseArgs
};

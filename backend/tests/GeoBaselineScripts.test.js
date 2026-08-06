const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const samplePath = path.resolve(__dirname, '../scripts/geoBaselineSample.js');
const evaluatePath = path.resolve(__dirname, '../scripts/geoBaselineEvaluate.js');
const sentimentBaselineDir = path.resolve(
  __dirname,
  '../../work/geo-sentiment-baseline-2026-07-29'
);
const sampleScript = require('../scripts/geoBaselineSample');
const evaluateScript = require('../scripts/geoBaselineEvaluate');
const {
  AIResponseAnalysisService: V4BaselineAnalyzer
} = require('../evaluation/AIResponseAnalysisV4BaselineService');
const v4BaselineAnalyzer = new V4BaselineAnalyzer();

test('评测实验隔离输出目录并保留同一份样本和人工真值', () => {
  const options = evaluateScript.parseArgs([
    '--platform', 'deepseek',
    '--experiment-name', 'choice-set-high',
    '--refresh'
  ]);
  const baseDir = path.resolve('/tmp/geo-baseline-fixture');
  const paths = evaluateScript.initPaths(baseDir, options.experimentName);

  assert.equal(Object.hasOwn(options, 'promptStrategy'), false);
  assert.equal(Object.hasOwn(options, 'deepseekThinking'), false);
  assert.equal(paths.samples, path.join(baseDir, 'samples.json'));
  assert.equal(paths.labeling, path.join(baseDir, 'LABELING.md'));
  assert.equal(
    paths.report,
    path.join(baseDir, 'experiments', 'choice-set-high', 'BASELINE-REPORT.md')
  );
  assert.equal(
    paths.raw,
    path.join(baseDir, 'experiments', 'choice-set-high', 'raw')
  );
});

test('评测分析器只暴露正式提示词与默认关闭思考路径', async () => {
  const { analyzer, via } = await evaluateScript.buildAnalyzer({
    platform: null
  });
  const definition = analyzer.getPromptDefinition();

  assert.equal(definition.prompt_revision, 'semantic_evidence_field_repair_v8');
  assert.equal(definition.request_profile.deepseek_thinking, 'disabled');
  assert.match(via, /semantic_evidence_field_repair_v8/);
  assert.match(via, /thinking=disabled/);
});

test('人工基线抽样文件声明冻结 v4 契约并标记 10 条多实体复核样本', () => {
  const source = fs.readFileSync(samplePath, 'utf8');

  assert.match(source, /BASELINE_ANALYSIS_CONTRACT/);
  assert.match(source, /BASELINE_STRUCTURE_VERSION/);
  assert.match(source, /BASELINE_METRIC_SEMANTICS/);
  assert.match(source, /multi_entity_review/);
  assert.match(source, /multiEntitySize:\s*10/);
  assert.match(source, /stored_metric/);
  assert.match(source, /entity_labels_json/);
  assert.match(source, /少于要求的.*拒绝覆盖现有标注文件/);
});

test('人工基线评测拒绝旧缓存、传入完整上下文且不泄露人工竞品', () => {
  const source = fs.readFileSync(evaluatePath, 'utf8');

  assert.doesNotMatch(source, /CURRENT_ANALYSIS_CONTRACT/);
  assert.match(source, /ANALYSIS_METHOD/);
  assert.match(source, /CURRENT_STRUCTURE_VERSION/);
  assert.match(source, /CURRENT_METRIC_SEMANTICS/);
  assert.match(source, /cached\.ok === true/);
  assert.match(source, /cached\.analysis_method === ANALYSIS_METHOD/);
  assert.match(source, /cached\.analysis_prompt_revision === CURRENT_PROMPT_REVISION/);
  assert.match(source, /cached\.analysis_input_fingerprint === inputFingerprint/);
  assert.match(source, /identity\.requestPolicyFingerprint/);
  assert.match(source, /schema_version === CURRENT_STRUCTURE_VERSION/);
  assert.match(source, /question:\s*sample\.question/);
  assert.doesNotMatch(source, /competitorHints:\s*sample\.competitors/);
});

test('v4 基线缓存身份随完整输入和实际请求参数变化', () => {
  const base = {
    question: '工业园区如何选设备？',
    response_text: '完整回答',
    brand: { name: '广拓', aliases: ['GATO'] }
  };
  assert.notEqual(
    evaluateScript.analysisInputFingerprint(base),
    evaluateScript.analysisInputFingerprint({ ...base, response_text: '另一份回答' })
  );
  const platform = {
    code: 'deepseek',
    adapter_type: 'openai_chat_completions',
    default_model: 'deepseek-v4-pro',
    analysis_request_options: { temperature: 0 }
  };
  assert.notEqual(
    evaluateScript.requestPolicyFingerprint(v4BaselineAnalyzer, platform),
    evaluateScript.requestPolicyFingerprint(
      v4BaselineAnalyzer,
      { ...platform, analysis_request_options: { temperature: 0.2 } }
    )
  );
});

test('默认基线运行冻结同一平台快照供请求与缓存身份使用', async () => {
  const platform = {
    code: 'deepseek',
    adapter_type: 'openai_chat_completions',
    default_model: 'deepseek-v4-pro',
    analysis_request_options: { temperature: 0 }
  };
  const built = await evaluateScript.buildAnalyzer({
    platform: null,
    resolveIdentity: true,
    analysisConfigService: { getAnalysisPlatform: async () => platform }
  });
  platform.analysis_request_options.temperature = 0.9;

  const frozen = await built.analyzer.configService.getAnalysisPlatform();
  assert.equal(frozen.analysis_request_options.temperature, 0);
  assert.equal(
    built.identity.requestPolicyFingerprint,
    evaluateScript.requestPolicyFingerprint(built.analyzer, frozen)
  );
});

test('复用 AI 结构缓存时按当前确定性计算器刷新派生指标', () => {
  const cached = {
    ok: true,
    result: {
      brand_mentions: 3,
      answer_competitor_share: 13.64,
      analysis_platform: 'deepseek',
      analysis_structure: {
        schema_version: 'geo_metric_input_v4',
        entities: []
      }
    }
  };
  const refreshed = evaluateScript.recalculateCachedResult(cached, {
    calculate: (structure) => ({
      brand_mentions: 2,
      answer_competitor_share: 9.52,
      analysis_structure: structure
    })
  });

  assert.equal(refreshed.result.brand_mentions, 2);
  assert.equal(refreshed.result.answer_competitor_share, 9.52);
  assert.equal(refreshed.result.analysis_platform, 'deepseek');
  assert.equal(refreshed.result.analysis_structure, cached.result.analysis_structure);
});

test('多实体评审报告量化错误纳入、错误排除、别名拆分与 SOV 影响', () => {
  const source = fs.readFileSync(evaluatePath, 'utf8');

  assert.match(source, /entity_labels_json/);
  assert.match(source, /false_inclusions/);
  assert.match(source, /false_exclusions/);
  assert.match(source, /alias_splits/);
  assert.match(source, /sov_impact/);
  assert.match(source, /human_review_confirmed/);
  assert.match(source, /未完成人工确认/);
});

test('partial 模式只保留字段完整且多实体真值完整的样本', () => {
  const samples = [
    { sample_id: 'S01', multi_entity_review: false },
    { sample_id: 'S02', multi_entity_review: true },
    { sample_id: 'S03', multi_entity_review: false }
  ];
  const labels = new Map([
    ['S01', {
      mentioned: false,
      mentions: 0,
      recommended: false,
      rank: null,
      sentiment: null
    }],
    ['S02', {
      mentioned: true,
      mentions: 1,
      recommended: false,
      rank: null,
      sentiment: 'neutral'
    }],
    ['S03', { mentioned: true, __partial: true }]
  ]);

  const partial = evaluateScript.validateLabels(samples, labels, true, false);
  assert.deepEqual([...partial.usable.keys()], ['S01']);
  assert.deepEqual(partial.problems, []);

  const formal = evaluateScript.validateLabels(samples, labels, false, false);
  assert.match(formal.problems.join('\n'), /未完成人工确认/);
  assert.match(formal.problems.join('\n'), /S02: 多实体复核缺少 entity_labels_json/);
  assert.match(formal.problems.join('\n'), /S03: 标注不完整/);
});

test('多实体审查按人工归并实体计算错误关系和 SOV 偏差', () => {
  const label = {
    mentioned: true,
    mentions: 2,
    entity_labels_json: [
      { name: '目标品牌', aliases: [], mentions: 2, relation: 'target' },
      { name: '竞品甲', aliases: ['甲公司'], mentions: 2, relation: 'competitor' },
      { name: '客户乙', aliases: [], mentions: 1, relation: 'non_competitor' }
    ]
  };
  const analysis = {
    brand_mentions: 2,
    answer_competitor_share: 66.67,
    analysis_structure: {
      target_entity_name: '目标品牌',
      entities: [
        { name: '目标品牌' },
        { name: '甲公司' },
        { name: '客户乙' }
      ],
      mentions: [
        { entity_name: '目标品牌', surface_forms: ['目标品牌'] },
        { entity_name: '甲公司', surface_forms: ['甲公司'] },
        { entity_name: '客户乙', surface_forms: ['客户乙'] }
      ]
    },
    competition_entities: [
      { name: '甲公司', relation: 'non_competitor', mentions: 2 },
      { name: '客户乙', relation: 'competitor', mentions: 1 }
    ]
  };

  const result = evaluateScript.reviewMultiEntitySample(
    { sample_id: 'S01' },
    label,
    analysis
  );

  assert.deepEqual(result.false_inclusions, ['客户乙']);
  assert.deepEqual(result.false_exclusions, ['竞品甲']);
  assert.equal(result.truth_sov, 50);
  assert.equal(result.predicted_sov, 66.67);
  assert.equal(result.sov_impact, 16.67);
});

test('多实体 SOV 汇总把 N/A 可计算性错配与数值偏差分开统计', () => {
  const summary = evaluateScript.summarizeMultiEntityReviews([
    {
      false_inclusions: [],
      false_exclusions: ['竞品甲'],
      alias_splits: [],
      missing_entities: [],
      extra_entities: [],
      truth_sov: 0,
      predicted_sov: null,
      sov_impact: null
    },
    {
      false_inclusions: [],
      false_exclusions: [],
      alias_splits: [],
      missing_entities: [],
      extra_entities: [],
      truth_sov: 50,
      predicted_sov: 60,
      sov_impact: 10
    }
  ]);

  assert.equal(summary.evaluated, 2);
  assert.equal(summary.sov_comparable, 1);
  assert.equal(summary.calculability_mismatches, 1);
  assert.equal(summary.truth_calculable, 2);
  assert.equal(summary.predicted_calculable, 1);
  assert.equal(summary.mean_absolute_sov_impact, 10);
  assert.equal(summary.truth_aggregate_sov, 25);
  assert.equal(summary.predicted_aggregate_sov, 60);
  assert.equal(summary.aggregate_sov_bias, 35);
});

test('正式报告保留分析失败的多实体样本并标记为不可评估', () => {
  const emptyStats = () => ({
    total: 0,
    mentioned: { tp: 0, fp: 0, fn: 0, tn: 0 },
    recommended: { tp: 0, fp: 0, fn: 0, tn: 0 },
    mentions: { exact: 0, within1: 0, absError: 0, signedError: 0 },
    rank: { evaluated: 0, exact: 0, falseRank: 0, missedRank: 0, wrongRank: 0 },
    sentiment: { evaluated: 0, correct: 0, confusion: {} }
  });
  const rows = [
    {
      sample: { sample_id: 'S01' },
      false_inclusions: [],
      false_exclusions: [],
      alias_splits: [],
      missing_entities: [],
      extra_entities: [],
      truth_sov: 50,
      predicted_sov: 50,
      sov_impact: 0
    },
    {
      sample: { sample_id: 'S02' },
      analysis_failed: true,
      error_code: 'invalid_analysis_output',
      false_inclusions: [],
      false_exclusions: [],
      alias_splits: [],
      missing_entities: [],
      extra_entities: [],
      truth_sov: 0,
      predicted_sov: null,
      sov_impact: null
    }
  ];
  const report = evaluateScript.buildReport({
    samples: [{ sample_id: 'S01' }, { sample_id: 'S02' }],
    analyses: [],
    rerunRows: [],
    rerunStats: emptyStats(),
    storedStats: emptyStats(),
    storedCount: 0,
    reproducibility: {
      total: 0,
      fields: {
        mentioned: { agree: 0 },
        mentions: { agree: 0 },
        recommended: { agree: 0 },
        rank: { agree: 0 },
        sentiment: { agree: 0 }
      },
      disagreements: []
    },
    platformBreakdown: [],
    analysisFailures: 1,
    via: 'test',
    multiEntityRows: rows,
    multiEntitySummary: evaluateScript.summarizeMultiEntityReviews(rows),
    human_review_confirmed: true,
    partial: false
  });

  assert.match(report, /已完成 2 条多实体真值复核；分析成功 1 条；分析失败 1 条/);
  assert.match(report, /SOV 数值可比 1 条，可计算性错配 0 条/);
  assert.match(report, /\| S02 \| 不可评估 \| 不可评估 \| 不可评估 \| 分析失败（invalid_analysis_output）/);
});

test('标注模板声明人工确认且只为指定样本生成多实体输入', () => {
  const samples = Array.from({ length: 40 }, (_, index) => ({
    sample_id: `S${String(index + 1).padStart(2, '0')}`,
    platform: 'deepseek',
    question_record_id: index + 1,
    question: '测试问题',
    response_text: '测试回答',
    brand: { name: '目标品牌', aliases: [] },
    competitors: [],
    multi_entity_review: index < 10
  }));

  const doc = sampleScript.buildLabelingDoc(samples);
  assert.match(doc, /human_review_confirmed: no/);
  assert.equal((doc.match(/^entity_labels_json:/gmu) || []).length, 10);
  assert.equal((doc.match(/^mentioned:/gmu) || []).length, 40);
});

test('补充情绪边界集覆盖三种情绪与未提及且仍等待人工确认', () => {
  const samples = JSON.parse(
    fs.readFileSync(path.join(sentimentBaselineDir, 'samples.json'), 'utf8')
  );
  const labeling = fs.readFileSync(
    path.join(sentimentBaselineDir, 'LABELING.md'),
    'utf8'
  );

  assert.ok(samples.length >= 8);
  assert.ok(samples.every((sample) => (
    sample.analysis_contract_version === 'ai_structured_v4'
    && sample.structure_version === 'geo_metric_input_v4'
    && typeof sample.question === 'string'
    && typeof sample.response_text === 'string'
    && sample.response_text.length > 0
  )));
  assert.match(labeling, /^human_review_confirmed:\s*no$/mu);
  assert.match(labeling, /^sentiment:\s*positive$/mu);
  assert.match(labeling, /^sentiment:\s*neutral$/mu);
  assert.match(labeling, /^sentiment:\s*negative$/mu);
  assert.match(labeling, /^sentiment:\s*none$/mu);
});

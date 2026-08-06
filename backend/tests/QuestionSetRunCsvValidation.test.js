const test = require('node:test');
const assert = require('node:assert/strict');

const QuestionSetRunCsvService = require('../services/QuestionSetRunCsvService');

function reportWith(overrides = {}, rowOverrides = {}) {
  return {
    id: 123,
    question_set_name: 'CSV 边界测试',
    analysis_contract_version: 'geo_metric_input_v2',
    started_at: new Date('2026-07-26T01:00:00.000Z'),
    completed_at: new Date('2026-07-26T01:05:00.000Z'),
    ...overrides,
    rows: [{
      record_id: 11,
      question_id: 22,
      question: '周界报警厂商怎么选？',
      question_category: '购买决策',
      platform: 'deepseek',
      platform_name: 'DeepSeek',
      model_name: 'deepseek-chat',
      status: 'completed',
      error_message: '',
      answer: '上海广拓可作为候选。',
      has_metrics: true,
      brand_mentioned: true,
      brand_mentions: 1,
      brand_rank: 1,
      brand_recommended: false,
      share_of_voice: 50,
      citation_count: 1,
      owned_citation_count: 1,
      competitor_citation_count: 0,
      sentiment: 'neutral',
      sentiment_reason: '',
      competitor_mentions: [],
      citation_sources: [{
        url: 'https://example.com/source',
        domain: 'example.com',
        owned: true
      }],
      legacy_citation_count: 0,
      legacy_citation_sources: [],
      created_at: new Date('2026-07-26T01:00:10.000Z'),
      updated_at: new Date('2026-07-26T01:04:00.000Z'),
      analysis_method: 'ai_structured_v2',
      analysis_platform: 'deepseek',
      analysis_model: 'deepseek-chat',
      analysis_structure: {},
      analysis_evidence: {},
      failure: null,
      retry: null,
      analysis_diagnostics: null,
      ...rowOverrides
    }]
  };
}

function parseReport(overrides = {}, rowOverrides = {}) {
  return QuestionSetRunCsvService.parseCsv(
    QuestionSetRunCsvService.buildCsv(reportWith(overrides, rowOverrides))
  );
}

function currentReport(rowOverrides = {}) {
  return reportWith({
    analysis_contract_version: 'ai_structured_v5',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped'
  }, {
    analysis_method: 'ai_structured_v5',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    share_of_voice: null,
    answer_competitor_share: 50,
    sov_numerator: 1,
    sov_denominator: 2,
    competition_entities: [{
      name: '海康',
      relation: 'competitor',
      mentions: 1,
      reason: '提供同类周界方案',
      evidence: ['上海广拓可作为候选'],
      surface_forms: ['海康']
    }],
    analysis_structure: {
      schema_version: 'geo_metric_input_v5',
      target_fact: {
        status: 'complete',
        brand_mentioned: true,
        brand_mentions: 1,
        mentions: []
      },
      target_semantics: {
        status: 'complete',
        recommendation: { status: 'assessed', value: false },
        rank: { status: 'assessed', value: 1 },
        sentiment: { status: 'assessed', value: 'neutral' }
      },
      sov: {
        status: 'observed_only',
        scope: 'open_discovery',
        completeness: 'not_proven',
        numerator: 1,
        denominator: 2,
        value: 50
      },
      candidate_lists: [{
        ordered: true,
        entries: ['上海广拓', '海康'],
        reason: '回答表达了顺序',
        evidence: ['上海广拓可作为候选']
      }],
      sentiment: {
        label: 'neutral',
        reason: '事实陈述',
        evidence: ['上海广拓可作为候选'],
        risk_terms: []
      }
    },
    ...rowOverrides
  });
}

test('新版 CSV 在旧列尾部追加可判定语义并保持旧 SOV 列为空', () => {
  const csv = QuestionSetRunCsvService.buildCsv(currentReport());
  const parsed = QuestionSetRunCsvService.parseCsv(csv);

  assert.deepEqual(QuestionSetRunCsvService.HEADERS.slice(-5), [
    'metric_semantics_version',
    'answer_competitor_share',
    'sov_numerator',
    'sov_denominator',
    'competition_entities_json'
  ]);
  assert.equal(parsed.metricSemanticsVersion, 'contextual_competitor_mentions_sov_v2_scoped');
  assert.equal(parsed.rows[0].share_of_voice, null);
  assert.equal(parsed.rows[0].answer_competitor_share, 50);
  assert.equal(parsed.rows[0].sov_numerator, 1);
  assert.equal(parsed.rows[0].sov_denominator, 2);
  assert.equal(parsed.rows[0].competition_entities[0].reason, '提供同类周界方案');
  assert.deepEqual(
    parsed.rows[0].competition_entities[0].evidence,
    ['上海广拓可作为候选']
  );
  assert.deepEqual(
    parsed.rows[0].analysis_structure.sentiment.evidence,
    ['上海广拓可作为候选']
  );
});

test('回答格式通过兼容追加列往返', () => {
  const parsed = QuestionSetRunCsvService.parseCsv(
    QuestionSetRunCsvService.buildCsv(currentReport({
      answer: '上海广拓可作为候选。\n\n| 厂家 | 特点 |\n| --- | --- |\n| 上海广拓 | 定位精确 |',
      answer_format: 'markdown_v1'
    }))
  );
  assert.equal(parsed.rows[0].answer_format, 'markdown_v1');
});

test('新版 CSV 拒绝旧列值、混合语义、非法分母和非法竞争实体证据', () => {
  // v5 契约下竞争实体证据由 source_id 封闭引用（CSV 不强制 evidence 数组）；
  // 历史 v4 契约仍强制 evidence（010 只读兼容路径），显式构造 v4 契约报告验证。
  const v4ForcedReport = currentReport({
    competition_entities: [{
      name: '海康',
      relation: 'competitor',
      mentions: 1,
      reason: '提供同类周界方案',
      surface_forms: ['海康']
    }]
  });
  v4ForcedReport.analysis_contract_version = 'ai_structured_v4';
  v4ForcedReport.metric_semantics_version = 'contextual_competitor_mentions_sov_v1';
  v4ForcedReport.rows[0].analysis_method = 'ai_structured_v4';
  v4ForcedReport.rows[0].metric_semantics_version = 'contextual_competitor_mentions_sov_v1';
  v4ForcedReport.rows[0].analysis_structure.schema_version = 'geo_metric_input_v4';
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(v4ForcedReport)
    ),
    (error) => error.code === 'INVALID_COMPETITION_ENTITY'
  );
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(currentReport({ share_of_voice: 50 }))
    ),
    (error) => error.code === 'METRIC_SEMANTICS_MISMATCH' && error.column === 'share_of_voice'
  );
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(currentReport({
        sov_numerator: 3,
        sov_denominator: 2
      }))
    ),
    (error) => error.code === 'INVALID_SOV_COUNTS'
  );
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(currentReport({
        competition_entities: [{
          name: '海康',
          relation: 'uncertain',
          mentions: 1,
          reason: ''
        }]
      }))
    ),
    (error) => error.code === 'INVALID_COMPETITION_ENTITY'
  );

  const mixed = currentReport();
  mixed.rows.push({
    ...mixed.rows[0],
    record_id: 12,
    metric_semantics_version: 'configured_competitor_sov_v1',
    share_of_voice: 50,
    answer_competitor_share: null,
    sov_numerator: null,
    sov_denominator: null,
    competition_entities: []
  });
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(QuestionSetRunCsvService.buildCsv(mixed)),
    (error) => error.code === 'MIXED_METRIC_SEMANTICS'
  );
});

test('v5 CSV 拒绝未知合同、错误方法和缺失权威语义结构', () => {
  const unknownContract = currentReport();
  unknownContract.analysis_contract_version = 'unknown_contract_v99';
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(unknownContract)
    ),
    (error) => error.code === 'UNSUPPORTED_ANALYSIS_CONTRACT'
  );
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(currentReport({
        analysis_method: 'ai_structured_v4'
      }))
    ),
    (error) => error.code === 'ANALYSIS_CONTRACT_MISMATCH'
  );
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(currentReport({ analysis_structure: {} }))
    ),
    (error) => error.code === 'INVALID_V5_ANALYSIS_STRUCTURE'
  );
  const disguisedV4 = currentReport({
    analysis_method: 'ai_structured_v4',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v1'
  });
  disguisedV4.metric_semantics_version = 'contextual_competitor_mentions_sov_v1';
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(disguisedV4)
    ),
    (error) => error.code === 'ANALYSIS_CONTRACT_MISMATCH'
  );
});

test('历史 v3 与迁移生成的 legacy_unknown CSV 仍可只读往返', () => {
  const v3 = reportWith({
    analysis_contract_version: 'ai_structured_v3',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v1'
  }, {
    analysis_method: 'ai_structured_v3',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v1',
    share_of_voice: null,
    answer_competitor_share: 50,
    sov_numerator: 1,
    sov_denominator: 2,
    competition_entities: [{
      name: '海康',
      relation: 'competitor',
      mentions: 1,
      reason: '历史 v3 竞品证据',
      evidence: ['上海广拓可作为候选'],
      surface_forms: ['海康']
    }]
  });
  assert.equal(
    QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(v3)
    ).analysisContractVersion,
    'ai_structured_v3'
  );

  const migratedLegacy = reportWith({
    analysis_contract_version: 'legacy_unknown'
  }, {
    analysis_method: 'legacy_rules_v1'
  });
  assert.equal(
    QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(migratedLegacy)
    ).analysisContractVersion,
    'legacy_unknown'
  );
});

test('v5 CSV 拒绝目标事实、SOV、推荐与情绪的跨字段矛盾', () => {
  const contradictoryFact = currentReport();
  contradictoryFact.rows[0].analysis_structure.target_fact.brand_mentioned = false;
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(contradictoryFact)
    ),
    (error) => error.code === 'INVALID_V5_ANALYSIS_STRUCTURE'
  );

  const contradictorySov = currentReport();
  contradictorySov.rows[0].analysis_structure.target_fact.brand_mentions = 2;
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(contradictorySov)
    ),
    (error) => error.code === 'INVALID_V5_ANALYSIS_STRUCTURE'
  );

  const invalidSentiment = currentReport();
  invalidSentiment.rows[0].sentiment = 'excited';
  invalidSentiment.rows[0].analysis_structure.target_semantics.sentiment.value = 'excited';
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(invalidSentiment)
    ),
    (error) => error.code === 'INVALID_V5_ANALYSIS_STRUCTURE'
  );

  const unresolvedRecommendation = currentReport();
  unresolvedRecommendation.rows[0].brand_recommended = true;
  unresolvedRecommendation.rows[0].analysis_structure.target_semantics.recommendation.value = true;
  const unresolvedRecommendationCsv = QuestionSetRunCsvService
    .buildCsv(unresolvedRecommendation)
    .replace(
      '""target_semantics"":{""status"":""complete""',
      '""target_semantics"":{""status"":""partial""'
    )
    .replace(
      '""recommendation"":{""status"":""assessed"",""value"":true',
      '""recommendation"":{""status"":""unresolved"",""value"":null'
    );
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(unresolvedRecommendationCsv),
    (error) => error.code === 'V5_ANALYSIS_SCALAR_MISMATCH'
  );

  const inapplicableWhenPresent = currentReport();
  inapplicableWhenPresent.rows[0].analysis_structure.target_semantics.recommendation = {
    status: 'not_applicable',
    value: null
  };
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(inapplicableWhenPresent)
    ),
    (error) => error.code === 'INVALID_V5_ANALYSIS_STRUCTURE'
  );
});

test('v5 CSV 拒绝权威语义结构与兼容标量冲突', () => {
  const csv = QuestionSetRunCsvService.buildCsv(currentReport());
  const conflictingRank = csv.replace('""value"":1', '""value"":99');

  assert.notEqual(conflictingRank, csv, '测试应成功改写结构内排名而保留 CSV 标量');
  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(conflictingRank),
    (error) => error.code === 'V5_ANALYSIS_SCALAR_MISMATCH'
  );
});

test('新版失败行保持所有指标单元格为空', () => {
  const failed = currentReport({
    status: 'failed',
    has_metrics: false,
    brand_mentioned: false,
    brand_mentions: 0,
    brand_rank: null,
    brand_recommended: false,
    sentiment: '',
    analysis_structure: {},
    answer_competitor_share: null,
    sov_numerator: null,
    sov_denominator: null,
    competition_entities: []
  });
  const parsed = QuestionSetRunCsvService.parseCsv(
    QuestionSetRunCsvService.buildCsv(failed)
  );

  assert.equal(parsed.rows[0].answer_competitor_share, null);
  assert.equal(parsed.rows[0].sov_numerator, null);
  assert.equal(parsed.rows[0].sov_denominator, null);

  assert.throws(
    () => QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(currentReport({
        status: 'failed',
        has_metrics: true
      }))
    ),
    (error) => error.code === 'FAILED_ROW_HAS_METRICS'
  );

  const normalizedFailure = currentReport({
    status: 'failed',
    has_metrics: false,
    brand_mentioned: false,
    brand_mentions: 0,
    brand_rank: null,
    brand_recommended: false,
    sentiment: '',
    analysis_method: 'legacy_rules_v1',
    analysis_structure: {},
    answer_competitor_share: null,
    sov_numerator: null,
    sov_denominator: null,
    competition_entities: []
  });
  assert.equal(
    QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(normalizedFailure)
    ).rows[0].analysis_method,
    'legacy_rules_v1'
  );
  for (const method of ['unknown_method_v99', 'x'.repeat(41)]) {
    normalizedFailure.rows[0].analysis_method = method;
    assert.throws(
      () => QuestionSetRunCsvService.parseCsv(
        QuestionSetRunCsvService.buildCsv(normalizedFailure)
      ),
      (error) => ['UNSUPPORTED_ANALYSIS_METHOD', 'INVALID_FIELD'].includes(error.code)
    );
  }

  for (const overrides of [
    { brand_mentioned: true },
    { brand_mentions: 1 },
    { brand_rank: 1 },
    { brand_recommended: true },
    { sentiment: 'neutral' },
    { share_of_voice: 50 },
    { competitor_mentions: [{ name: '海康', mentions: 1 }] },
    { analysis_structure: { target_fact: {} } },
    { analysis_structure: { competition_analysis: { status: 'complete' } } },
    { analysis_structure: { citations: { semantics_version: 'explicit-citation-v2', raw: true } } },
    { analysis_evidence: { brand: { mention: { evidence: ['伪造的品牌证据'] } } } }
  ]) {
    const tampered = currentReport({
      status: 'failed',
      has_metrics: false,
      brand_mentioned: false,
      brand_mentions: 0,
      brand_rank: null,
      brand_recommended: false,
      sentiment: '',
      analysis_method: 'legacy_rules_v1',
      analysis_structure: {},
      share_of_voice: null,
      answer_competitor_share: null,
      sov_numerator: null,
      sov_denominator: null,
      competition_entities: [],
      ...overrides
    });
    assert.throws(
      () => QuestionSetRunCsvService.parseCsv(
        QuestionSetRunCsvService.buildCsv(tampered)
      ),
      (error) => error.code === 'FAILED_ROW_METRICS_NOT_EMPTY'
    );
  }
});

test('失败行的显式引用状态、计数和来源必须相互一致', () => {
  const failedCitationReport = (overrides = {}) => currentReport({
    status: 'failed',
    has_metrics: false,
    brand_mentioned: false,
    brand_mentions: 0,
    brand_rank: null,
    brand_recommended: false,
    sentiment: '',
    analysis_method: 'legacy_rules_v1',
    analysis_structure: {
      citations: {
        semantics_version: 'explicit-citation-v2',
        evidence_status: 'explicit'
      }
    },
    analysis_evidence: {},
    share_of_voice: null,
    answer_competitor_share: null,
    sov_numerator: null,
    sov_denominator: null,
    competitor_mentions: [],
    competition_entities: [],
    citation_count: 1,
    owned_citation_count: 1,
    competitor_citation_count: 0,
    citation_sources: [{
      url: 'https://gato.example/report',
      domain: 'gato.example',
      owned: true,
      competitor_owned: false
    }],
    ...overrides
  });

  assert.equal(
    QuestionSetRunCsvService.parseCsv(
      QuestionSetRunCsvService.buildCsv(failedCitationReport())
    ).rows[0].citation_count,
    1
  );

  for (const overrides of [
    { analysis_structure: { citations: { semantics_version: 'explicit-citation-v2', evidence_status: 'forged' } } },
    { citation_count: 99, citation_sources: [] },
    { owned_citation_count: 0 },
    { competitor_citation_count: 1 },
    { citation_sources: [{ owned: true, competitor_owned: false }] },
    {
      citation_count: 2,
      owned_citation_count: 2,
      citation_sources: [
        { url: 'https://gato.example/report', owned: true, competitor_owned: false },
        { url: 'https://gato.example/report', owned: true, competitor_owned: false }
      ]
    },
    {
      analysis_structure: { citations: { semantics_version: 'explicit-citation-v2', evidence_status: 'unavailable' } },
      citation_count: 1
    }
  ]) {
    assert.throws(
      () => QuestionSetRunCsvService.parseCsv(
        QuestionSetRunCsvService.buildCsv(failedCitationReport(overrides))
      ),
      (error) => error.code === 'INVALID_CITATION_EVIDENCE'
    );
  }

  for (const evidenceStatus of [0, false, null, '']) {
    const falsyStatus = currentReport();
    falsyStatus.rows[0].analysis_structure.citations = {
      semantics_version: 'explicit-citation-v2',
      evidence_status: evidenceStatus
    };
    assert.throws(
      () => QuestionSetRunCsvService.parseCsv(
        QuestionSetRunCsvService.buildCsv(falsyStatus)
      ),
      (error) => error.code === 'INVALID_CITATION_EVIDENCE'
    );
  }
});

test('拒绝 pending 行并返回稳定行列错误', () => {
  assert.throws(
    () => parseReport({}, { status: 'pending' }),
    (error) => {
      assert.equal(error.code, 'NON_TERMINAL_STATUS');
      assert.equal(error.row, 2);
      assert.equal(error.column, 'status');
      assert.match(error.message, /只允许 completed 或 failed/);
      return true;
    }
  );
});

test('ID 只接受正整数', () => {
  [
    [{ id: -1 }, {}, 'source_run_id'],
    [{ id: 1.5 }, {}, 'source_run_id'],
    [{}, { record_id: -1 }, 'record_id'],
    [{}, { record_id: 1.5 }, 'record_id'],
    [{}, { question_id: 0 }, 'question_id'],
    [{}, { question_id: 2.5 }, 'question_id']
  ].forEach(([reportOverrides, rowOverrides, column]) => {
    assert.throws(
      () => parseReport(reportOverrides, rowOverrides),
      (error) => (
        error.code === 'INVALID_POSITIVE_INTEGER'
        && error.row === 2
        && error.column === column
      )
    );
  });
});

test('计数字段只接受非负整数', () => {
  [
    ['brand_mentions', -1],
    ['brand_mentions', 1.5],
    ['citation_count', -1],
    ['citation_count', 1.5],
    ['owned_citation_count', -1],
    ['competitor_citation_count', 1.5],
    ['legacy_citation_count', -2]
  ].forEach(([column, value]) => {
    assert.throws(
      () => parseReport({}, { [column]: value }),
      (error) => (
        error.code === 'INVALID_NON_NEGATIVE_INTEGER'
        && error.row === 2
        && error.column === column
      )
    );
  });
});

test('百分比、排名和时间满足业务范围', () => {
  [
    [{}, { share_of_voice: -0.1 }, 'share_of_voice'],
    [{}, { share_of_voice: 100.1 }, 'share_of_voice'],
    [{}, { brand_rank: 0 }, 'brand_rank'],
    [{}, { brand_rank: -1 }, 'brand_rank']
  ].forEach(([reportOverrides, rowOverrides, column]) => {
    assert.throws(
      () => parseReport(reportOverrides, rowOverrides),
      (error) => error.code === 'OUT_OF_RANGE' && error.column === column
    );
  });

  assert.throws(
    () => parseReport({
      started_at: new Date('2026-07-26T02:00:00.000Z'),
      completed_at: new Date('2026-07-26T01:00:00.000Z')
    }),
    (error) => (
      error.code === 'INVALID_DATE_ORDER'
      && error.row === 2
      && error.column === 'run_completed_at'
    )
  );
});

test('JSON 单元格继续限制结构和长度', () => {
  assert.throws(
    () => parseReport({}, {
      competitor_mentions: [{ name: 'x'.repeat(QuestionSetRunCsvService.MAX_JSON_CELL_CHARS + 1) }]
    }),
    (error) => (
      error.code === 'JSON_FIELD_TOO_LARGE'
      && error.row === 2
      && error.column === 'competitor_mentions_json'
    )
  );
});

test('合法旧版 v1 必需列文件仍可导入', () => {
  const row = [
    'question_set_run_v1',
    '123',
    '旧版合法报告',
    '2026-07-26T01:00:00.000Z',
    '2026-07-26T01:05:00.000Z',
    '11',
    '22',
    '周界报警厂商怎么选？',
    '',
    'deepseek',
    'DeepSeek',
    'deepseek-chat',
    'completed',
    '',
    '上海广拓可作为候选。',
    'true',
    'true',
    '1',
    '1',
    'false',
    '50',
    '0',
    'neutral',
    '',
    '[]',
    '[]',
    '2026-07-26T01:00:10.000Z',
    '2026-07-26T01:04:00.000Z'
  ];
  const csv = `${QuestionSetRunCsvService.REQUIRED_HEADERS.join(',')}\n${row.join(',')}`;

  const parsed = QuestionSetRunCsvService.parseCsv(csv);

  assert.equal(parsed.questionSetName, '旧版合法报告');
  assert.equal(parsed.rows[0].status, 'completed');
  assert.equal(parsed.rows[0].answer_format, 'plain_text');
  assert.equal(parsed.rows[0].analysis_method, 'legacy_rules_v1');
  assert.equal(parsed.analysisContractVersion, null);
  assert.equal(parsed.metricSemanticsVersion, 'configured_competitor_sov_v1');
  assert.equal(
    parsed.rows[0].metric_semantics_version,
    'configured_competitor_sov_v1'
  );
});

test('兼容追加列保留分析版本和引用解释字段', () => {
  const parsed = parseReport({}, {
    legacy_citation_count: 2,
    legacy_citation_sources: [{ url: 'https://legacy.example.com/source' }],
    owned_citation_count: 1,
    competitor_citation_count: 0,
    competitor_mentions: [{ id: 9, name: '竞品甲', mentioned: true }]
  });

  assert.equal(parsed.analysisContractVersion, 'geo_metric_input_v2');
  assert.equal(parsed.rows[0].legacy_citation_count, 2);
  assert.deepEqual(parsed.rows[0].legacy_citation_sources, [{
    url: 'https://legacy.example.com/source'
  }]);
  assert.equal(parsed.rows[0].owned_citation_count, 1);
  assert.equal(parsed.rows[0].competitor_citation_count, 0);
  assert.deepEqual(parsed.rows[0].competitor_mentions, [{
    id: 9,
    name: '竞品甲',
    mentioned: true
  }]);
});

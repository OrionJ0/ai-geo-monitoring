const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AIResponseAnalysisService
} = require('../services/AIResponseAnalysisService');
const {
  CURRENT_ANALYSIS_CONTRACT,
  CURRENT_STRUCTURE_VERSION,
  CURRENT_METRIC_SEMANTICS
} = require('../services/GeoMetricSemanticsService');

function completeOutput(overrides = {}) {
  return {
    entities: [],
    mentions: [],
    target_entity_name: null,
    competitor_relations: [],
    candidate_lists: [],
    recommendations: [],
    claims: [],
    sentiment: {
      label: 'neutral',
      reason: '回答未提及目标品牌',
      evidence: [],
      risk_terms: []
    },
    ...overrides
  };
}

test('v4 prompt stages semantic analysis without competitor hints or rule dictionaries', () => {
  const service = new AIResponseAnalysisService();
  const definition = service.getPromptDefinition();

  assert.equal(CURRENT_ANALYSIS_CONTRACT, 'ai_structured_v4');
  assert.equal(CURRENT_STRUCTURE_VERSION, 'geo_metric_input_v4');
  assert.equal(CURRENT_METRIC_SEMANTICS, 'contextual_competitor_mentions_sov_v1');
  assert.equal(definition.version, 'ai_structured_v4');
  assert.equal(definition.prompt_revision, 'semantic_evidence_few_shot_v7');
  assert.match(definition.template, /完整抽取/);
  assert.match(definition.template, /逐一判断竞争关系/);
  assert.match(definition.template, /独立判断候选顺序/);
  assert.match(definition.template, /编号候选清单/);
  assert.match(definition.template, /numbered_ordered/);
  assert.match(definition.template, /preference_set_not_full_rank/);
  assert.match(definition.template, /不能合并成一个全局候选次序/);
  assert.match(definition.template, /multi_group_local_order/);
  assert.match(definition.template, /broad_question_multiple_interpretations/);
  assert.match(definition.template, /delivery_role_competition/);
  assert.match(definition.template, /各分组分别记录候选次序/);
  assert.match(definition.template, /不要替买家擅自缩窄需求/);
  assert.match(definition.template, /表格行序.*不代表排名/);
  assert.match(definition.template, /整体选择倾向/);
  assert.match(definition.template, /输出前静默复核/);
  assert.match(definition.template, /other_organization/);
  assert.match(definition.template, /"evidence"/);
  assert.match(definition.template, /positive/);
  assert.match(definition.template, /negative/);
  assert.doesNotMatch(definition.template, /competitor_hints|竞品提示/);
  assert.equal(definition.runtime_fields.includes('竞品提示'), false);
});

test('accepts other organizations and preserves grounded evidence without using type as a SOV gate', () => {
  const service = new AIResponseAnalysisService();
  const responseText = '广拓为某研究院部署方案，海康也提供同类方案。';
  const structured = service.parseOutput(JSON.stringify(completeOutput({
    entities: [
      { name: '广拓', type: 'brand' },
      { name: '某研究院', type: 'other_organization' },
      { name: '海康', type: 'brand' }
    ],
    mentions: [
      { entity_name: '广拓', surface_forms: ['广拓'] },
      { entity_name: '某研究院', surface_forms: ['某研究院'] },
      { entity_name: '海康', surface_forms: ['海康'] }
    ],
    target_entity_name: '广拓',
    competitor_relations: [
      {
        entity_name: '某研究院',
        relation: 'non_competitor',
        reason: '回答中是方案使用方，不是替代供应商',
        evidence: ['广拓为某研究院部署方案']
      },
      {
        entity_name: '海康',
        relation: 'competitor',
        reason: '在当前问题中提供同类替代方案',
        evidence: ['海康也提供同类方案']
      }
    ],
    sentiment: {
      label: 'neutral',
      reason: '回答只陈述目标品牌的部署事实',
      evidence: ['广拓为某研究院部署方案'],
      risk_terms: []
    }
  })), {
    responseText,
    brand: { name: '广拓' }
  });

  const calculated = service.calculate(structured);
  assert.equal(structured.schema_version, 'geo_metric_input_v4');
  assert.equal(structured.entities[1].type, 'other_organization');
  assert.deepEqual(
    structured.competitor_relations[1].evidence,
    ['海康也提供同类方案']
  );
  assert.equal(calculated.sov_numerator, 1);
  assert.equal(calculated.sov_denominator, 2);
  assert.equal(calculated.answer_competitor_share, 50);
  assert.deepEqual(
    calculated.competition_entities[1].evidence,
    ['海康也提供同类方案']
  );
});

test('accepts Markdown-equivalent evidence and stores the located original span', () => {
  const service = new AIResponseAnalysisService();
  const responseText = '-   **看重系统集成**：首选 **广拓** 或 **海康**。';
  const formattedEvidence = '看重系统集成：首选 广拓 或 海康';
  const structured = service.parseOutput(JSON.stringify(completeOutput({
    entities: [
      { name: '广拓', type: 'brand' },
      { name: '海康', type: 'brand' }
    ],
    mentions: [
      { entity_name: '广拓', surface_forms: ['广拓'] },
      { entity_name: '海康', surface_forms: ['海康'] }
    ],
    target_entity_name: '广拓',
    competitor_relations: [{
      entity_name: '海康',
      relation: 'competitor',
      reason: '回答把两者放入同一选择集合',
      evidence: [formattedEvidence, '模型补充的不实片段']
    }],
    candidate_lists: [{
      ordered: false,
      entries: ['广拓', '海康'],
      reason: '回答表达二选一但没有两者先后',
      evidence: [formattedEvidence]
    }],
    recommendations: [{ entity_name: '广拓', kind: 'explicit' }],
    sentiment: {
      label: 'positive',
      reason: '回答明确把目标品牌列为首选之一',
      evidence: [formattedEvidence],
      risk_terms: []
    }
  })), {
    responseText,
    brand: { name: '广拓' }
  });

  const located = structured.competitor_relations[0].evidence[0];
  assert.notEqual(located, formattedEvidence);
  assert.ok(responseText.includes(located));
  assert.match(located, /看重系统集成/);
  assert.deepEqual(structured.candidate_lists[0].evidence, [located]);
  assert.deepEqual(structured.sentiment.evidence, [located]);
});

test('accepts evidence copied from a Markdown table without pipe separators', () => {
  const service = new AIResponseAnalysisService();
  const responseText = [
    '| 厂商 | 产品 |',
    '| --- | --- |',
    '| 成都鑫为科技 | 振动电缆系统、电子围栏 |'
  ].join('\n');
  const submittedEvidence = '成都鑫为科技\t振动电缆系统、电子围栏';
  const structured = service.parseOutput(JSON.stringify(completeOutput({
    entities: [
      { name: '成都鑫为科技', type: 'company' }
    ],
    mentions: [
      { entity_name: '成都鑫为科技', surface_forms: ['成都鑫为科技'] }
    ],
    target_entity_name: null,
    competitor_relations: [{
      entity_name: '成都鑫为科技',
      relation: 'competitor',
      reason: '回答将其列为当前采购问题的候选厂商',
      evidence: [submittedEvidence]
    }]
  })), {
    responseText,
    brand: { name: '广拓' }
  });

  const located = structured.competitor_relations[0].evidence[0];
  assert.ok(responseText.includes(located));
  assert.match(located, /成都鑫为科技/);
  assert.match(located, /振动电缆系统、电子围栏/);
});

test('rejects semantic conclusions whose evidence cannot be located in the original answer', () => {
  const service = new AIResponseAnalysisService();
  const output = completeOutput({
    entities: [
      { name: '广拓', type: 'brand' },
      { name: '海康', type: 'brand' }
    ],
    mentions: [
      { entity_name: '广拓', surface_forms: ['广拓'] },
      { entity_name: '海康', surface_forms: ['海康'] }
    ],
    target_entity_name: '广拓',
    competitor_relations: [{
      entity_name: '海康',
      relation: 'competitor',
      reason: '提供同类方案',
      evidence: ['原回答中不存在的证据']
    }],
    sentiment: {
      label: 'neutral',
      reason: '客观并列',
      evidence: ['广拓和海康'],
      risk_terms: []
    }
  });

  assert.throws(
    () => service.parseOutput(JSON.stringify(output), {
      responseText: '广拓和海康都提供相关方案。',
      brand: { name: '广拓' }
    }),
    /evidence.*无法在原回答中定位/
  );
});

test('derives rank only from an AI-declared ordered list with grounded reason and evidence', () => {
  const service = new AIResponseAnalysisService();
  const responseText = '推荐顺序：先选广拓，其次海康。';
  const structured = service.parseOutput(JSON.stringify(completeOutput({
    entities: [
      { name: '海康', type: 'brand' },
      { name: '广拓', type: 'brand' }
    ],
    mentions: [
      { entity_name: '海康', surface_forms: ['海康'] },
      { entity_name: '广拓', surface_forms: ['广拓'] }
    ],
    target_entity_name: '广拓',
    competitor_relations: [{
      entity_name: '海康',
      relation: 'competitor',
      reason: '回答将其放在同一推荐集合中',
      evidence: ['推荐顺序：先选广拓，其次海康']
    }],
    candidate_lists: [{
      ordered: true,
      entries: ['广拓', '海康'],
      reason: '回答表达了明确推荐先后',
      evidence: ['推荐顺序：先选广拓，其次海康']
    }],
    recommendations: [{ entity_name: '广拓', kind: 'explicit' }],
    sentiment: {
      label: 'positive',
      reason: '回答把目标品牌作为首选',
      evidence: ['先选广拓'],
      risk_terms: []
    }
  })), {
    responseText,
    brand: { name: '广拓' }
  });

  const calculated = service.calculate(structured);
  assert.equal(calculated.brand_rank, 1);
  assert.deepEqual(
    structured.candidate_lists[0].evidence,
    ['推荐顺序：先选广拓，其次海康']
  );
});

test('a retry re-reads the complete answer instead of freezing the first invalid semantics', async () => {
  const prompts = [];
  const responseText = '广拓和海康都提供方案。';
  const valid = completeOutput({
    entities: [
      { name: '广拓', type: 'brand' },
      { name: '海康', type: 'brand' }
    ],
    mentions: [
      { entity_name: '广拓', surface_forms: ['广拓'] },
      { entity_name: '海康', surface_forms: ['海康'] }
    ],
    target_entity_name: '广拓',
    competitor_relations: [{
      entity_name: '海康',
      relation: 'competitor',
      reason: '提供同类方案',
      evidence: ['海康都提供方案']
    }],
    sentiment: {
      label: 'neutral',
      reason: '回答只是客观并列',
      evidence: ['广拓和海康都提供方案'],
      risk_terms: []
    }
  });
  const service = new AIResponseAnalysisService({
    configService: {
      getAnalysisPlatform: async () => ({
        code: 'deepseek',
        adapter_type: 'openai_chat_completions',
        default_model: 'deepseek-v4-pro'
      })
    },
    requestService: {
      queryConfig: async (_platform, prompt) => {
        prompts.push(prompt);
        return {
          success: true,
          data: { choices: [{ finish_reason: 'stop' }] },
          text: prompts.length === 1
            ? JSON.stringify({ ...valid, competitor_relations: [] })
            : JSON.stringify(valid)
        };
      }
    }
  });

  const result = await service.analyze({
    question: '有哪些可选厂商？',
    responseText,
    brand: { name: '广拓' },
    competitorHints: [{ name: '不应进入提示词的企业' }]
  });

  assert.equal(result.analysis_method, 'ai_structured_v4');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /重新通读|重新审阅/);
  assert.match(prompts[1], /字段路径：competitor_relations/);
  assert.match(prompts[1], /错误类型：analysis_relation_incomplete/);
  assert.match(prompts[1], /纠正要求：/);
  assert.doesNotMatch(prompts[0], /不应进入提示词的企业/);
  assert.doesNotMatch(prompts[1], /不改变对原回答的语义判断/);
});

test('同一实体保留精确表面词并丢弃无依据附加名称', () => {
  const service = new AIResponseAnalysisService();
  const responseText = '上海广拓提供周界报警方案。';
  const structured = service.parseOutput(JSON.stringify(completeOutput({
    entities: [{ name: '上海广拓', type: 'company' }],
    mentions: [{
      entity_name: '上海广拓',
      surface_forms: ['上海广拓', '不存在的广拓别名', '上海广拓提供周界报警方案。']
    }],
    target_entity_name: '上海广拓',
    sentiment: {
      label: 'neutral',
      reason: '回答只陈述能力',
      evidence: ['上海广拓提供周界报警方案'],
      risk_terms: []
    }
  })), { responseText, brand: { name: '上海广拓' } });

  assert.deepEqual(structured.mentions, [{
    entity_name: '上海广拓',
    surface_forms: ['上海广拓']
  }]);
  assert.deepEqual(structured.normalization_warnings, [{
    code: 'unsupported_surface_form_dropped',
    entity_name: '上海广拓',
    dropped_count: 2
  }]);
  assert.equal(JSON.stringify(structured.normalization_warnings).includes('不存在的广拓别名'), false);
});

test('实体没有任何精确表面词时仍拒绝整份分析', () => {
  const service = new AIResponseAnalysisService();
  assert.throws(
    () => service.parseOutput(JSON.stringify(completeOutput({
      entities: [{ name: '上海广拓', type: 'company' }],
      mentions: [{
        entity_name: '上海广拓',
        surface_forms: ['不存在的广拓别名', '整句也不在原回答。']
      }],
      target_entity_name: '上海广拓',
      sentiment: {
        label: 'neutral',
        reason: '无证据',
        evidence: [],
        risk_terms: []
      }
    })), {
      responseText: '原回答没有出现任何品牌。',
      brand: { name: '上海广拓' }
    }),
    /无法在原回答中定位任何短实体词/
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSourceMap } = require('../services/AIAnalysisSourceMapService');
const { buildEntityCatalog } = require('../services/AIEntityCatalogService');

test('builds stable entity IDs from exact grounded surface forms', () => {
  const answer = 'Hikvision 与海康威视并列。\n大华股份提供 DSS。';
  const sourceMap = createSourceMap(answer);

  const catalog = buildEntityCatalog({
    answer,
    sourceMap,
    extractedMentions: [
      {
        source_id: 'L001',
        surface_form: 'Hikvision',
        canonical_name: '海康威视',
        entity_type: 'brand'
      },
      {
        source_id: 'L001',
        surface_form: '海康威视',
        canonical_name: '海康威视',
        entity_type: 'brand'
      },
      {
        source_id: 'L002',
        surface_form: '大华股份',
        canonical_name: '大华股份',
        entity_type: 'company'
      }
    ],
    targetBrand: { name: '广拓', aliases: ['GATO'] }
  });

  assert.equal(catalog.target_entity_id, null);
  assert.deepEqual(catalog.entities.map((entity) => ({
    entity_id: entity.entity_id,
    name: entity.name,
    type: entity.type,
    surface_forms: entity.surface_forms
  })), [
    {
      entity_id: 'E001',
      name: '海康威视',
      type: 'brand',
      surface_forms: ['Hikvision', '海康威视']
    },
    {
      entity_id: 'E002',
      name: '大华股份',
      type: 'company',
      surface_forms: ['大华股份']
    }
  ]);
  assert.deepEqual(catalog.entities[0].mentions, [
    {
      source_id: 'L001',
      start: 0,
      end: 9,
      surface_form: 'Hikvision'
    },
    {
      source_id: 'L001',
      start: 11,
      end: 15,
      surface_form: '海康威视'
    }
  ]);
});

test('maps the target only from grounded registered surface forms', () => {
  const unrelatedAnswer = '海康威视提供园区安防方案。';
  const poisonedCatalog = buildEntityCatalog({
    answer: unrelatedAnswer,
    sourceMap: createSourceMap(unrelatedAnswer),
    extractedMentions: [{
      source_id: 'L001',
      surface_form: '海康威视',
      canonical_name: '广拓',
      entity_type: 'brand'
    }],
    targetBrand: { name: '广拓', aliases: ['上海广拓'] }
  });
  assert.equal(poisonedCatalog.target_entity_id, null);

  const targetAnswer = '上海广拓提供周界报警方案。';
  const targetCatalog = buildEntityCatalog({
    answer: targetAnswer,
    sourceMap: createSourceMap(targetAnswer),
    extractedMentions: [{
      source_id: 'L001',
      surface_form: '上海广拓',
      canonical_name: '上海广拓信息技术有限公司',
      entity_type: 'company'
    }],
    targetBrand: { name: '广拓', aliases: ['上海广拓'] }
  });
  assert.equal(targetCatalog.target_entity_id, 'E001');
});

test('matches a registered target alias inside a grounded full company name', () => {
  const answer = '上海广拓信息技术有限公司提供电磁感知电缆。';
  const catalog = buildEntityCatalog({
    answer,
    sourceMap: createSourceMap(answer),
    extractedMentions: [{
      source_id: 'L001',
      surface_form: '上海广拓信息技术有限公司',
      canonical_name: '上海广拓信息技术有限公司',
      entity_type: 'company'
    }],
    targetBrand: { name: '广拓', aliases: ['上海广拓', 'GATO'] }
  });

  assert.equal(catalog.target_entity_id, 'E001');
});

test('merges a parenthesized brand alias with its company and expands grounded target aliases', () => {
  const answer = [
    '**上海广拓（TOTOLINK）**',
    '专业项目首选广拓。'
  ].join('\n');
  const catalog = buildEntityCatalog({
    answer,
    sourceMap: createSourceMap(answer),
    extractedMentions: [
      {
        source_id: 'L001',
        surface_form: '上海广拓',
        canonical_name: '上海广拓',
        entity_type: 'company'
      },
      {
        source_id: 'L001',
        surface_form: 'TOTOLINK',
        canonical_name: 'TOTOLINK',
        entity_type: 'brand'
      }
    ],
    targetBrand: { name: '广拓', aliases: ['上海广拓', 'GATO'] }
  });

  assert.equal(catalog.entities.length, 1);
  assert.equal(catalog.entities[0].name, '上海广拓');
  assert.equal(catalog.entities[0].type, 'company');
  assert.deepEqual(catalog.entities[0].surface_forms, ['上海广拓', 'TOTOLINK', '广拓']);
  assert.deepEqual(
    catalog.entities[0].mentions.map(({ source_id, surface_form }) => ({ source_id, surface_form })),
    [
      { source_id: 'L001', surface_form: '上海广拓' },
      { source_id: 'L001', surface_form: 'TOTOLINK' },
      { source_id: 'L002', surface_form: '广拓' }
    ]
  );
  assert.equal(catalog.target_entity_id, 'E001');
  assert.deepEqual(
    catalog.target_mentions.map(({ source_id, surface_form }) => ({ source_id, surface_form })),
    [
      { source_id: 'L001', surface_form: '上海广拓' },
      { source_id: 'L002', surface_form: '广拓' }
    ]
  );
});

test('resolves company and brand type variants for one canonical entity without a retry', () => {
  const answer = '上海广拓（TANTECH）';
  const catalog = buildEntityCatalog({
    answer,
    sourceMap: createSourceMap(answer),
    extractedMentions: [
      {
        source_id: 'L001',
        surface_form: '上海广拓',
        canonical_name: '上海广拓',
        entity_type: 'company'
      },
      {
        source_id: 'L001',
        surface_form: 'TANTECH',
        canonical_name: '上海广拓',
        entity_type: 'brand'
      }
    ],
    targetBrand: { name: '广拓', aliases: ['上海广拓'] }
  });

  assert.equal(catalog.entities.length, 1);
  assert.equal(catalog.entities[0].type, 'company');
  assert.deepEqual(catalog.entities[0].surface_forms, ['上海广拓', 'TANTECH']);
});

test('expands exact repeated company names and a grounded city-marker omission', () => {
  const answer = [
    '厂家：深圳市中安谐。',
    '备选仍可考虑深圳市中安谐。',
    '总结推荐深圳中安谐。'
  ].join('\n');
  const catalog = buildEntityCatalog({
    answer,
    sourceMap: createSourceMap(answer),
    extractedMentions: [{
      source_id: 'L001',
      surface_form: '深圳市中安谐',
      canonical_name: '深圳市中安谐',
      entity_type: 'company'
    }],
    targetBrand: { name: '广拓', aliases: [] }
  });

  assert.deepEqual(
    catalog.entities[0].mentions.map(({ source_id, surface_form }) => ({ source_id, surface_form })),
    [
      { source_id: 'L001', surface_form: '深圳市中安谐' },
      { source_id: 'L002', surface_form: '深圳市中安谐' },
      { source_id: 'L003', surface_form: '深圳中安谐' }
    ]
  );
  assert.deepEqual(catalog.entities[0].surface_forms, ['深圳市中安谐', '深圳中安谐']);
});

test('maps a grounded shorthand only when it uniquely belongs to one catalog entity', () => {
  const answer = [
    '候选厂家：杭州海康威视、上海亚安科技。',
    '系统集成首选海康，高端防护考虑亚安。'
  ].join('\n');
  const catalog = buildEntityCatalog({
    answer,
    sourceMap: createSourceMap(answer),
    extractedMentions: [
      {
        source_id: 'L001',
        surface_form: '杭州海康威视',
        canonical_name: '杭州海康威视',
        entity_type: 'company'
      },
      {
        source_id: 'L001',
        surface_form: '上海亚安科技',
        canonical_name: '上海亚安科技',
        entity_type: 'company'
      }
    ],
    targetBrand: { name: '广拓', aliases: [] }
  });

  assert.ok(catalog.entities[0].surface_forms.includes('海康'));
  assert.ok(catalog.entities[1].surface_forms.includes('亚安'));
  assert.equal(catalog.entities[0].mentions.some((mention) => mention.source_id === 'L002'), true);
  assert.equal(catalog.entities[1].mentions.some((mention) => mention.source_id === 'L002'), true);
  assert.equal(catalog.entities.some((entity) => entity.surface_forms.includes('科技')), false);
  assert.equal(catalog.entities.some((entity) => entity.surface_forms.includes('智能')), false);
  assert.equal(catalog.entities.some((entity) => entity.surface_forms.includes('发展')), false);
});

test('counts repeated registered target aliases in one long source line separately', () => {
  const answer = 'Goodie AI 提供监测，而 Goodie AI 也提供优化建议。';
  const catalog = buildEntityCatalog({
    answer,
    sourceMap: createSourceMap(answer),
    extractedMentions: [{
      source_id: 'L001',
      surface_form: 'Goodie AI',
      canonical_name: 'Goodie AI',
      entity_type: 'brand'
    }],
    targetBrand: { name: 'Goodie AI（验收）', aliases: ['Goodie AI'] }
  });

  assert.equal(catalog.target_entity_id, 'E001');
  assert.equal(catalog.target_mentions.length, 2);
});

test('counts a bilingual parenthesized target display name as one mention', () => {
  const answer = '广拓Gato（上海广拓）是周界安防品牌。';
  const catalog = buildEntityCatalog({
    answer,
    sourceMap: createSourceMap(answer),
    extractedMentions: [{
      source_id: 'L001',
      surface_form: '广拓Gato（上海广拓）',
      canonical_name: '上海广拓',
      entity_type: 'brand'
    }],
    targetBrand: { name: '广拓', aliases: [] }
  });

  assert.equal(catalog.target_entity_id, 'E001');
  assert.equal(catalog.target_mentions.length, 1);
});

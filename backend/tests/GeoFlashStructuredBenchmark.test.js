const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildReport,
  parseArgs,
  recalculateCachedV5Entry,
  runWithConcurrency
} = require('../scripts/geoFlashStructuredBenchmark');

test('parses explicit benchmark arms and rejects unsafe concurrency', () => {
  const options = parseArgs([
    '--arms', 'v5-json,v4-current,v5-json',
    '--repeats', '2',
    '--concurrency', '5',
    '--limit', '4',
    '--sample-ids', 'S06,S07,S06',
    '--refresh'
  ]);

  assert.deepEqual(options.arms, ['v5-json', 'v4-current']);
  assert.equal(options.repeats, 2);
  assert.equal(options.concurrency, 5);
  assert.equal(options.limit, 4);
  assert.deepEqual(options.sampleIds, ['S06', 'S07']);
  assert.equal(options.refresh, true);
  assert.throws(
    () => parseArgs(['--concurrency', '6']),
    /1 至 5/
  );
});

test('recalculates cached v5 target metrics without another model call', () => {
  const sample = {
    response_text: '广拓Gato（上海广拓）为行业品牌。',
    brand: { name: '广拓', aliases: [] }
  };
  const entry = {
    ok: true,
    arm: 'v5-json',
    result: {
      analysis_method: 'ai_structured_v5',
      brand_mentions: 2,
      analysis_structure: {
        target_entity_id: 'E001',
        entities: [{ entity_id: 'E001', name: '上海广拓', type: 'company', surface_forms: ['广拓Gato（上海广拓）'] }],
        mentions: [{ entity_id: 'E001', source_id: 'L001', start: 0, end: 12, surface_form: '广拓Gato（上海广拓）' }],
        competitor_relations: [],
        candidate_groups: [],
        recommendations: [],
        sentiment: { status: 'assessed', label: 'positive', reason: '正面', evidence_source_ids: ['L001'], evidence: [sample.response_text], risk_terms: [] },
        diagnostics: { stages: [] }
      }
    }
  };

  const recalculated = recalculateCachedV5Entry(entry, sample);

  assert.equal(recalculated.result.brand_mentions, 1);
  assert.equal(recalculated.result.analysis_method, 'ai_structured_v5');
  assert.ok(recalculated.recalculated_at);
});

test('runs every task once and preserves task order under concurrency', async () => {
  const tasks = [3, 1, 2, 4];
  const progress = [];
  const results = await runWithConcurrency(
    tasks,
    async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value));
      return value * 10;
    },
    3,
    (completed, total) => progress.push([completed, total])
  );

  assert.deepEqual(results, [30, 10, 20, 40]);
  assert.equal(progress.length, tasks.length);
  assert.deepEqual(progress.at(-1), [4, 4]);
});

test('does not pass the formal completion gate with a smoke-sized sample', () => {
  const report = buildReport({
    options: { repeats: 1, arms: ['v5-json'] },
    samples: [{ sample_id: 'S01' }],
    labels: new Map([['S01', {
      mentioned: false,
      mentions: 0,
      recommended: false,
      rank: null,
      sentiment: null
    }]]),
    entries: [{
      sample_id: 'S01',
      arm: 'v5-json',
      repeat: 1,
      ok: true,
      result: {
        brand_mentioned: false,
        brand_mentions: 0,
        brand_recommended: false,
        brand_rank: null,
        sentiment: 'neutral'
      }
    }],
    summaries: {
      'v5-json': {
        total: 1,
        completed: 1,
        completion_rate: 1,
        target_presence_correct: 1,
        target_presence_evaluated: 1,
        target_presence_accuracy: 1,
        target_false_positives: 0,
        stability_agreements: 0,
        stability_pairs: 0,
        stability_rate: null,
        tokens: { median: 100 },
        latency_ms: { p95: 200 }
      }
    }
  });

  assert.match(report, /完成率门槛：FAIL/);
  // issue 013：真值覆盖与实体质量在真值不足时 NOT EVALUABLE
  assert.match(report, /语义真值覆盖.*NOT EVALUABLE/);
  assert.match(report, /实体与语义真值/);
  assert.match(report, /NOT_EVALUABLE/);
});

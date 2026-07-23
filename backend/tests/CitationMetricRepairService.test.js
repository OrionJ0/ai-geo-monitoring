const test = require('node:test');
const assert = require('node:assert/strict');

const { createCitationMetricRepairService } = require('../services/CitationMetricRepairService');

test('repairs legacy metrics by keeping only explicit provider citations in core KPI fields', async () => {
  const updates = [];
  const metric = {
    id: 7,
    question_record_id: 9,
    citation_sources: [
      { url: 'https://cited.example.com/report', domain: 'cited.example.com', owned: true },
      { url: 'https://retrieved.example.com/result', domain: 'retrieved.example.com', owned: false },
      { url: 'https://response.example.com/link', domain: 'response.example.com', owned: false }
    ],
    analysis_structure: { schema_version: 'geo_metric_input_v2', citations: { count: 3 } },
    async update(payload) {
      updates.push(payload);
    }
  };
  const metricModel = {
    async findAll() {
      return [metric];
    }
  };
  const detailModel = {
    async findAll() {
      return [{
        question_record_id: 9,
        ai_response_original: '正文链接 https://response.example.com/link',
        provider_citations: [
          { url: 'https://cited.example.com/report' },
          { url: 'https://retrieved.example.com/result', source_origin: 'web_search' }
        ]
      }];
    }
  };

  const repaired = await createCitationMetricRepairService({ metricModel, detailModel }).repairLegacyMetrics();

  assert.equal(repaired, 1);
  assert.equal(updates[0].citation_count, 1);
  assert.equal(updates[0].owned_citation_count, 1);
  assert.deepEqual(updates[0].citation_sources.map((source) => source.url), [
    'https://cited.example.com/report'
  ]);
  assert.deepEqual(
    updates[0].analysis_structure.citations.source_groups.retrieval_sources.map((source) => source.url),
    ['https://retrieved.example.com/result']
  );
  assert.deepEqual(
    updates[0].analysis_structure.citations.source_groups.response_links.map((source) => source.url),
    ['https://response.example.com/link']
  );
  assert.equal(updates[0].analysis_structure.citations.semantics_version, 'explicit-citation-v1');
});

test('does not rewrite metrics that already use explicit citation semantics', async () => {
  const metricModel = {
    async findAll() {
      return [{
        analysis_structure: {
          citations: { semantics_version: 'explicit-citation-v1' }
        },
        update() {
          throw new Error('不应更新');
        }
      }];
    }
  };
  const detailModel = {
    async findAll() {
      return [];
    }
  };

  const repaired = await createCitationMetricRepairService({ metricModel, detailModel }).repairLegacyMetrics();

  assert.equal(repaired, 0);
});

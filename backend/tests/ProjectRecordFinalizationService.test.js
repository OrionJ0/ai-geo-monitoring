const test = require('node:test');
const assert = require('node:assert/strict');

const ProjectRecordFinalizationService = require('../services/ProjectRecordFinalizationService');

test('finalizes non-project detection records without requiring visibility metrics', async () => {
  const updates = [];

  const result = await ProjectRecordFinalizationService.finalize({
    record: {
      id: 1,
      project_id: null,
      update: async (payload) => updates.push(payload)
    },
    responseText: 'GoodieAI 出现了两次，GoodieAI',
    keywords: ['GoodieAI']
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'completed');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'completed');
  assert.deepEqual(updates[0].result_summary.keyword_counts, [{ keyword: 'GoodieAI', count: 2 }]);
});

test('deduplicates overlapping keywords for non-project detection records', async () => {
  const updates = [];

  const result = await ProjectRecordFinalizationService.finalize({
    record: {
      id: 3,
      project_id: null,
      update: async (payload) => updates.push(payload)
    },
    responseText: '豆包大模型适合内容生产，豆包大模型也适合知识库问答',
    keywords: ['豆包', '豆包大模型']
  });

  assert.equal(result.ok, true);
  assert.deepEqual(updates[0].result_summary.keyword_counts, [{ keyword: '豆包大模型', count: 2 }]);
});

test('counts compact keyword spellings for non-project detection records', async () => {
  const updates = [];

  const result = await ProjectRecordFinalizationService.finalize({
    record: {
      id: 4,
      project_id: null,
      update: async (payload) => updates.push(payload)
    },
    responseText: 'GoodieAI 适合做 AI 品牌可见度监测',
    keywords: ['Goodie AI']
  });

  assert.equal(result.ok, true);
  assert.deepEqual(updates[0].result_summary.keyword_counts, [{ keyword: 'Goodie AI', count: 1 }]);
});

test('marks empty AI responses as failed before finalizing detection records', async () => {
  const updates = [];
  let metricFinalized = false;

  const result = await ProjectRecordFinalizationService.finalize({
    record: {
      id: 5,
      project_id: 9,
      tracked_prompt_id: 4,
      update: async (payload) => updates.push(payload)
    },
    responseText: '   ',
    keywords: ['米其林'],
    repositories: {
      BrandProject: {
        findByPk: async () => {
          throw new Error('project lookup should not run');
        }
      }
    },
    projectRunService: {
      failRecord: async (record, message) => {
        await record.update({ status: 'failed', error_message: message });
        return true;
      },
      finalizeSuccessfulRecord: async () => {
        metricFinalized = true;
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(metricFinalized, false);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'failed');
  assert.match(updates[0].error_message, /监测平台返回内容为空/);
});

test('marks project detection records as failed when visibility metric generation fails', async () => {
  const updates = [];

  const result = await ProjectRecordFinalizationService.finalize({
    record: {
      id: 2,
      project_id: 9,
      tracked_prompt_id: 4,
      update: async (payload) => updates.push(payload)
    },
    responseText: '米其林静音轮胎不错',
    keywords: ['米其林'],
    repositories: {
      BrandProject: {
        findByPk: async () => ({ id: 9, name: '米其林' })
      },
      BrandCompetitor: {
        findAll: async () => []
      },
      TrackedPrompt: {
        findOne: async () => ({ id: 4, project_id: 9, question: '静音轮胎怎么选' })
      }
    },
    projectRunService: {
      failRecord: async (record, message) => {
        await record.update({ status: 'failed', error_message: message });
        return true;
      },
      finalizeSuccessfulRecord: async () => {
        throw new Error('metric write failed');
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'failed');
  assert.equal(updates[0].error_message, '指标生成失败，请稍后重试');
  assert.equal(result.error.message, '指标生成失败，请稍后重试');
});

test('forwards the record frozen competitor snapshot instead of live competitor identity', async () => {
  const frozen = [{ id: 8, name: '冻结竞品', aliases: ['旧别名'], website: null }];
  let finalized = null;
  const result = await ProjectRecordFinalizationService.finalize({
    record: {
      id: 8,
      project_id: 9,
      tracked_prompt_id: 4,
      competitor_snapshot: frozen
    },
    responseText: '冻结竞品出现在回答中。',
    repositories: {
      BrandProject: { findByPk: async () => ({ id: 9, name: '目标品牌' }) },
      BrandCompetitor: {
        findAll: async () => [{ id: 99, name: '实时新增竞品', aliases: [] }]
      },
      TrackedPrompt: { findOne: async () => ({ id: 4, question: '有哪些品牌？' }) }
    },
    projectRunService: {
      failRecord: async () => true,
      finalizeSuccessfulRecord: async (payload) => {
        finalized = payload;
        return { ok: true, status: 'completed' };
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(finalized.competitorSnapshot, frozen);
});

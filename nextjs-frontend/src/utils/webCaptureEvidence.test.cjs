const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWebCaptureEvidence } = require('./webCaptureEvidence.cjs');

const SEARCH_ARTIFACT_ID = '00000000-0000-4000-8000-000000000011';
const FINAL_ARTIFACT_ID = '00000000-0000-4000-8000-000000000012';

test('API 和没有完整 Web 采集元数据的旧记录不显示 Web 证据', () => {
  assert.equal(buildWebCaptureEvidence({
    id: 21,
    platform: 'deepseek',
    resultDetail: {
      provider_citations: [{ url: 'https://api.example.com/source' }]
    }
  }), null);

  assert.equal(buildWebCaptureEvidence({
    id: 22,
    platform: 'deepseek-web',
    result_summary: {
      web_capture: {
        status: 'completed',
        artifacts: {
          search_state: { id: SEARCH_ARTIFACT_ID }
        }
      }
    }
  }), null);
});

test('Web 证据按角色分组并只生成记录 ID 与 artifact ID 组成的读取地址', () => {
  const evidence = buildWebCaptureEvidence({
    record_id: 37,
    platform: 'deepseek-web',
    model_name: 'deepseek-web-ui',
    provider_citations: [
      {
        url: 'https://explicit.example.com/article',
        title: '平台明确引用',
        source_role: 'explicit_citation'
      },
      {
        url: 'https://retrieval.example.com/result',
        title: '检索候选',
        source_role: 'retrieval_candidate'
      },
      {
        url: 'javascript:alert(1)',
        source_role: 'explicit_citation'
      }
    ],
    web_capture: {
      status: 'completed',
      selector_version: 'deepseek-web-v1',
      captured_at: '2026-07-26T08:30:00.000Z',
      artifact_owner_record_id: 37,
      search: {
        requested: true,
        observed: true,
        evidence_type: 'dom_selected_state'
      },
      artifacts: {
        search_state: {
          id: SEARCH_ARTIFACT_ID,
          path: '/Users/private/profile/search.png'
        },
        final_answer: {
          id: FINAL_ARTIFACT_ID,
          path: '/Users/private/profile/final.png'
        }
      },
      local_profile_path: '/Users/private/profile'
    }
  });

  assert.equal(evidence.recordId, 37);
  assert.equal(evidence.modelName, 'deepseek-web-ui');
  assert.equal(evidence.searchObserved, true);
  assert.equal(evidence.selectorVersion, 'deepseek-web-v1');
  assert.deepEqual(evidence.explicitCitations, [{
    url: 'https://explicit.example.com/article',
    title: '平台明确引用',
    domain: 'explicit.example.com'
  }]);
  assert.deepEqual(evidence.retrievalCandidates, [{
    url: 'https://retrieval.example.com/result',
    title: '检索候选',
    domain: 'retrieval.example.com'
  }]);
  assert.deepEqual(evidence.artifacts, [
    {
      kind: 'search_state',
      label: '联网搜索状态',
      url: `/api/detection/record/37/web-captures/${SEARCH_ARTIFACT_ID}`
    },
    {
      kind: 'final_answer',
      label: '最终回答页面',
      url: `/api/detection/record/37/web-captures/${FINAL_ARTIFACT_ID}`
    }
  ]);
  assert.equal(JSON.stringify(evidence).includes('/Users/private'), false);
});

test('复用历史证据时读取原始归属记录，且不猜测模型版本', () => {
  const evidence = buildWebCaptureEvidence({
    id: 45,
    platform: 'deepseek-web',
    model_name: '',
    resultDetail: { provider_citations: [] },
    result_summary: {
      web_capture: {
        status: 'completed',
        artifact_owner_record_id: 37,
        artifacts: {
          search_state: { id: SEARCH_ARTIFACT_ID },
          final_answer: { id: FINAL_ARTIFACT_ID }
        }
      }
    }
  });

  assert.equal(evidence.recordId, 37);
  assert.equal(evidence.modelName, '');
  assert.match(evidence.artifacts[0].url, /^\/api\/detection\/record\/37\/web-captures\//);
});

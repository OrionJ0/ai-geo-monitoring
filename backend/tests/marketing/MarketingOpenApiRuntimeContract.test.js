const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertMarketingOpenApiResponse
} = require('./helpers/assertMarketingOpenApiResponse');

test('OpenAPI 运行时校验拒绝错误信封和嵌套响应漂移', () => {
  assert.doesNotThrow(() => assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/dashboard',
    status: 401,
    payload: {
      success: false,
      message: '未授权：缺少令牌'
    }
  }));

  assert.throws(
    () => assertMarketingOpenApiResponse({
      path: '/api/marketing/projects/{projectId}/dashboard',
      status: 401,
      payload: {
        success: false,
        message: '未授权：缺少令牌',
        leakedField: '不允许的额外字段'
      }
    }),
    /OpenAPI 响应不匹配/u
  );

  assert.throws(
    () => assertMarketingOpenApiResponse({
      path: '/api/marketing/projects/{projectId}/keywords',
      status: 200,
      payload: {
        schemaVersion: 'marketing_keywords_v1',
        projectId: '11',
        revision: 'revision-1',
        coverage: {
          from: '2026-07-01',
          to: '2026-07-31',
          lastSuccessfulAt: '2026-08-01T00:00:00.000Z',
          currency: 'CNY',
          costScale: 2
        },
        filter: {
          from: '2026-07-01',
          to: '2026-07-31'
        },
        summary: {
          impressions: '1',
          clicks: '1',
          costAmountScaled: '1'
        },
        items: [{
          accountId: 'account-1',
          campaignId: 'campaign-1',
          campaignName: '计划一',
          adGroupId: 'group-1',
          adGroupName: '单元一',
          keywordId: 'keyword-1',
          keywordName: '脱敏关键词',
          targetingType: 'KEYWORD',
          impressions: 1,
          clicks: '1',
          costAmountScaled: '1',
          trend: []
        }],
        pagination: {
          page: 1,
          pageSize: 50,
          totalItems: 1,
          totalPages: 1
        }
      }
    }),
    /items\/0\/impressions/u
  );
});

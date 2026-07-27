/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReportCsv, csvEscape } = require('./reportCsv.cjs');

test('escapes csv fields that contain commas, quotes or line breaks', () => {
  assert.equal(csvEscape('普通文本'), '普通文本');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('a"b'), '"a""b"');
  assert.equal(csvEscape('a\nb'), '"a\nb"');
});

test('exports source domain context needed for report review', () => {
  const csv = buildReportCsv({
    summary: {
      platforms: [],
      categories: [],
      competitors: [],
      trend: [],
      source_types: [
        { type: '媒体内容', citation_count: 4, response_count: 3, domain_count: 2 }
      ],
      source_domains: [
        {
          domain: 'example.com',
          source_type: '自有来源',
          response_count: 2,
          citation_count: 3,
          platforms: ['doubao', 'deepseek'],
          categories: ['购买决策', '竞品对比']
        }
      ],
      source_urls: [
        {
          url: 'https://example.com/guide',
          domain: 'example.com',
          source_type: '第三方来源',
          response_count: 1,
          citation_count: 2,
          platforms: ['deepseek'],
          categories: ['购买决策']
        }
      ],
      source_changes: {
        new_domains: [{ domain: 'new.com', source_type: '第三方来源', citation_count: 1, platforms: ['deepseek'], categories: ['购买决策'] }],
        dropped_domains: [{ domain: 'old.com', source_type: '竞品来源', citation_count: 2, platforms: ['doubao'], categories: ['竞品对比'] }],
        retained_domains: [{ domain: 'kept.com', source_type: '自有来源', citation_count: 3, platforms: ['doubao', 'deepseek'], categories: ['购买决策'] }],
        new_urls: [{ url: 'https://new.com/page', domain: 'new.com', source_type: '第三方来源', citation_count: 1, platforms: ['deepseek'], categories: ['购买决策'] }],
        dropped_urls: [{ url: 'https://old.com/page', domain: 'old.com', source_type: '竞品来源', citation_count: 2, platforms: ['doubao'], categories: ['竞品对比'] }],
        retained_urls: [{ url: 'https://kept.com/page', domain: 'kept.com', source_type: '自有来源', citation_count: 3, platforms: ['doubao', 'deepseek'], categories: ['购买决策'] }]
      },
      opportunities: []
    }
  });

  assert.match(csv, /域名,来源类型,覆盖回答,引用次数,平台,问题分类/);
  assert.match(csv, /example\.com,自有来源,2,3,豆包、DeepSeek,购买决策、竞品对比/);
  assert.match(csv, /Top 引用 URL\nURL,域名,来源类型,覆盖回答,引用次数,平台,问题分类/);
  assert.match(csv, /来源类型\n类型,引用次数,覆盖回答,域名数/);
  assert.match(csv, /媒体内容,4,3,2/);
  assert.match(csv, /https:\/\/example\.com\/guide,example\.com,第三方来源,1,2,DeepSeek,购买决策/);
  assert.match(csv, /新增引用域名\n域名,来源类型,引用次数,平台,问题分类/);
  assert.match(csv, /new\.com,第三方来源,1,DeepSeek,购买决策/);
  assert.match(csv, /流失引用域名\n域名,来源类型,引用次数,平台,问题分类/);
  assert.match(csv, /old\.com,竞品来源,2,豆包,竞品对比/);
  assert.match(csv, /保留引用域名\n域名,来源类型,引用次数,平台,问题分类/);
  assert.match(csv, /kept\.com,自有来源,3,豆包、DeepSeek,购买决策/);
  assert.match(csv, /新增引用 URL\nURL,域名,来源类型,引用次数,平台,问题分类/);
  assert.match(csv, /https:\/\/new\.com\/page,new\.com,第三方来源,1,DeepSeek,购买决策/);
  assert.match(csv, /流失引用 URL\nURL,域名,来源类型,引用次数,平台,问题分类/);
  assert.match(csv, /https:\/\/old\.com\/page,old\.com,竞品来源,2,豆包,竞品对比/);
  assert.match(csv, /保留引用 URL\nURL,域名,来源类型,引用次数,平台,问题分类/);
  assert.match(csv, /https:\/\/kept\.com\/page,kept\.com,自有来源,3,豆包、DeepSeek,购买决策/);
});

test('exports overall report summary before detailed sections', () => {
  const csv = buildReportCsv({
    summary: {
      total_checks: 12,
      brand_mention_rate: 75,
      avg_share_of_voice: 42.5,
      citation_rate: 66.67,
      citation_eligible_checks: 12,
      recommendation_rate: 25,
      avg_brand_rank: 2.25,
      owned_citation_rate: 40,
      source_summary: {
        total_citations: 18,
        source_domain_count: 6
      },
      total_runs: 15,
      completed_runs: 12,
      failed_runs: 3,
      failure_rate: 20,
      negative_sentiment_rate: 8.33,
      platforms: [],
      categories: [],
      competitors: [],
      trend: [],
      source_domains: [],
      source_urls: [],
      opportunities: []
    }
  });

  assert.match(csv, /^整体概览\n指标,值\n/);
  assert.match(csv, /总运行数,15/);
  assert.match(csv, /有效分析数,12/);
  assert.match(csv, /完成运行数,12/);
  assert.match(csv, /失败运行数,3/);
  assert.match(csv, /失败率,20%/);
  assert.match(csv, /品牌提及率,75%/);
  assert.match(csv, /平均声量占比（SOV）,42\.5%/);
  assert.match(csv, /引用率,66\.67%/);
  assert.match(csv, /推荐率,25%/);
  assert.match(csv, /负向情绪率,8\.33%/);
  assert.match(csv, /平均品牌排名,2\.25/);
  assert.match(csv, /自有来源覆盖率,40%/);
  assert.match(csv, /引用源总数,18/);
  assert.match(csv, /来源域名数,6/);
  assert.match(csv, /来源域名数,6\n\n平台表现/);
});

test('exports unknown instead of zero percent when no explicit-citation sample is eligible', () => {
  const csv = buildReportCsv({
    summary: {
      total_checks: 10,
      citation_eligible_checks: 0,
      citation_unverified_checks: 10,
      citation_rate: 0
    }
  });

  assert.match(csv, /引用率,暂无可验证样本/);
});

test('exports category level run failures in report csv', () => {
  const csv = buildReportCsv({
    summary: {
      platforms: [],
      categories: [
        {
          category: '购买决策',
          prompt_count: 4,
          enabled_prompt_count: 3,
          total_runs: 10,
          failed_runs: 2,
          failure_rate: 20,
          checks: 8,
          citation_eligible_checks: 8,
          brand_mention_rate: 75,
          avg_share_of_voice: 42.5,
          citation_rate: 50,
          recommendation_rate: 25
        }
      ],
      competitors: [],
      trend: [],
      source_domains: [],
      source_urls: [],
      opportunities: []
    }
  });

  assert.match(csv, /分类,问题数,启用问题数,运行数,失败数,失败率,有效分析数/);
  assert.match(csv, /购买决策,4,3,10,2,20%,8,75%,42\.5%,50%,25%/);
});

test('exports competitor visibility score for alert review', () => {
  const csv = buildReportCsv({
    summary: {
      platforms: [],
      categories: [],
      competitors: [
        { name: '马牌', mentions: 5, appeared_checks: 3, visibility_score: 12.5 }
      ],
      trend: [],
      source_domains: [],
      source_urls: [],
      opportunities: []
    }
  });

  assert.match(csv, /竞品,提及次数,出现分析数,可见度得分/);
  assert.match(csv, /马牌,5,3,12\.5/);
});

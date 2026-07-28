const test = require('node:test');
const assert = require('node:assert/strict');

const {
  describeSelectedPlatforms,
  formatUnavailablePlatformSummary
} = require('./platformSelectionStatus.cjs');

const catalog = [
  {
    code: 'deepseek-web',
    name: 'DeepSeek 网页版',
    selectable: true
  },
  {
    code: 'doubao-web',
    name: '豆包网页版',
    selectable: false,
    unavailable_reason: 'disabled'
  },
  {
    code: 'qwen',
    name: '千问',
    selectable: false,
    unavailable_reason: 'missing_api_key'
  }
];

test('marks disabled platforms that are still selected by a project', () => {
  assert.deepEqual(
    describeSelectedPlatforms(['deepseek-web', 'doubao-web'], catalog),
    [
      {
        code: 'deepseek-web',
        name: 'DeepSeek 网页版',
        selectable: true,
        unavailableLabel: null,
        displayLabel: 'DeepSeek 网页版'
      },
      {
        code: 'doubao-web',
        name: '豆包网页版',
        selectable: false,
        unavailableLabel: '已停用',
        displayLabel: '豆包网页版（已停用）'
      }
    ]
  );
});

test('summarizes every unavailable project platform with an actionable reason', () => {
  const statuses = describeSelectedPlatforms(['doubao-web', 'qwen', 'removed'], catalog);
  assert.equal(
    formatUnavailablePlatformSummary(statuses),
    '豆包网页版（已停用）、千问（管理员尚未配置）、removed（平台已不存在）'
  );
});

test('does not claim a saved platform was removed before the catalog is ready', () => {
  assert.deepEqual(
    describeSelectedPlatforms(['doubao-web'], [], { catalogReady: false }),
    [
      {
        code: 'doubao-web',
        name: 'doubao-web',
        selectable: true,
        unavailableLabel: null,
        displayLabel: 'doubao-web'
      }
    ]
  );
});

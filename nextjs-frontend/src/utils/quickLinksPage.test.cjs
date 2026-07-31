/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(
  __dirname,
  '../app/geo/quick-links/page.tsx'
);

test('常用网站完整展示来源系统并使用用户提供的官方入口', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  [
    '百度营销',
    '上海广拓官网后台',
    '基木鱼',
    '百度巧舱',
    '百度 Agent 对话页',
    '营销通',
    '爱番番',
    '百度爱采购',
    '百度统计'
  ].forEach((label) => assert.match(source, new RegExp(label)));

  [
    'https://www2.baidu.com/',
    'https://gato.com.cn/admin',
    'https://aiagent.baidu.com/mbot/index',
    'https://yingxiaotong.baidu.com/',
    'https://aifanfan.baidu.com/',
    'https://b2b.baidu.com/',
    'https://b2bwork.baidu.com/login',
    'https://tongji.baidu.com/'
  ].forEach((href) => assert.equal(source.includes(href), true));
});

test('外部入口在新标签页安全打开，未知 Agent 地址不伪造链接', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /<a[\s\S]*className=\{styles\.systemCard\}/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noreferrer"/);
  assert.match(source, /完整地址待补充/);
  assert.doesNotMatch(source, /https:\/\/ada\.baidu\.com\/\.\.\./);
});

test('常用网站通过分组和整卡交互表达用途，不显示重复说明和操作链接', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  ['内部工作入口', '快捷导航', '集中打开常用营销', '打开广告投放后台', '从百度营销进入']
    .forEach((copy) => assert.equal(source.includes(copy), false));
  assert.doesNotMatch(source, /description:/);
  assert.doesNotMatch(source, /styles\.externalLink/);
});

test('每个网站卡片提供站点图标并保留文字回退', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /className=\{styles\.siteIcon\}/);
  assert.match(source, /<img/);
  assert.match(source, /iconFallback/);
  [
    'https://www.baidu.com/favicon.ico',
    'https://gato.com.cn/uploads/images/6fd57a1b-0523-460d-a4a7-4d3aa7001d60.svg',
    'https://fe-resource.cdn.bcebos.com/agent/qiaoCangIcon.png',
    'https://aifanfan.baidu.com/favicon.ico',
    'https://b2b.baidu.com/favicon.ico',
    'https://tongji.baidu.com/favicon.ico'
  ].forEach((iconUrl) => assert.equal(source.includes(iconUrl), true));
});

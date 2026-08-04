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
    '百度推广',
    '百度统计',
    '百度搜索资源平台',
    'Bing 网站管理平台',
    '官网首页',
    '爱采购',
    '基木鱼',
    '百度巧舱',
    '官网后台',
    '53KF 后台',
    '爱采购商家后台',
    '营销通',
    '爱番番'
  ].forEach((label) => assert.match(source, new RegExp(label)));

  [
    'https://www2.baidu.com/',
    'https://tongji.baidu.com/',
    'https://zy.baidu.com/',
    'https://www.bing.com/webmasters/',
    'https://gato.com.cn/',
    'https://gato.com.cn/admin',
    'https://www.53kf.com/login/guide',
    'https://aiagent.baidu.com/mbot/index',
    'https://yingxiaotong.baidu.com/',
    'https://aifanfan.baidu.com/',
    'https://b2b.baidu.com/',
    'https://b2bwork.baidu.com/login'
  ].forEach((href) => assert.equal(source.includes(href), true));
});

test('外部入口在新标签页安全打开', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /<a[\s\S]*className=\{styles\.systemCard\}/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noreferrer"/);
});

test('常用网站按工作用途排列', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const titles = ['广告投放', '流量与站点', '落地页', '接待与管理'];
  const indexes = titles.map((title) => source.indexOf(`title: '${title}'`));

  indexes.forEach((index) => assert.ok(index >= 0));
  assert.deepEqual([...indexes].sort((left, right) => left - right), indexes);
  const landingPageGroup = source.slice(indexes[2], indexes[3]);
  const managementGroup = source.slice(indexes[3]);
  assert.match(landingPageGroup, /基木鱼/);
  assert.match(managementGroup, /爱采购商家后台/);
  assert.equal(source.includes('百度 Agent 对话页'), false);
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
    'https://tongji.baidu.com/favicon.ico',
    'https://zy.baidu.com/favicon.ico',
    'https://www.bing.com/favicon.ico',
    'https://www.53kf.com/favicon.ico'
  ].forEach((iconUrl) => assert.equal(source.includes(iconUrl), true));
  assert.match(source, /name: '基木鱼',[\s\S]*?fallback: '基',[\s\S]*?href: 'https:\/\/www2\.baidu\.com\/'/);
});

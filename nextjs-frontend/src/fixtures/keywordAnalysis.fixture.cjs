const KEYWORD_FIXTURE_RANGE = Object.freeze({
  from: '2026-07-05',
  to: '2026-08-03'
});

const TAGS = [
  '优先加投',
  '稳健保持',
  '控制浪费',
  '样本不足'
];

const SPECIAL_KEYWORDS = Object.freeze({
  47: {
    keyword: '电子围栏厂家',
    tag: '优先加投',
    costAmountScaled: '6852000',
    impressions: '45632',
    clicks: '628',
    unitName: '电子围栏 / 厂家词'
  },
  48: {
    keyword: '周界报警系统',
    tag: '稳健保持',
    costAmountScaled: '5634000',
    impressions: '42178',
    clicks: '572',
    unitName: '周界系统 / 通用词'
  },
  49: {
    keyword: '振动光纤价格',
    tag: '控制浪费',
    costAmountScaled: '4586000',
    impressions: '38772',
    clicks: '421',
    unitName: '振动光纤 / 价格词'
  },
  50: {
    keyword: '周界报警方案',
    tag: '样本不足',
    costAmountScaled: '3876000',
    impressions: '32641',
    clicks: '386',
    unitName: '周界方案 / 方案词'
  }
});

const GENERIC_TERMS = [
  '电子围栏',
  '周界报警',
  '振动光纤',
  '脉冲电子围栏',
  '张力围栏',
  '激光对射',
  '防攀爬报警',
  '机场周界',
  '园区安防',
  '变电站周界',
  '看守所周界',
  '监狱周界'
];

function fixtureDate(index) {
  const date = new Date('2026-07-05T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + (index % 30));
  return date.toISOString().slice(0, 10);
}

function genericKeyword(index) {
  const base = GENERIC_TERMS[index % GENERIC_TERMS.length];
  const suffixes = ['厂家', '系统', '价格', '方案', '品牌', '安装', '报价'];
  return `${base}${suffixes[Math.floor(index / GENERIC_TERMS.length) % suffixes.length]} ${index + 1}`;
}

function clickedTag(index) {
  if (index <= 16) return '优先加投';
  if (index <= 29) return '稳健保持';
  if (index <= 40) return '控制浪费';
  return '样本不足';
}

function buildClickedFact(index) {
  const special = SPECIAL_KEYWORDS[index];
  if (special) return special;
  const clicks = 30 + (index * 7);
  const targetCtr = 1 + (((index * 17) % 47) * 0.1);
  const impressions = Math.round(clicks / (targetCtr / 100));
  const averageCpc = 23 + ((index * 23) % 47);
  return {
    keyword: genericKeyword(index),
    tag: clickedTag(index),
    costAmountScaled: String(clicks * averageCpc * 100),
    impressions: String(impressions),
    clicks: String(clicks),
    unitName: `${GENERIC_TERMS[index % GENERIC_TERMS.length]} / ${index % 2 ? '通用词' : '意向词'}`
  };
}

function buildFact(index) {
  const clicked = index < 51 ? buildClickedFact(index) : null;
  const duplicateVisibleText = index === 51 ? '周界报警系统' : null;
  const unitIndex = index % 18;
  return {
    date: fixtureDate(index),
    accountId: `fixture-account-${index % 2 + 1}`,
    accountName: index % 2 ? '广拓百度搜索推广 B' : '广拓百度搜索推广 A',
    projectId: 'fixture-project-perimeter',
    projectName: '周界报警',
    schemeId: `fixture-scheme-${index % 6 + 1}`,
    schemeName: index % 2 ? '移动-周界报警' : 'PC-周界报警',
    unitId: `fixture-unit-${unitIndex + 1}`,
    unitName: clicked?.unitName || `${GENERIC_TERMS[unitIndex % GENERIC_TERMS.length]} / 长尾词`,
    keywordId: `fixture-keyword-${String(index + 1).padStart(3, '0')}`,
    keyword: duplicateVisibleText || clicked?.keyword || genericKeyword(index),
    tag: clicked?.tag || TAGS[index % TAGS.length],
    costAmountScaled: clicked?.costAmountScaled || '0',
    impressions: clicked?.impressions || String(180 + ((index * 137) % 5100)),
    clicks: clicked?.clicks || '0'
  };
}

function buildKeywordFixture(empty = false) {
  return {
    source: 'development-fixture',
    dataState: empty ? 'empty' : 'ready',
    projectId: 'fixture-market-workspace',
    projectName: '上海广拓',
    currency: 'CNY',
    costScale: 2,
    updatedAt: '2026-08-03T09:30:00+08:00',
    availableFrom: KEYWORD_FIXTURE_RANGE.from,
    availableTo: KEYWORD_FIXTURE_RANGE.to,
    facts: empty ? [] : Array.from({ length: 302 }, (_, index) => buildFact(index))
  };
}

module.exports = {
  KEYWORD_FIXTURE_RANGE,
  buildKeywordFixture
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pages = [
  'market-overview',
  'ad-performance',
  'keyword-analysis',
  'website-traffic',
  'consultations',
  'order-results'
];

function pageSource(page) {
  return fs.readFileSync(path.resolve(
    __dirname,
    `../../src/app/geo/${page}/page.tsx`
  ), 'utf8');
}

test('all marketing pages share the device-first date filter', () => {
  for (const page of pages) {
    const source = pageSource(page);
    assert.match(source, /<MarketingPageFilters/);
    assert.match(source, /useMarketingFilters\(\)/);
    assert.match(source, /device=\{/);
    assert.match(source, /dateRange=\{/);
    assert.doesNotMatch(source, /useState<[^>]*(?:MarketingDevice|WebsiteDevice|DateRange)/);
    const filterCall = source.match(/<MarketingPageFilters[\s\S]*?\/>/)?.[0] || '';
    assert.doesNotMatch(filterCall, /\sdisabled=/);
  }

  const filter = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/components/marketing/MarketingPageFilters.tsx'
  ), 'utf8');
  assert.ok(filter.indexOf('className={styles.deviceSelect}')
    < filter.indexOf('className={styles.dateFilter}'));
  assert.doesNotMatch(filter, /className=\{styles\.deviceFilter\}/);
  for (const days of [7, 14, 30, 90]) {
    assert.match(filter, new RegExp(String(days)));
  }
});

test('marketing filters have one shared PC and last-complete-seven-day default', () => {
  const context = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/components/marketing/MarketingFiltersContext.tsx'
  ), 'utf8');
  const layout = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/app/geo/layout.tsx'
  ), 'utf8');

  assert.match(context, /DEFAULT_MARKETING_DEVICE[^\n]*'pc'/);
  assert.match(context, /DEFAULT_MARKETING_RANGE_DAYS = 7/);
  assert.match(context, /const lastCompleteDay = anchor\.subtract\(1, 'day'\)/);
  assert.match(context, /lastCompleteDay[\s\S]*subtract\(DEFAULT_MARKETING_RANGE_DAYS - 1, 'day'\)/);
  assert.doesNotMatch(context, /anchor\.format\('YYYY-MM-DD'\)/);
  assert.match(context, /clampMarketingDateRange/);
  assert.match(context, /end\.isAfter\(dayjs\(coverage\.to\), 'day'\)/);
  assert.match(layout, /<MarketingFiltersProvider>/);
});

test('all marketing pages use the shared period-comparison metric cards', () => {
  for (const page of pages) {
    const source = pageSource(page);
    assert.match(source, /<MarketingMetricGrid/);
    assert.match(source, /<MarketingMetricCard/);
  }

  const card = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/components/marketing/MarketingMetricCard.tsx'
  ), 'utf8');
  assert.match(card, />本期</);
  assert.match(card, />上期</);
  assert.match(card, />较上一周期</);
});

test('overview cards only show established metric abbreviations', () => {
  const forbiddenEnglishLabels = [
    'COST',
    'IMPRESSIONS',
    'CLICKS',
    'IMPRESSION KEYWORDS',
    'CLICKED KEYWORDS',
    'CLICK COVERAGE',
    'NO CLICK',
    'VISITS',
    'BOUNCE',
    'DURATION',
    'PAGES',
    'FORM',
    '53KF CHAT',
    'ORDERS',
    'AMOUNT',
    'ATTRIBUTED',
    'PENDING'
  ];
  const source = pages.map(pageSource).join('\n');
  for (const label of forbiddenEnglishLabels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(
      source,
      new RegExp(`metricKey(?:=|:)\\s*["']${escaped}["']`)
    );
  }
  for (const abbreviation of ['CPC', 'UV', 'PV', 'ROAS', 'CPL', 'CPA']) {
    assert.match(source, new RegExp(`["']${abbreviation}["']`));
  }
});

test('unsupported device dimensions stay visible without breaking global selection', () => {
  for (const page of ['ad-performance', 'keyword-analysis', 'order-results']) {
    assert.match(pageSource(page), /availableDevices=\{\['all'\]\}/);
  }

  const filter = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/components/marketing/MarketingPageFilters.tsx'
  ), 'utf8');
  assert.doesNotMatch(filter, /disabled:\s*!availableDevices\.includes/);
  assert.match(filter, /选择会保留到其他页面/);
  assert.match(filter, /本页未应用/);
  assert.match(filter, /trigger=\{\['hover'\]\}/);
  assert.doesNotMatch(filter, /trigger=\{\['hover', 'focus'\]\}/);
});

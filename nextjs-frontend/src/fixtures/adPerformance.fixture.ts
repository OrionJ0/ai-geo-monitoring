import {
  buildAdPeriod,
  shiftIsoDate,
  sumAdMetrics,
  type AdDailyMetrics,
  type AdDeliveryStatus,
  type AdDetailItem,
  type AdExactMetrics,
  type AdHierarchyLevel,
  type AdHierarchyNode,
  type AdPerformanceModel
} from '@/lib/marketing/adPerformanceAdapter';

type FixtureNodeDefinition = {
  key: string;
  id: string;
  name: string;
  level: AdHierarchyLevel;
  weight: number;
  status: AdDeliveryStatus;
  budgetAmountScaled: string | null;
  details: AdDetailItem[];
  children?: FixtureNodeDefinition[];
};

const CURRENT_FROM = '2026-07-05';
const CURRENT_TO = '2026-08-03';
const PREVIOUS_FROM = '2026-06-05';
const COST_SCALE = 2;
const CURRENCY = 'CNY';

const CURRENT_WEIGHTS = [
  72, 116, 97, 104, 135, 119, 81, 94, 121, 120,
  124, 103, 108, 121, 106, 95, 112, 104, 126, 117,
  99, 122, 129, 146, 121, 111, 84, 79, 107, 86
];

const PREVIOUS_WEIGHTS = [
  55, 83, 71, 70, 78, 64, 49, 59, 85, 91,
  82, 63, 76, 94, 87, 69, 68, 70, 73, 91,
  74, 65, 80, 92, 95, 77, 61, 52, 81, 58
];

const DEFINITIONS: FixtureNodeDefinition[] = [
  {
    key: 'project:perimeter-alarm',
    id: 'P-1001',
    name: '周界报警',
    level: 'project',
    weight: 64,
    status: 'active',
    budgetAmountScaled: '38000000',
    details: [
      { label: '项目 ID', value: 'P-1001' },
      { label: '优化目标', value: '网站访问' },
      { label: '项目预算', value: '¥380,000.00' },
      { label: '下属方案数', value: '2' },
      { label: '投放状态', value: '投放中', status: 'active' }
    ],
    children: [
      {
        key: 'scheme:pc-multi-region',
        id: '113742484',
        name: 'PC-周界报警-振动光纤-多地域',
        level: 'scheme',
        weight: 45,
        status: 'active',
        budgetAmountScaled: '15000000',
        details: [
          { label: '方案 ID', value: '113742484' },
          { label: '所属项目', value: '周界报警' },
          { label: '投放设备', value: 'PC' },
          { label: '投放地域', value: '多地域' },
          { label: '出价策略', value: '点击出价' },
          { label: '周期预算', value: '¥150,000.00' },
          { label: '投放状态', value: '投放中', status: 'active' }
        ],
        children: [
          {
            key: 'unit:vibration-vendor',
            id: 'U-21001',
            name: '振动光纤｜厂家词',
            level: 'unit',
            weight: 46,
            status: 'active',
            budgetAmountScaled: null,
            details: [
              { label: '单元 ID', value: 'U-21001' },
              { label: '所属方案', value: 'PC-周界报警-振动光纤-多地域' },
              { label: '产品主题', value: '振动光纤' },
              { label: '默认出价', value: '¥9.80' },
              { label: '投放状态', value: '投放中', status: 'active' }
            ]
          },
          {
            key: 'unit:vibration-general',
            id: 'U-21002',
            name: '振动光纤｜通用词',
            level: 'unit',
            weight: 54,
            status: 'active',
            budgetAmountScaled: null,
            details: [
              { label: '单元 ID', value: 'U-21002' },
              { label: '所属方案', value: 'PC-周界报警-振动光纤-多地域' },
              { label: '产品主题', value: '振动光纤' },
              { label: '默认出价', value: '¥10.20' },
              { label: '投放状态', value: '投放中', status: 'active' }
            ]
          }
        ]
      },
      {
        key: 'scheme:pc-electric-fence',
        id: '113742502',
        name: 'PC-周界报警-电子围栏-全国',
        level: 'scheme',
        weight: 35,
        status: 'active',
        budgetAmountScaled: '12000000',
        details: [
          { label: '方案 ID', value: '113742502' },
          { label: '所属项目', value: '周界报警' },
          { label: '投放设备', value: 'PC' },
          { label: '投放地域', value: '全国' },
          { label: '出价策略', value: '点击出价' },
          { label: '周期预算', value: '¥120,000.00' },
          { label: '投放状态', value: '投放中', status: 'active' }
        ],
        children: [
          {
            key: 'unit:fence-solution',
            id: 'U-22001',
            name: '电子围栏｜方案词',
            level: 'unit',
            weight: 58,
            status: 'active',
            budgetAmountScaled: null,
            details: [
              { label: '单元 ID', value: 'U-22001' },
              { label: '所属方案', value: 'PC-周界报警-电子围栏-全国' },
              { label: '产品主题', value: '电子围栏' },
              { label: '默认出价', value: '¥8.60' },
              { label: '投放状态', value: '投放中', status: 'active' }
            ]
          },
          {
            key: 'unit:fence-procurement',
            id: 'U-22002',
            name: '电子围栏｜采购词',
            level: 'unit',
            weight: 42,
            status: 'paused',
            budgetAmountScaled: null,
            details: [
              { label: '单元 ID', value: 'U-22002' },
              { label: '所属方案', value: 'PC-周界报警-电子围栏-全国' },
              { label: '产品主题', value: '电子围栏' },
              { label: '默认出价', value: '¥8.20' },
              { label: '投放状态', value: '已暂停', status: 'paused' }
            ]
          }
        ]
      }
    ]
  },
  {
    key: 'project:brand-terms',
    id: 'P-1002',
    name: '品牌词',
    level: 'project',
    weight: 20,
    status: 'active',
    budgetAmountScaled: '8000000',
    details: [
      { label: '项目 ID', value: 'P-1002' },
      { label: '优化目标', value: '品牌保护' },
      { label: '项目预算', value: '¥80,000.00' },
      { label: '下属方案数', value: '1' },
      { label: '投放状态', value: '投放中', status: 'active' }
    ],
    children: [
      {
        key: 'scheme:brand-national',
        id: '113742610',
        name: '品牌词-全国',
        level: 'scheme',
        weight: 100,
        status: 'active',
        budgetAmountScaled: '8000000',
        details: [
          { label: '方案 ID', value: '113742610' },
          { label: '所属项目', value: '品牌词' },
          { label: '投放设备', value: '全部设备' },
          { label: '投放地域', value: '全国' },
          { label: '出价策略', value: '点击出价' },
          { label: '周期预算', value: '¥80,000.00' },
          { label: '投放状态', value: '投放中', status: 'active' }
        ],
        children: [
          {
            key: 'unit:brand-exact',
            id: 'U-24001',
            name: '品牌词｜精确匹配',
            level: 'unit',
            weight: 100,
            status: 'active',
            budgetAmountScaled: null,
            details: [
              { label: '单元 ID', value: 'U-24001' },
              { label: '所属方案', value: '品牌词-全国' },
              { label: '产品主题', value: '品牌防护' },
              { label: '默认出价', value: '¥5.90' },
              { label: '投放状态', value: '投放中', status: 'active' }
            ]
          }
        ]
      }
    ]
  },
  {
    key: 'project:indoor-alarm',
    id: 'P-1003',
    name: '室内报警',
    level: 'project',
    weight: 16,
    status: 'active',
    budgetAmountScaled: '9000000',
    details: [
      { label: '项目 ID', value: 'P-1003' },
      { label: '优化目标', value: '网站访问' },
      { label: '项目预算', value: '¥90,000.00' },
      { label: '下属方案数', value: '1' },
      { label: '投放状态', value: '投放中', status: 'active' }
    ],
    children: [
      {
        key: 'scheme:indoor-search',
        id: '113742710',
        name: 'PC-室内报警-全国',
        level: 'scheme',
        weight: 100,
        status: 'active',
        budgetAmountScaled: '9000000',
        details: [
          { label: '方案 ID', value: '113742710' },
          { label: '所属项目', value: '室内报警' },
          { label: '投放设备', value: 'PC' },
          { label: '投放地域', value: '全国' },
          { label: '出价策略', value: '点击出价' },
          { label: '周期预算', value: '¥90,000.00' },
          { label: '投放状态', value: '投放中', status: 'active' }
        ],
        children: [
          {
            key: 'unit:indoor-general',
            id: 'U-25001',
            name: '室内报警｜通用词',
            level: 'unit',
            weight: 100,
            status: 'active',
            budgetAmountScaled: null,
            details: [
              { label: '单元 ID', value: 'U-25001' },
              { label: '所属方案', value: 'PC-室内报警-全国' },
              { label: '产品主题', value: '室内报警' },
              { label: '默认出价', value: '¥7.80' },
              { label: '投放状态', value: '投放中', status: 'active' }
            ]
          }
        ]
      }
    ]
  }
];

function allocate(total: bigint, weights: number[]): bigint[] {
  const weightTotal = BigInt(weights.reduce((sum, value) => sum + value, 0));
  let assigned = BigInt(0);
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return total - assigned;
    const value = (total * BigInt(weight)) / weightTotal;
    assigned += value;
    return value;
  });
}

function buildPeriodDaily(
  from: string,
  totals: AdExactMetrics,
  weights: number[]
): AdDailyMetrics[] {
  const costs = allocate(BigInt(totals.costAmountScaled), weights);
  const impressions = allocate(BigInt(totals.impressions), weights);
  const clicks = allocate(BigInt(totals.clicks), weights);
  return weights.map((_, index) => ({
    date: shiftIsoDate(from, index),
    costAmountScaled: costs[index].toString(),
    impressions: impressions[index].toString(),
    clicks: clicks[index].toString()
  }));
}

const OVERALL_DAILY: AdDailyMetrics[] = [
  ...buildPeriodDaily(PREVIOUS_FROM, {
    costAmountScaled: '27190400',
    impressions: '7812350',
    clicks: '38972'
  }, PREVIOUS_WEIGHTS),
  ...buildPeriodDaily(CURRENT_FROM, {
    costAmountScaled: '42752800',
    impressions: '8566634',
    clicks: '49648'
  }, CURRENT_WEIGHTS)
];

function splitDaily(
  rows: AdDailyMetrics[],
  definitions: FixtureNodeDefinition[]
): Map<string, AdDailyMetrics[]> {
  const result = new Map<string, AdDailyMetrics[]>();
  definitions.forEach((definition) => result.set(definition.key, []));
  for (const row of rows) {
    const weights = definitions.map((definition) => definition.weight);
    const costs = allocate(BigInt(row.costAmountScaled), weights);
    const impressions = allocate(BigInt(row.impressions), weights);
    const clicks = allocate(BigInt(row.clicks), weights);
    definitions.forEach((definition, index) => {
      result.get(definition.key)?.push({
        date: row.date,
        costAmountScaled: costs[index].toString(),
        impressions: impressions[index].toString(),
        clicks: clicks[index].toString()
      });
    });
  }
  return result;
}

function filterDaily(rows: AdDailyMetrics[], from: string, to: string) {
  return rows.filter((row) => row.date >= from && row.date <= to);
}

function buildNodes(
  definitions: FixtureNodeDefinition[],
  parentDaily: AdDailyMetrics[],
  currentFrom: string,
  currentTo: string,
  previousFrom: string,
  previousTo: string
): AdHierarchyNode[] {
  const dailyByKey = splitDaily(parentDaily, definitions);
  return definitions.map((definition) => {
    const daily = dailyByKey.get(definition.key) || [];
    const currentTrend = filterDaily(daily, currentFrom, currentTo);
    const previousTrend = filterDaily(daily, previousFrom, previousTo);
    return {
      key: definition.key,
      id: definition.id,
      name: definition.name,
      level: definition.level,
      status: definition.status,
      budgetAmountScaled: definition.budgetAmountScaled,
      metrics: sumAdMetrics(currentTrend),
      currentTrend,
      previousTrend,
      details: definition.details,
      children: definition.children?.length
        ? buildNodes(
            definition.children,
            daily,
            currentFrom,
            currentTo,
            previousFrom,
            previousTo
          )
        : undefined
    };
  });
}

export function buildAdPerformanceFixture(
  currentFrom = CURRENT_FROM,
  currentTo = CURRENT_TO,
  empty = false
): AdPerformanceModel {
  const period = buildAdPeriod(currentFrom, currentTo);
  if (empty) {
    return {
      source: 'development-fixture',
      dataState: 'empty',
      projectId: 'fixture-market-workspace',
      projectName: '默认监控项目',
      currency: CURRENCY,
      costScale: COST_SCALE,
      availableFrom: PREVIOUS_FROM,
      availableTo: CURRENT_TO,
      period,
      summary: {
        costAmountScaled: '0',
        impressions: '0',
        clicks: '0'
      },
      previousState: 'UNAVAILABLE',
      previousSummary: null,
      previousUnavailableReason: '开发数据没有可用的上一周期。',
      currentTrend: [],
      previousTrend: [],
      structure: []
    };
  }
  const currentTrend = filterDaily(
    OVERALL_DAILY,
    period.currentFrom,
    period.currentTo
  );
  const previousTrend = filterDaily(
    OVERALL_DAILY,
    period.previousFrom,
    period.previousTo
  );
  return {
    source: 'development-fixture',
    dataState: 'ready',
    projectId: 'fixture-market-workspace',
    projectName: '默认监控项目',
    currency: CURRENCY,
    costScale: COST_SCALE,
    availableFrom: PREVIOUS_FROM,
    availableTo: CURRENT_TO,
    period,
    summary: sumAdMetrics(currentTrend),
    previousState: 'READY',
    previousSummary: sumAdMetrics(previousTrend),
    previousUnavailableReason: '',
    currentTrend,
    previousTrend,
    structure: buildNodes(
      DEFINITIONS,
      OVERALL_DAILY,
      period.currentFrom,
      period.currentTo,
      period.previousFrom,
      period.previousTo
    )
  };
}

export const AD_PERFORMANCE_FIXTURE_DEFAULT_RANGE = Object.freeze({
  from: CURRENT_FROM,
  to: CURRENT_TO
});

export type PreviewSourceState = '完整' | '部分覆盖';

export type PreviewMetric = {
  title: string;
  metricKey?: string;
  current: string | null;
  previous: string | null;
  change: string | null;
  tone: 'good' | 'bad' | 'neutral';
  info: string;
  missingReason?: string;
};

export type PreviewTrendPoint = {
  slot: number;
  date: string;
  current: number;
  previous: number | null;
};

export type PreviewTrend = {
  key: 'adCost' | 'siteVisits';
  label: string;
  source: string;
  unit: string;
  currentTotal: string;
  previousTotal: string;
  change: string;
  points: PreviewTrendPoint[];
};

export const MARKETING_AI_REPORT_PREVIEW = Object.freeze({
  sourceSystem: 'FRONTEND_PREVIEW_ONLY',
  reportId: 'preview-2026-08-04',
  title: '营销表现月度分析',
  currentPeriod: '2026-07-05 至 2026-08-03',
  previousPeriod: '2026-06-05 至 2026-07-04',
  generatedAt: '2026-08-04 10:30',
  summary: '本期百度推广的点击获取效率改善，网站访问规模小幅回落；官网表单上一周期覆盖不完整，因此只展示本期数量，不计算跨期变化。建议先核查高消费计划的搜索词质量，再确认访问回落集中在哪些入口页。',
  sources: [
    {
      key: 'baiduAds',
      label: '百度推广',
      state: '完整' as PreviewSourceState,
      currentCoverage: '30 / 30 天',
      previousCoverage: '30 / 30 天',
      note: '计划、单元、关键词、搜索词四份报告完整'
    },
    {
      key: 'baiduTongji',
      label: '百度统计',
      state: '完整' as PreviewSourceState,
      currentCoverage: '30 / 30 天',
      previousCoverage: '30 / 30 天',
      note: '访问、UV、PV 与来源趋势完整'
    },
    {
      key: 'websiteForms',
      label: '官网表单',
      state: '部分覆盖' as PreviewSourceState,
      currentCoverage: '30 / 30 天',
      previousCoverage: '24 / 30 天',
      note: '上一周期缺少 6 天，不计算周期变化'
    }
  ],
  metrics: [
    {
      title: '广告投入',
      current: '¥128,600',
      previous: '¥137,900',
      change: '下降 6.7%',
      tone: 'good' as const,
      info: '百度推广消费；下降通常表示投入减少，但仍需结合点击与业务目标判断。'
    },
    {
      title: '广告点击',
      current: '16,420',
      previous: '15,880',
      change: '上升 3.4%',
      tone: 'good' as const,
      info: '百度推广有效点击总数。'
    },
    {
      title: '网站访问',
      current: '12,860',
      previous: '13,240',
      change: '下降 2.9%',
      tone: 'neutral' as const,
      info: '百度统计访问次数，与广告点击是不同来源事实。'
    },
    {
      title: '官网表单咨询',
      current: '86',
      previous: null,
      change: null,
      tone: 'neutral' as const,
      info: '官网可归因成功表单提交会话，不包含 53KF 在线咨询。',
      missingReason: '上一周期只覆盖 24 / 30 天，无法比较。'
    }
  ] satisfies PreviewMetric[],
  insights: [
    {
      id: 'paid-efficiency',
      source: '百度推广',
      title: '点击获取效率改善',
      fact: '广告投入下降 6.7%，点击增加 3.4%，平均 CPC 从 ¥8.68 降至 ¥7.83。',
      interpretation: '同一广告来源内，点击规模增长而单位点击成本下降，说明本期流量采购效率优于上一周期。',
      evidence: '消费、点击、平均 CPC · 本期对比等长上一周期'
    },
    {
      id: 'traffic-softness',
      source: '百度统计',
      title: '网站访问规模小幅回落',
      fact: '网站访问从 13,240 次降至 12,860 次，下降 2.9%；UV 同期下降 2.1%。',
      interpretation: '回落幅度有限，建议继续按来源和入口页核查，而不是直接归因于广告变化。',
      evidence: '访问、UV · 百度统计同口径周期比较'
    },
    {
      id: 'form-coverage',
      source: '官网表单',
      title: '咨询变化暂不可判断',
      fact: '本期记录 86 次官网表单咨询；上一周期仅覆盖 24 / 30 天。',
      interpretation: '现有覆盖不足以支持周期变化结论，本报告不补零，也不外推缺失 6 天。',
      evidence: '表单咨询 · 数据覆盖状态'
    }
  ],
  actions: [
    {
      priority: '优先',
      title: '核查高消费计划的搜索词质量',
      description: '从消费排名靠前的计划开始，排除与业务意图偏离的搜索词，并保留调整前后的独立观察周期。'
    },
    {
      priority: '其次',
      title: '定位访问回落的来源与入口页',
      description: '分别查看来源和入口页变化，确认回落是否集中在少数页面；当前证据不能证明广告变化导致访问回落。'
    },
    {
      priority: '补数',
      title: '补齐官网表单上一周期覆盖',
      description: '先确认缺失日期能否重新读取；覆盖完整前不计算咨询变化或跨来源转化率。'
    }
  ],
  trends: [
    {
      key: 'adCost',
      label: '百度推广 · 广告投入',
      source: '百度推广',
      unit: '元',
      currentTotal: '¥128,600',
      previousTotal: '¥137,900',
      change: '下降 6.7%',
      points: [
        { slot: 0, date: '07-05', current: 21100, previous: 22900 },
        { slot: 1, date: '07-10', current: 22500, previous: 23700 },
        { slot: 2, date: '07-15', current: 20400, previous: 22600 },
        { slot: 3, date: '07-20', current: 21900, previous: 23100 },
        { slot: 4, date: '07-25', current: 20700, previous: 22100 },
        { slot: 5, date: '07-30', current: 22000, previous: 23500 }
      ]
    },
    {
      key: 'siteVisits',
      label: '百度统计 · 网站访问',
      source: '百度统计',
      unit: '次',
      currentTotal: '12,860',
      previousTotal: '13,240',
      change: '下降 2.9%',
      points: [
        { slot: 0, date: '07-05', current: 2080, previous: 2150 },
        { slot: 1, date: '07-10', current: 2190, previous: 2200 },
        { slot: 2, date: '07-15', current: 2050, previous: 2140 },
        { slot: 3, date: '07-20', current: 2230, previous: 2290 },
        { slot: 4, date: '07-25', current: 2090, previous: 2170 },
        { slot: 5, date: '07-30', current: 2220, previous: 2290 }
      ]
    }
  ] satisfies PreviewTrend[],
  limitations: [
    '所有数字均为前端展示样例，不来自生产来源，也没有写入数据库。',
    '官网表单上一周期覆盖不完整，因此不展示周期变化。',
    '53KF 在线客服、线索入池和订单尚未纳入首版示例报告。',
    '跨来源同期变化只用于提出待验证问题，不构成因果归因。'
  ]
});

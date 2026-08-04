export const MARKETING_SOURCE_LABELS = Object.freeze({
  BAIDU_PAID: '百度推广',
  DIRECT: '直接访问',
  BAIDU_SEARCH: '百度自然搜索',
  BING_SEARCH: '必应自然搜索',
  GOOGLE_SEARCH: 'Google 自然搜索',
  OTHER_SEARCH: '其他搜索引擎',
  EXTERNAL_REFERRAL: '外部网站引荐',
  UTM_CAMPAIGN: 'UTM 推广',
  UNKNOWN: '未知来源'
});

export type MarketingSourceKey = keyof typeof MARKETING_SOURCE_LABELS;

export const MARKETING_SOURCE_KEYS = new Set<MarketingSourceKey>(
  Object.keys(MARKETING_SOURCE_LABELS) as MarketingSourceKey[]
);

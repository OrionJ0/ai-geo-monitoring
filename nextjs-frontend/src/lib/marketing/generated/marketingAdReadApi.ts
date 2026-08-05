/* 本文件由 goodieai-marketing-ad-read.openapi.json 自动生成；请勿手改。 */

export type MarketingExactMetrics = {
  impressions: string;
  clicks: string;
  costAmountScaled: string;
};
export type MarketingDailyMetrics = {
  date: string;
  impressions: string;
  clicks: string;
  costAmountScaled: string;
};
export type MarketingCoverage = {
  from: string;
  to: string;
  lastSuccessfulAt: string;
  currency: string;
  costScale: number;
};
export type MarketingDateFilter = {
  from: string;
  to: string;
};
export type MarketingDashboardStates = {
  moduleState: string;
  projectState: "ACTIVE" | "ARCHIVED";
  sourceSummaryState: "NOT_CONNECTED" | "ACTION_REQUIRED" | "DISCONNECTED" | "CONNECTED";
  bindingSummaryState: "NONE" | "BLOCKED" | "ACTIVE";
  snapshotContentState: "NONE" | "ZERO" | "DATA";
  snapshotFreshnessState: "NA" | "FRESH" | "STALE";
  refreshState: string;
};
export type MarketingBinding = {
  bindingId: string;
  accountId: string;
  accountName: string;
  sourceState: string;
  bindingState: string;
  blockingCode: string | null;
};
export type MarketingHierarchyCounts = {
  campaigns: number;
  adGroups: number;
  keywords: number;
  searchTerms: number;
};
export type MarketingActiveRun = {
  runId: string;
  status: string;
};
export type MarketingLastRun = {
  runId: string;
  status: string;
  failureCode: string | null;
};
export type MarketingDashboardResponse = {
  schemaVersion: "marketing_dashboard_v2";
  projectId: string;
  projectName: string;
  revision: string | null;
  states: MarketingDashboardStates;
  bindings: Array<MarketingBinding>;
  coverage: MarketingCoverage | null;
  filter: MarketingDateFilter | null;
  summary: MarketingExactMetrics;
  trend: Array<MarketingDailyMetrics>;
  hierarchyCounts: MarketingHierarchyCounts;
  activeRun: MarketingActiveRun | null;
  lastRun: MarketingLastRun | null;
};
export type MarketingAdCampaign = {
  accountId: string;
  campaignId: string;
  campaignName: string;
  impressions: string;
  clicks: string;
  costAmountScaled: string;
  trend: Array<MarketingDailyMetrics>;
};
export type MarketingAdGroup = {
  accountId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  impressions: string;
  clicks: string;
  costAmountScaled: string;
  trend: Array<MarketingDailyMetrics>;
};
export type MarketingAdKeyword = {
  accountId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  keywordId: string;
  keywordName: string;
  targetingType: "KEYWORD" | "WORD_PACKAGE" | "AUTO_EXPANSION";
  impressions: string;
  clicks: string;
  costAmountScaled: string;
  trend: Array<MarketingDailyMetrics>;
};
export type MarketingAdSearchTerm = {
  accountId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  keywordName: string;
  searchTerm: string;
  queryStatus: "ADDED" | "NOT_ADDED" | "NOT_ADDABLE";
  matchType: string;
  impressions: string;
  clicks: string;
  costAmountScaled: string;
  trend: Array<MarketingDailyMetrics>;
};
export type MarketingAdHierarchyCounts = {
  campaigns: number;
  adGroups: number;
  keywords: number;
};
export type MarketingAdHierarchyResponse = {
  schemaVersion: "marketing_ad_hierarchy_v1";
  projectId: string;
  revision: string;
  coverage: MarketingCoverage;
  filter: MarketingDateFilter;
  summary: MarketingExactMetrics;
  campaigns: Array<MarketingAdCampaign>;
  adGroups: Array<MarketingAdGroup>;
  keywords: Array<MarketingAdKeyword>;
  hierarchyCounts: MarketingAdHierarchyCounts;
};
export type MarketingPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};
export type MarketingKeywordResponse = {
  schemaVersion: "marketing_keywords_v1";
  projectId: string;
  revision: string;
  coverage: MarketingCoverage;
  filter: MarketingDateFilter;
  summary: MarketingExactMetrics;
  items: Array<MarketingAdKeyword>;
  pagination: MarketingPagination;
};
export type MarketingSearchTermResponse = {
  schemaVersion: "marketing_search_terms_v1";
  projectId: string;
  revision: string;
  coverage: MarketingCoverage;
  filter: MarketingDateFilter;
  summary: MarketingExactMetrics;
  items: Array<MarketingAdSearchTerm>;
  pagination: MarketingPagination;
};
export type MarketingError = {
  code: "MARKETING_REVISION_REQUIRED" | "MARKETING_AD_RESOURCE_QUERY_INVALID" | "MARKETING_PROJECT_NOT_ALLOWED" | "PROJECT_FORBIDDEN" | "PROJECT_NOT_FOUND" | "MARKETING_REVISION_NOT_FOUND" | "MARKETING_SNAPSHOT_UNAVAILABLE" | "DASHBOARD_DATE_OUT_OF_RANGE" | "MARKETING_AD_RESOURCE_FAILED" | "MARKETING_DASHBOARD_FAILED";
  message: string;
};
export type MarketingErrorResponse = {
  error: MarketingError;
};

function exactNonNegativeInteger(value) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return '0';
  return BigInt(value).toString();
}

function identity(parts) {
  return parts.map((part) => String(part || '')).join('\u0000');
}

function keywordEvidenceKey(row) {
  return identity([
    row?.accountId,
    row?.campaignId,
    row?.adGroupId,
    row?.keywordName
  ]);
}

function searchTermEntityKey(row) {
  return identity([
    row?.accountId,
    row?.campaignId,
    row?.adGroupId,
    row?.keywordName,
    row?.searchTerm,
    row?.queryStatus,
    row?.matchType
  ]);
}

function sameMarketingDashboardRevision(currentRevision, previousRevision) {
  return typeof currentRevision === 'string'
    && currentRevision.length > 0
    && currentRevision === previousRevision;
}

function dashboardFilterMatchesRange(dashboard, range) {
  return dashboard?.filter?.from === range?.from
    && dashboard?.filter?.to === range?.to;
}

function finiteRatio(numerator, denominator, precision = 1_000_000n) {
  if (denominator === 0n) return null;
  const value = Number((numerator * precision) / denominator) / Number(precision);
  return Number.isFinite(value) ? value : null;
}

function buildAdSearchTermRows(searchTerms, costScale = 2) {
  const scale = 10n ** BigInt(costScale);
  return (searchTerms || []).map((row) => {
    const costAmountScaled = exactNonNegativeInteger(row.costAmountScaled);
    const impressions = exactNonNegativeInteger(row.impressions);
    const clicks = exactNonNegativeInteger(row.clicks);
    const impressionCount = BigInt(impressions);
    const clickCount = BigInt(clicks);
    return {
      key: searchTermEntityKey(row),
      accountId: String(row.accountId || ''),
      campaignId: String(row.campaignId || ''),
      campaignName: String(row.campaignName || '—'),
      adGroupId: String(row.adGroupId || ''),
      adGroupName: String(row.adGroupName || '—'),
      keywordName: String(row.keywordName || '—'),
      searchTerm: String(row.searchTerm || '—'),
      queryStatus: row.queryStatus,
      matchType: String(row.matchType || '—'),
      costAmountScaled,
      impressions,
      clicks,
      ctrPercent: finiteRatio(clickCount * 100n, impressionCount),
      averageCpc: finiteRatio(BigInt(costAmountScaled), clickCount * scale)
    };
  });
}

function buildAdSearchTermSummary(rows) {
  return (rows || []).reduce((summary, row) => ({
    searchTermCount: (BigInt(summary.searchTermCount) + 1n).toString(),
    costAmountScaled: (
      BigInt(summary.costAmountScaled)
      + BigInt(exactNonNegativeInteger(row.costAmountScaled))
    ).toString(),
    impressions: (
      BigInt(summary.impressions)
      + BigInt(exactNonNegativeInteger(row.impressions))
    ).toString(),
    clicks: (
      BigInt(summary.clicks)
      + BigInt(exactNonNegativeInteger(row.clicks))
    ).toString()
  }), {
    searchTermCount: '0',
    costAmountScaled: '0',
    impressions: '0',
    clicks: '0'
  });
}

function formatExactPercentChange(current, previous) {
  const currentValue = BigInt(exactNonNegativeInteger(current));
  const previousValue = BigInt(exactNonNegativeInteger(previous));
  if (previousValue === 0n) return null;
  const tenths = ((currentValue - previousValue) * 1000n) / previousValue;
  const absolute = tenths < 0n ? -tenths : tenths;
  const sign = tenths > 0n ? '+' : tenths < 0n ? '-' : '';
  return `${sign}${absolute / 10n}.${absolute % 10n}%`;
}

function filterAdSearchTermRows(rows, filters = {}) {
  const query = String(filters.query || '').trim().toLocaleLowerCase('zh-CN');
  return (rows || []).filter((row) => {
    if (
      filters.keywordEvidence
      && filters.keywordEvidence !== 'all'
      && keywordEvidenceKey(row) !== filters.keywordEvidence
    ) return false;
    if (
      filters.adGroupId
      && filters.adGroupId !== 'all'
      && row.adGroupId !== filters.adGroupId
    ) return false;
    if (
      filters.queryStatus
      && filters.queryStatus !== 'all'
      && row.queryStatus !== filters.queryStatus
    ) return false;
    if (
      filters.matchType
      && filters.matchType !== 'all'
      && row.matchType !== filters.matchType
    ) return false;
    if (!query) return true;
    return row.searchTerm.toLocaleLowerCase('zh-CN').includes(query);
  });
}

function resolveAdKeywordScope(keywords, accountId, keywordId) {
  if (!accountId || !keywordId) return null;
  return (keywords || []).find((keyword) => (
    keyword.accountId === accountId && keyword.keywordId === keywordId
  )) || null;
}

module.exports = {
  buildAdSearchTermRows,
  buildAdSearchTermSummary,
  dashboardFilterMatchesRange,
  filterAdSearchTermRows,
  formatExactPercentChange,
  keywordEvidenceKey,
  resolveAdKeywordScope,
  sameMarketingDashboardRevision,
  searchTermEntityKey
};

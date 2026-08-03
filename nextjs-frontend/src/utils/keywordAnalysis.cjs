const KEYWORD_TAGS = Object.freeze([
  '优先加投',
  '稳健保持',
  '控制浪费',
  '样本不足'
]);

function exactNonNegativeInteger(value) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return '0';
  return BigInt(value).toString();
}

function keywordEntityKey(fact) {
  const accountId = String(fact?.accountId || '');
  const unitId = String(fact?.unitId || '');
  const keywordId = String(fact?.keywordId || '');
  if (accountId && unitId && keywordId) {
    return [accountId, unitId, keywordId].join('\u0000');
  }
  return [
    accountId,
    unitId,
    String(fact?.keyword || '')
  ].join('\u0000');
}

function finiteRatio(numerator, denominator, precision = 1_000_000) {
  if (denominator === 0n) return null;
  const scaled = (numerator * BigInt(precision)) / denominator;
  const result = Number(scaled) / precision;
  return Number.isFinite(result) ? result : null;
}

function explicitKeywordTagStrategy(fact) {
  return KEYWORD_TAGS.includes(fact?.tag) ? fact.tag : null;
}

function aggregateKeywordFacts(facts, options) {
  const {
    from,
    to,
    costScale = 2,
    tagStrategy = explicitKeywordTagStrategy
  } = options || {};
  const groups = new Map();
  for (const fact of facts || []) {
    if (!fact || typeof fact.date !== 'string') continue;
    if ((from && fact.date < from) || (to && fact.date > to)) continue;
    const key = keywordEntityKey(fact);
    const current = groups.get(key);
    if (!current) {
      const tag = typeof tagStrategy === 'function'
        ? tagStrategy(fact)
        : null;
      groups.set(key, {
        key,
        accountId: String(fact.accountId || ''),
        accountName: String(fact.accountName || '—'),
        projectId: String(fact.projectId || ''),
        projectName: String(fact.projectName || '—'),
        schemeId: String(fact.schemeId || ''),
        schemeName: String(fact.schemeName || '—'),
        unitId: String(fact.unitId || ''),
        unitName: String(fact.unitName || '—'),
        keywordId: String(fact.keywordId || ''),
        keyword: String(fact.keyword || '—'),
        tag: KEYWORD_TAGS.includes(tag) ? tag : null,
        costAmountScaled: exactNonNegativeInteger(fact.costAmountScaled),
        impressions: exactNonNegativeInteger(fact.impressions),
        clicks: exactNonNegativeInteger(fact.clicks)
      });
      continue;
    }
    current.costAmountScaled = (
      BigInt(current.costAmountScaled)
      + BigInt(exactNonNegativeInteger(fact.costAmountScaled))
    ).toString();
    current.impressions = (
      BigInt(current.impressions)
      + BigInt(exactNonNegativeInteger(fact.impressions))
    ).toString();
    current.clicks = (
      BigInt(current.clicks)
      + BigInt(exactNonNegativeInteger(fact.clicks))
    ).toString();
    if (!current.tag && typeof tagStrategy === 'function') {
      const tag = tagStrategy(fact);
      current.tag = KEYWORD_TAGS.includes(tag) ? tag : null;
    }
  }

  const scale = 10n ** BigInt(costScale);
  return [...groups.values()].map((row) => {
    const impressions = BigInt(row.impressions);
    const clicks = BigInt(row.clicks);
    const ctrPercent = finiteRatio(clicks * 100n, impressions);
    const averageCpc = finiteRatio(
      BigInt(row.costAmountScaled),
      clicks * scale
    );
    return {
      ...row,
      ctrPercent,
      averageCpc,
      path: [row.projectName, row.schemeName, row.unitName].join(' / ')
    };
  });
}

function buildKeywordCoverage(rows) {
  const impressionKeywordCount = (rows || []).filter(
    (row) => BigInt(exactNonNegativeInteger(row.impressions)) > 0n
  ).length;
  const clickedKeywordCount = (rows || []).filter(
    (row) => BigInt(exactNonNegativeInteger(row.clicks)) > 0n
  ).length;
  return {
    impressionKeywordCount,
    clickedKeywordCount,
    clickCoverageRate: impressionKeywordCount
      ? clickedKeywordCount / impressionKeywordCount
      : null,
    unclickedKeywordCount: Math.max(
      impressionKeywordCount - clickedKeywordCount,
      0
    )
  };
}

function median(values) {
  const finiteValues = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finiteValues.length) return null;
  const middle = Math.floor(finiteValues.length / 2);
  return finiteValues.length % 2
    ? finiteValues[middle]
    : (finiteValues[middle - 1] + finiteValues[middle]) / 2;
}

function buildKeywordScatter(rows) {
  const points = (rows || []).flatMap((row) => {
    const clicks = BigInt(exactNonNegativeInteger(row.clicks));
    const impressions = BigInt(exactNonNegativeInteger(row.impressions));
    if (
      clicks === 0n
      || impressions === 0n
      || !Number.isFinite(row.ctrPercent)
      || !Number.isFinite(row.averageCpc)
    ) return [];
    const clickCount = Number(clicks);
    if (!Number.isFinite(clickCount)) return [];
    return [{
      key: row.key,
      keyword: row.keyword,
      tag: row.tag,
      path: row.path,
      costAmountScaled: row.costAmountScaled,
      impressions: row.impressions,
      clicks: clickCount,
      ctrPercent: row.ctrPercent,
      averageCpc: row.averageCpc
    }];
  });
  return {
    points,
    medianCtrPercent: median(points.map((point) => point.ctrPercent)),
    medianAverageCpc: median(points.map((point) => point.averageCpc))
  };
}

function buildKeywordActionDistribution(rows) {
  const clickedRows = (rows || []).filter(
    (row) => BigInt(exactNonNegativeInteger(row.clicks)) > 0n
  );
  const counts = new Map(KEYWORD_TAGS.map((tag) => [tag, 0]));
  let unclassifiedCount = 0;
  for (const row of clickedRows) {
    if (KEYWORD_TAGS.includes(row.tag)) {
      counts.set(row.tag, (counts.get(row.tag) || 0) + 1);
    } else {
      unclassifiedCount += 1;
    }
  }
  const items = KEYWORD_TAGS.map((tag) => ({
    tag,
    count: counts.get(tag) || 0
  }));
  return {
    items,
    taggedTotal: items.reduce((total, item) => total + item.count, 0),
    unclassifiedCount,
    total: clickedRows.length
  };
}

function buildKeywordAverageBenchmark(rows, costScale = 2) {
  const totals = (rows || []).reduce((current, row) => ({
    impressions: current.impressions
      + BigInt(exactNonNegativeInteger(row.impressions)),
    clicks: current.clicks + BigInt(exactNonNegativeInteger(row.clicks)),
    cost: current.cost + BigInt(exactNonNegativeInteger(row.costAmountScaled))
  }), { impressions: 0n, clicks: 0n, cost: 0n });
  const scale = 10n ** BigInt(costScale);
  return {
    ctrPercent: finiteRatio(totals.clicks * 100n, totals.impressions),
    averageCpc: finiteRatio(totals.cost, totals.clicks * scale)
  };
}

function filterKeywordRows(rows, filters = {}) {
  const search = String(filters.search || '').trim().toLocaleLowerCase('zh-CN');
  const costScale = Number.isInteger(filters.costScale) ? filters.costScale : 2;
  const costUnit = 10n ** BigInt(costScale);
  return (rows || []).filter((row) => {
    const impressions = BigInt(exactNonNegativeInteger(row.impressions));
    const clicks = BigInt(exactNonNegativeInteger(row.clicks));
    const cost = BigInt(exactNonNegativeInteger(row.costAmountScaled));
    if (filters.stage === 'impressions' && impressions === 0n) return false;
    if (filters.stage === 'clicked' && clicks === 0n) return false;
    if (
      filters.stage === 'unclicked'
      && (impressions === 0n || clicks > 0n)
    ) return false;
    if (filters.tag && filters.tag !== 'all' && row.tag !== filters.tag) {
      return false;
    }
    if (
      filters.unitId
      && filters.unitId !== 'all'
      && row.unitId !== filters.unitId
    ) return false;
    if (filters.costRange && filters.costRange !== 'all') {
      const tenThousand = 10_000n * costUnit;
      const fiftyThousand = 50_000n * costUnit;
      if (filters.costRange === 'zero' && cost !== 0n) return false;
      if (
        filters.costRange === 'under-10000'
        && (cost === 0n || cost >= tenThousand)
      ) return false;
      if (
        filters.costRange === '10000-50000'
        && (cost < tenThousand || cost >= fiftyThousand)
      ) return false;
      if (filters.costRange === 'over-50000' && cost < fiftyThousand) {
        return false;
      }
    }
    if (filters.anomaly && filters.anomaly !== 'all') {
      const benchmarkCtr = filters.benchmarkCtrPercent;
      const benchmarkCpc = filters.benchmarkAverageCpc;
      if (
        !Number.isFinite(row.ctrPercent)
        || !Number.isFinite(row.averageCpc)
        || !Number.isFinite(benchmarkCtr)
        || !Number.isFinite(benchmarkCpc)
      ) return false;
      const highCtr = row.ctrPercent >= benchmarkCtr;
      const highCpc = row.averageCpc >= benchmarkCpc;
      if (filters.anomaly === 'high-ctr-low-cpc' && (!highCtr || highCpc)) {
        return false;
      }
      if (filters.anomaly === 'low-ctr-high-cpc' && (highCtr || !highCpc)) {
        return false;
      }
      if (filters.anomaly === 'high-ctr-high-cpc' && (!highCtr || !highCpc)) {
        return false;
      }
      if (filters.anomaly === 'low-ctr-low-cpc' && (highCtr || highCpc)) {
        return false;
      }
    }
    if (filters.more === 'with-cost' && cost === 0n) return false;
    if (
      filters.more === 'plottable'
      && (
        clicks === 0n
        || impressions === 0n
        || !Number.isFinite(row.averageCpc)
      )
    ) return false;
    if (filters.key && row.key !== filters.key) return false;
    if (!search) return true;
    return [
      row.keyword,
      row.keywordId
    ].some((value) => String(value).toLocaleLowerCase('zh-CN').includes(search));
  });
}

module.exports = {
  KEYWORD_TAGS,
  aggregateKeywordFacts,
  buildKeywordActionDistribution,
  buildKeywordAverageBenchmark,
  buildKeywordCoverage,
  buildKeywordScatter,
  explicitKeywordTagStrategy,
  filterKeywordRows,
  keywordEntityKey,
  median
};

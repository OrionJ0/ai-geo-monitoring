const SOURCE_ORDER = Object.freeze([
  'BAIDU_PAID',
  'ORGANIC_SEARCH',
  'DIRECT',
  'UNKNOWN',
  'PENDING'
]);

const SOURCE_LABELS = Object.freeze({
  BAIDU_PAID: '百度推广',
  ORGANIC_SEARCH: '搜索引擎',
  DIRECT: '直接访问',
  UNKNOWN: '来源未知',
  PENDING: '待关联'
});

function addDays(date, offset) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function daysInclusive(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  return Math.floor((end - start) / 86400000) + 1;
}

function sourceCategory(order) {
  if (order.attributionStatus === 'PENDING') return 'PENDING';
  if (order.attributionStatus === 'SOURCE_UNKNOWN') return 'UNKNOWN';
  return order.sourceKey || 'PENDING';
}

function matchesNonDateFilters(order, filters) {
  const category = sourceCategory(order);
  if (filters.source && filters.source !== 'ALL' && category !== filters.source) {
    return false;
  }
  if (
    filters.status
    && filters.status !== 'ALL'
    && order.attributionStatus !== filters.status
  ) return false;
  const query = String(filters.query || '').trim().toLocaleLowerCase('zh-CN');
  if (!query) return true;
  return [order.orderNumber, order.projectName, order.customerName]
    .some((value) => String(value).toLocaleLowerCase('zh-CN').includes(query));
}

function filterOrders(orders, filters) {
  return orders.filter((order) => (
    order.signedDate >= filters.from
    && order.signedDate <= filters.to
    && matchesNonDateFilters(order, filters)
  ));
}

function compareValues(left, right, sortKey) {
  if (sortKey === 'signedAmountYuan') {
    const a = BigInt(left.signedAmountYuan);
    const b = BigInt(right.signedAmountYuan);
    return a === b ? 0 : a > b ? 1 : -1;
  }
  if (sortKey === 'source') {
    return SOURCE_ORDER.indexOf(sourceCategory(left))
      - SOURCE_ORDER.indexOf(sourceCategory(right));
  }
  if (sortKey === 'attributionStatus') {
    return ['TRUSTED', 'SOURCE_UNKNOWN', 'PENDING'].indexOf(left.attributionStatus)
      - ['TRUSTED', 'SOURCE_UNKNOWN', 'PENDING'].indexOf(right.attributionStatus);
  }
  const key = sortKey || 'signedDate';
  return String(left[key] || '').localeCompare(String(right[key] || ''), 'zh-CN');
}

function sortOrders(orders, sortKey = 'signedDate', sortOrder = 'desc') {
  const direction = sortOrder === 'asc' ? 1 : -1;
  return [...orders].sort((left, right) => (
    compareValues(left, right, sortKey) * direction
    || left.orderNumber.localeCompare(right.orderNumber, 'zh-CN') * -1
  ));
}

function summarizeOrders(orders) {
  const trustedCount = orders.filter(
    (order) => order.attributionStatus === 'TRUSTED'
  ).length;
  const totalCount = orders.length;
  return {
    totalCount,
    signedAmountYuan: orders.reduce(
      (total, order) => total + BigInt(order.signedAmountYuan),
      0n
    ).toString(),
    trustedCount,
    unresolvedCount: totalCount - trustedCount,
    associationRate: totalCount
      ? `${((trustedCount * 100) / totalCount).toFixed(1)}%`
      : '0.0%'
  };
}

function summarizeSources(orders) {
  const total = orders.length;
  const counts = Object.fromEntries(SOURCE_ORDER.map((key) => [key, 0]));
  orders.forEach((order) => {
    counts[sourceCategory(order)] += 1;
  });
  return SOURCE_ORDER.map((key) => ({
    key,
    label: SOURCE_LABELS[key],
    count: counts[key],
    percentage: total ? (counts[key] * 100) / total : 0,
    percentageLabel: total ? `${((counts[key] * 100) / total).toFixed(1)}%` : '0.0%'
  })).filter((entry) => entry.count > 0);
}

function buildDailySeries(orders, filters, metric) {
  const dayCount = daysInclusive(filters.from, filters.to);
  const previousTo = addDays(filters.from, -1);
  const previousFrom = addDays(previousTo, -(dayCount - 1));
  const filtered = orders.filter((order) => matchesNonDateFilters(order, filters));
  const valueForDay = (date) => filtered
    .filter((order) => order.signedDate === date)
    .reduce((total, order) => (
      metric === 'amount'
        ? total + BigInt(order.signedAmountYuan)
        : total + 1n
    ), 0n);
  const current = [];
  const previous = [];
  for (let index = 0; index < dayCount; index += 1) {
    const currentDate = addDays(filters.from, index);
    const previousDate = addDays(previousFrom, index);
    current.push({ date: currentDate, value: valueForDay(currentDate).toString() });
    previous.push({ date: previousDate, value: valueForDay(previousDate).toString() });
  }
  return { current, previous, previousFrom, previousTo };
}

function deriveOrderResultsView(orders, filters) {
  const filteredRows = filterOrders(orders, filters);
  const sortedRows = sortOrders(filteredRows, filters.sortKey, filters.sortOrder);
  const pageSize = Math.max(1, Number(filters.pageSize) || 10);
  const page = Math.max(1, Number(filters.page) || 1);
  const start = (page - 1) * pageSize;
  return {
    filteredRows,
    pageRows: sortedRows.slice(start, start + pageSize),
    summary: summarizeOrders(filteredRows),
    sourceOverview: summarizeSources(filteredRows),
    trend: buildDailySeries(orders, filters, filters.metric || 'count'),
    pagination: {
      page,
      pageSize,
      totalItems: filteredRows.length,
      totalPages: Math.ceil(filteredRows.length / pageSize)
    }
  };
}

module.exports = {
  SOURCE_LABELS,
  buildDailySeries,
  deriveOrderResultsView,
  filterOrders,
  sourceCategory,
  summarizeOrders,
  summarizeSources
};

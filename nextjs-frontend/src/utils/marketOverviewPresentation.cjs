/* eslint-disable @typescript-eslint/no-require-imports */
const { requireDecimalText } = require('./marketingValues.cjs');

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TypeError('日期必须使用 YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new TypeError('日期无效');
  }
  return date;
}

function shiftIsoDate(value, days) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDayCount(from, to) {
  const start = parseIsoDate(from).getTime();
  const end = parseIsoDate(to).getTime();
  if (start > end) throw new RangeError('日期范围顺序无效');
  return Math.floor((end - start) / DAY_MS) + 1;
}

function rowsWithin(rows, from, to) {
  return rows.filter((row) => row.date >= from && row.date <= to);
}

function buildPeriodRows(rows, from, to) {
  const days = inclusiveDayCount(from, to);
  const previousTo = shiftIsoDate(from, -1);
  const previousFrom = shiftIsoDate(previousTo, -(days - 1));
  return {
    current: rowsWithin(rows, from, to),
    previous: rowsWithin(rows, previousFrom, previousTo),
    currentFrom: from,
    currentTo: to,
    previousFrom,
    previousTo,
    days
  };
}

function powerOfTen(digits) {
  if (!Number.isInteger(digits) || digits < 0 || digits > 12) {
    throw new TypeError('精度无效');
  }
  return 10n ** BigInt(digits);
}

function roundedQuotient(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('分母必须大于零');
  return ((numerator * 2n) + denominator) / (denominator * 2n);
}

function fixedText(scaledInteger, digits) {
  const scale = powerOfTen(digits);
  const whole = scaledInteger / scale;
  if (digits === 0) return whole.toString();
  const fraction = (scaledInteger % scale).toString().padStart(digits, '0');
  return `${whole}.${fraction}`;
}

function groupedSignedDecimal(value) {
  const sign = value.startsWith('-') ? '-' : '';
  const unsigned = sign ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `${sign}${grouped}${fraction == null ? '' : `.${fraction}`}`;
}

function calculateRate(numerator, denominator, digits = 2) {
  if (numerator == null || denominator == null) return null;
  const top = BigInt(requireDecimalText(numerator));
  const bottom = BigInt(requireDecimalText(denominator));
  if (bottom === 0n) return null;
  const percentScale = 100n * powerOfTen(digits);
  const rounded = roundedQuotient(top * percentScale, bottom);
  return `${fixedText(rounded, digits)}%`;
}

function currencySymbol(currency) {
  return currency === 'CNY' ? '¥' : `${currency || ''} `;
}

function formatScaledAmount(value, scale, currency = 'CNY', digits = 2) {
  if (value == null) return null;
  const amount = BigInt(requireDecimalText(value));
  const sourceScale = powerOfTen(scale);
  const targetScale = powerOfTen(digits);
  const rounded = roundedQuotient(amount * targetScale, sourceScale);
  return `${currencySymbol(currency)}${groupedSignedDecimal(fixedText(rounded, digits))}`;
}

function divideScaledAmount(value, denominator, scale, currency = 'CNY') {
  if (value == null || denominator == null) return null;
  const amount = BigInt(requireDecimalText(value));
  const divisor = BigInt(requireDecimalText(denominator));
  if (divisor === 0n) return null;
  const cents = roundedQuotient(
    amount * 100n,
    divisor * powerOfTen(scale)
  );
  return `${currencySymbol(currency)}${groupedSignedDecimal(fixedText(cents, 2))}`;
}

function sumValues(values) {
  return values.reduce(
    (total, value) => total + BigInt(requireDecimalText(value)),
    0n
  ).toString();
}

function formatAverage(total, count, digits = 1) {
  if (!count) return null;
  const scaled = roundedQuotient(
    BigInt(requireDecimalText(total)) * powerOfTen(digits),
    BigInt(count)
  );
  return fixedText(scaled, digits);
}

function summarizeMetric(rows) {
  const normalized = rows
    .filter((row) => row.value != null)
    .map((row) => ({
      date: row.date,
      value: requireDecimalText(row.value)
    }));
  if (!normalized.length) {
    return {
      total: null,
      averageTenths: null,
      peak: null,
      coordinates: []
    };
  }
  const total = sumValues(normalized.map((row) => row.value));
  const peak = normalized.reduce((largest, row) => (
    BigInt(row.value) > BigInt(largest.value) ? row : largest
  ));
  const maximum = BigInt(peak.value);
  const coordinates = normalized.map((row) => {
    return relativeCoordinate(row.value, maximum.toString());
  });
  return {
    total,
    averageTenths: formatAverage(total, normalized.length, 1),
    peak,
    coordinates
  };
}

function relativeCoordinate(value, maximum) {
  const current = BigInt(requireDecimalText(value));
  const largest = BigInt(requireDecimalText(maximum));
  if (largest === 0n) return 0;
  const basisPoints = (current * 10000n) / largest;
  return Number(basisPoints) / 100;
}

function formatPeriodChange(current, previous, digits = 1) {
  if (current == null || previous == null) return null;
  const currentValue = BigInt(requireDecimalText(current));
  const previousValue = BigInt(requireDecimalText(previous));
  if (previousValue === 0n) return null;
  const scale = powerOfTen(digits);
  const delta = currentValue - previousValue;
  const magnitude = delta < 0n ? -delta : delta;
  const rounded = roundedQuotient(magnitude * 100n * scale, previousValue);
  const sign = delta > 0n ? '+' : delta < 0n ? '-' : '';
  return `${sign}${fixedText(rounded, digits)}%`;
}

function formatRatioChange(
  currentNumerator,
  currentDenominator,
  previousNumerator,
  previousDenominator,
  digits = 1
) {
  if (
    currentNumerator == null
    || currentDenominator == null
    || previousNumerator == null
    || previousDenominator == null
  ) return null;
  const currentTop = BigInt(requireDecimalText(currentNumerator));
  const currentBottom = BigInt(requireDecimalText(currentDenominator));
  const previousTop = BigInt(requireDecimalText(previousNumerator));
  const previousBottom = BigInt(requireDecimalText(previousDenominator));
  if (currentBottom === 0n || previousBottom === 0n || previousTop === 0n) {
    return null;
  }
  const difference = (
    (currentTop * previousBottom) - (previousTop * currentBottom)
  );
  const denominator = previousTop * currentBottom;
  const magnitude = difference < 0n ? -difference : difference;
  const rounded = roundedQuotient(
    magnitude * 100n * powerOfTen(digits),
    denominator
  );
  const sign = difference > 0n ? '+' : difference < 0n ? '-' : '';
  return `${sign}${fixedText(rounded, digits)}%`;
}

module.exports = {
  buildPeriodRows,
  calculateRate,
  divideScaledAmount,
  formatAverage,
  formatPeriodChange,
  formatRatioChange,
  formatScaledAmount,
  inclusiveDayCount,
  relativeCoordinate,
  shiftIsoDate,
  sumValues,
  summarizeMetric
};

function requireDecimalText(value) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw new TypeError('营销指标必须是十进制字符串');
  }
  return BigInt(value).toString();
}

function groupDigits(value) {
  return requireDecimalText(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

function formatScaled(value, scale, currency = 'CNY') {
  const digits = requireDecimalText(value);
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new TypeError('金额 scale 无效');
  }
  if (scale === 0) return `${currency} ${groupDigits(digits)}`;
  const padded = digits.padStart(scale + 1, '0');
  const integer = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/u, '');
  return `${currency} ${groupDigits(integer)}${fraction ? `.${fraction}` : ''}`;
}

function boundedPercent(value, maximum) {
  const current = BigInt(requireDecimalText(value));
  const max = BigInt(requireDecimalText(maximum));
  if (max === 0n) return '0%';
  const basisPoints = (current * 10000n) / max;
  const whole = basisPoints / 100n;
  const fraction = String(basisPoints % 100n).padStart(2, '0');
  return `${whole}.${fraction}%`;
}

module.exports = {
  boundedPercent,
  formatScaled,
  groupDigits,
  requireDecimalText
};

function exactValueError() {
  const error = new Error('营销精确值必须是非负十进制字符串');
  error.code = 'MARKETING_EXACT_VALUE_INVALID';
  return error;
}

function normalizeMetricText(value) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw exactValueError();
  }
  return BigInt(value).toString();
}

function addDecimalText(left, right) {
  return (
    BigInt(normalizeMetricText(left))
    + BigInt(normalizeMetricText(right))
  ).toString();
}

module.exports = {
  addDecimalText,
  normalizeMetricText
};

function formatOptionalDateTimeShort(value) {
  if (
    value === null
    || value === undefined
    || (typeof value === 'string' && value.trim() === '')
  ) {
    return '-';
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const pad = (number) => String(number).padStart(2, '0');
    return [
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      `${pad(date.getHours())}:${pad(date.getMinutes())}`
    ].join(' ');
  } catch {
    return '-';
  }
}

module.exports = {
  formatOptionalDateTimeShort
};

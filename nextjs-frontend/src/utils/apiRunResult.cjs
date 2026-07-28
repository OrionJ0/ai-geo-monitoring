function getApiRunResultData(error) {
  const data = error?.response?.data?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const hasTerminalRunCount = [
    'completed',
    'failed'
  ].some((field) => Object.prototype.hasOwnProperty.call(data, field));
  if (!hasTerminalRunCount && data.status !== 'queued') return null;
  return data;
}

module.exports = { getApiRunResultData };

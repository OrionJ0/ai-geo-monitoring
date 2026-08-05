const SENSITIVE_FIELD = /(?:access|refresh)?token|secret|auth(?:orization)?code|authorization|cookie|keyword|queryword|searchterm|winfonamestatus/iu;

function bodyShape(value, field = '') {
  if (SENSITIVE_FIELD.test(field)) return '[REDACTED]';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      items: value.length > 0 ? bodyShape(value[0]) : null
    };
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(
      ([key, entry]) => [key, bodyShape(entry, key)]
    ));
  }
  return typeof value;
}

function errorTuple(error) {
  return {
    name: error?.constructor?.name || 'Error',
    code: error?.code || null,
    status: error?.status ?? null,
    retryable: error?.retryable === true
  };
}

function createSanitizedProviderTrace({ responseFor = async () => ({}) } = {}) {
  const events = [];
  return {
    events,
    async transport(request) {
      const event = {
        type: 'request',
        method: request.method,
        path: `${new URL(request.url).origin}${new URL(request.url).pathname}`,
        bodyShape: bodyShape(request.json),
        timeoutMs: request.timeoutMs,
        maxResponseBytes: request.maxResponseBytes
      };
      try {
        const response = await responseFor(request);
        event.responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
        events.push(event);
        return response;
      } catch (error) {
        event.error = errorTuple(error);
        events.push(event);
        throw error;
      }
    },
    async wait(milliseconds) {
      events.push({ type: 'wait', milliseconds });
    },
    cancel(reason) {
      events.push({ type: 'cancel', reason });
    }
  };
}

module.exports = {
  bodyShape,
  createSanitizedProviderTrace,
  errorTuple
};

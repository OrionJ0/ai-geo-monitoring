const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CITATIONS_PER_ROLE = 100;
const CP1252_REVERSE = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]
]);

function bounded(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function repairMojibakeText(value) {
  const source = String(value || '');
  const cjkCount = (text) => (text.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) || []).length;
  if (!source || cjkCount(source) > 0) return source;
  const bytes = [];
  for (const character of source) {
    const codePoint = character.codePointAt(0);
    const mapped = codePoint <= 0xff ? codePoint : CP1252_REVERSE.get(codePoint);
    if (mapped === undefined) return source;
    bytes.push(mapped);
  }
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return source;
  }
  return cjkCount(decoded) > cjkCount(source) ? decoded : source;
}

function safeHttpUrl(value) {
  const raw = bounded(value, 2048);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
    ) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeCitation(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const url = safeHttpUrl(source.url);
  if (!url) return null;
  let domain = bounded(source.domain, 255);
  if (!domain) {
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = '';
    }
  }
  const rawTitle = repairMojibakeText(
    bounded(source.title, 500).replace(/\s+/g, ' ').trim()
  );
  const marker = rawTitle.match(/^(?:\[|【)?[-–—]?\s*(\d+)\s*(?:\]|】)?$/);
  const displayIndex = positiveInteger(source.display_index) || (marker
    ? positiveInteger(marker[1])
    : null);
  return {
    url,
    title: rawTitle && !marker ? rawTitle : domain,
    domain,
    ...(displayIndex ? { displayIndex } : {})
  };
}

function normalizeCitations(sources, role) {
  const output = [];
  const seen = new Set();
  for (const source of Array.isArray(sources) ? sources : []) {
    if (bounded(source?.source_role, 80) !== role) continue;
    const normalized = normalizeCitation(source);
    if (!normalized || seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    output.push(normalized);
    if (output.length >= MAX_CITATIONS_PER_ROLE) break;
  }
  return output;
}

function normalizeArtifact(capture, kind, label, recordId) {
  const id = bounded(capture?.artifacts?.[kind]?.id, 64).toLowerCase();
  if (!UUID_RE.test(id)) return null;
  return {
    kind,
    label,
    url: `/api/detection/record/${recordId}/web-captures/${id}`
  };
}

function buildWebCaptureEvidence(row) {
  if (!row || !['deepseek-web', 'doubao-web'].includes(row.platform)) return null;
  const capture = row.web_capture || row.result_summary?.web_capture;
  if (
    !capture
    || typeof capture !== 'object'
    || Array.isArray(capture)
    || capture.status !== 'completed'
  ) {
    return null;
  }
  const fallbackRecordId = positiveInteger(row.record_id ?? row.id);
  const recordId = positiveInteger(capture.artifact_owner_record_id) || fallbackRecordId;
  if (!recordId) return null;
  const isDoubaoStandard = row.platform === 'doubao-web'
    && bounded(capture.capture_mode?.name, 40) === 'standard';
  const artifacts = [
    normalizeArtifact(
      capture,
      'search_state',
      isDoubaoStandard ? '普通模式状态' : '联网搜索状态',
      recordId
    ),
    normalizeArtifact(capture, 'final_answer', '最终回答页面', recordId)
  ];
  if (artifacts.some((artifact) => !artifact)) return null;

  const providerCitations = row.provider_citations
    || row.resultDetail?.provider_citations
    || [];
  const explicitCitations = normalizeCitations(providerCitations, 'explicit_citation');
  const retrievalCandidates = normalizeCitations(providerCitations, 'retrieval_candidate');
  const rawSearchObserved = capture.search?.observed;
  const candidateStats = capture.search?.candidate_observation;
  const searchObserved = rawSearchObserved === true
    ? true
    : rawSearchObserved === false
      ? false
      : retrievalCandidates.length > 0
        ? true
        : null;
  return {
    recordId,
    platformName: row.platform === 'doubao-web' ? '豆包 Web' : 'DeepSeek Web',
    modelName: bounded(row.model_name, 255),
    capturedAt: bounded(capture.captured_at || capture.completed_at, 80),
    selectorVersion: bounded(capture.selector_version, 100),
    captureMode: bounded(capture.capture_mode?.name, 40),
    searchRequested: capture.search?.requested === true,
    searchObserved,
    searchEvidenceType: bounded(
      searchObserved === true && rawSearchObserved == null
        ? 'network_retrieval_candidates'
        : capture.search?.evidence_type,
      100
    ),
    explicitCitations,
    retrievalCandidates,
    candidateObservation: candidateStats
      && typeof candidateStats === 'object'
      && !Array.isArray(candidateStats)
      ? {
          observedCount: nonNegativeInteger(candidateStats.observed_count),
          acceptedCount: nonNegativeInteger(candidateStats.accepted_count),
          droppedCount: nonNegativeInteger(candidateStats.dropped_count),
          truncated: candidateStats.truncated === true
        }
      : null,
    artifacts
  };
}

module.exports = {
  buildWebCaptureEvidence
};

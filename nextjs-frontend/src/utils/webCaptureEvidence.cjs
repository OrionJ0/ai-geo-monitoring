const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CITATIONS_PER_ROLE = 100;

function bounded(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeHttpUrl(value) {
  const raw = bounded(value, 2048);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
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
  return {
    url,
    title: bounded(source.title, 500),
    domain
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
  const artifacts = [
    normalizeArtifact(capture, 'search_state', '联网搜索状态', recordId),
    normalizeArtifact(capture, 'final_answer', '最终回答页面', recordId)
  ];
  if (artifacts.some((artifact) => !artifact)) return null;

  const providerCitations = row.provider_citations
    || row.resultDetail?.provider_citations
    || [];
  return {
    recordId,
    platformName: row.platform === 'doubao-web' ? '豆包 Web' : 'DeepSeek Web',
    modelName: bounded(row.model_name, 255),
    capturedAt: bounded(capture.captured_at || capture.completed_at, 80),
    selectorVersion: bounded(capture.selector_version, 100),
    searchRequested: capture.search?.requested === true,
    searchObserved: capture.search?.observed === true,
    searchEvidenceType: bounded(capture.search?.evidence_type, 100),
    explicitCitations: normalizeCitations(providerCitations, 'explicit_citation'),
    retrievalCandidates: normalizeCitations(providerCitations, 'retrieval_candidate'),
    artifacts
  };
}

module.exports = {
  buildWebCaptureEvidence
};

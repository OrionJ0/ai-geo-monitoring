function sortedCompetitionEntities(value) {
  return (Array.isArray(value) ? value : [])
    .map((entity) => ({
      name: String(entity?.name || ''),
      relation: String(entity?.relation || ''),
      mentions: Number(entity?.mentions || 0)
    }))
    .sort((left, right) => (
      left.name.localeCompare(right.name)
      || left.relation.localeCompare(right.relation)
      || left.mentions - right.mentions
    ));
}

function metricSignature(result = {}) {
  return JSON.stringify({
    brand_mentioned: Boolean(result.brand_mentioned),
    brand_mentions: Number(result.brand_mentions || 0),
    brand_rank: Number(result.brand_rank) > 0 ? Number(result.brand_rank) : null,
    brand_recommended: Boolean(result.brand_recommended),
    sentiment: Boolean(result.brand_mentioned) ? String(result.sentiment || '') : null
  });
}

function competitionJaccard(left = {}, right = {}) {
  const leftNames = new Set(
    sortedCompetitionEntities(left.competition_entities)
      .filter((entity) => entity.relation === 'competitor')
      .map((entity) => entity.name)
  );
  const rightNames = new Set(
    sortedCompetitionEntities(right.competition_entities)
      .filter((entity) => entity.relation === 'competitor')
      .map((entity) => entity.name)
  );
  const union = new Set([...leftNames, ...rightNames]);
  if (!union.size) return 1;
  let intersection = 0;
  leftNames.forEach((name) => {
    if (rightNames.has(name)) intersection += 1;
  });
  return intersection / union.size;
}

function percentile(values, fraction) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = Math.max(0, Math.min(1, Number(fraction))) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * weight);
}

function distribution(values) {
  const normalized = values.map(Number).filter(Number.isFinite);
  return {
    count: normalized.length,
    median: percentile(normalized, 0.5),
    p95: percentile(normalized, 0.95)
  };
}

function stability(entries) {
  const bySample = new Map();
  entries.filter((entry) => entry?.ok && entry.result).forEach((entry) => {
    if (!bySample.has(entry.sample_id)) bySample.set(entry.sample_id, []);
    bySample.get(entry.sample_id).push(metricSignature(entry.result));
  });
  let pairs = 0;
  let agreements = 0;
  bySample.forEach((signatures) => {
    for (let left = 0; left < signatures.length; left += 1) {
      for (let right = left + 1; right < signatures.length; right += 1) {
        pairs += 1;
        if (signatures[left] === signatures[right]) agreements += 1;
      }
    }
  });
  return { pairs, agreements, rate: pairs ? agreements / pairs : null };
}

function competitionStability(entries) {
  const bySample = new Map();
  entries.filter((entry) => entry?.ok && entry.result).forEach((entry) => {
    if (!bySample.has(entry.sample_id)) bySample.set(entry.sample_id, []);
    bySample.get(entry.sample_id).push(entry.result);
  });
  const pairScores = [];
  bySample.forEach((results) => {
    for (let left = 0; left < results.length; left += 1) {
      for (let right = left + 1; right < results.length; right += 1) {
        pairScores.push(competitionJaccard(results[left], results[right]));
      }
    }
  });
  return distribution(pairScores);
}

function summarizeArm(entries, labels = new Map()) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const completedEntries = normalizedEntries.filter((entry) => entry?.ok && entry.result);
  let targetPresenceEvaluated = 0;
  let targetPresenceCorrect = 0;
  let targetFalsePositives = 0;
  completedEntries.forEach((entry) => {
    const label = labels.get(entry.sample_id);
    if (!label || typeof label.mentioned !== 'boolean') return;
    targetPresenceEvaluated += 1;
    const actual = Boolean(entry.result.brand_mentioned);
    if (actual === label.mentioned) targetPresenceCorrect += 1;
    if (actual && !label.mentioned) targetFalsePositives += 1;
  });
  const stable = stability(normalizedEntries);
  const competitorStable = competitionStability(normalizedEntries);
  return {
    total: normalizedEntries.length,
    completed: completedEntries.length,
    completion_rate: normalizedEntries.length
      ? completedEntries.length / normalizedEntries.length
      : null,
    target_presence_evaluated: targetPresenceEvaluated,
    target_presence_correct: targetPresenceCorrect,
    target_presence_accuracy: targetPresenceEvaluated
      ? targetPresenceCorrect / targetPresenceEvaluated
      : null,
    target_false_positives: targetFalsePositives,
    stability_pairs: stable.pairs,
    stability_agreements: stable.agreements,
    stability_rate: stable.rate,
    competition_jaccard: competitorStable,
    tokens: distribution(normalizedEntries.map((entry) => entry.total_tokens)),
    latency_ms: distribution(normalizedEntries.map((entry) => entry.duration_ms))
  };
}

module.exports = {
  competitionJaccard,
  distribution,
  metricSignature,
  percentile,
  summarizeArm
};

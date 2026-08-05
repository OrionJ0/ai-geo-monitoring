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

function precisionRecallF1({ tp = 0, fp = 0, fn = 0 } = {}) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return { precision, recall, f1 };
}

function pairwiseDiff(left = [], right = []) {
  const pairs = Math.min(left.length, right.length);
  const diffs = [];
  for (let index = 0; index < pairs; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (Number.isFinite(a) && Number.isFinite(b)) diffs.push(b - a);
  }
  return {
    paired_pairs: pairs,
    diffs,
    mean_diff: diffs.length
      ? diffs.reduce((sum, value) => sum + value, 0) / diffs.length
      : null
  };
}

/**
 * 字段级状态与阶段 2 降级率（issue 013）。
 * 只统计 analysis_structure 提供的三轨与字段状态，不评价幸存样本，
 * 明确报告 assessed 可用率、unresolved/invalid/not_applicable 分布与降级率。
 */
function fieldStatusDistribution(entries) {
  const evaluated = [];
  const targetSemanticsDistribution = {};
  const recommendationDistribution = {};
  const rankDistribution = {};
  const sentimentDistribution = {};
  const competitionDistribution = {};
  let degradedCount = 0;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.ok || !entry.result?.analysis_structure) return;
    const structure = entry.result.analysis_structure;
    const semantics = structure.target_semantics || {};
    const competition = structure.competition_analysis || {};
    evaluated.push(entry);
    targetSemanticsDistribution[semantics.status || 'unknown'] = (targetSemanticsDistribution[semantics.status || 'unknown'] || 0) + 1;
    ['recommendation', 'rank', 'sentiment'].forEach((field) => {
      const status = semantics[field]?.status || 'unknown';
      const distribution = field === 'recommendation'
        ? recommendationDistribution
        : (field === 'rank' ? rankDistribution : sentimentDistribution);
      distribution[status] = (distribution[status] || 0) + 1;
    });
    competitionDistribution[competition.status || 'unknown'] = (competitionDistribution[competition.status || 'unknown'] || 0) + 1;
    const stages = Array.isArray(structure.diagnostics?.stages) ? structure.diagnostics.stages : [];
    if (stages.some((stage) => stage?.degraded || stage?.stage === 'semantic_judge' && stage?.error_code)) {
      degradedCount += 1;
    }
  });
  // assessed 可用率 = target_semantics 总状态为 complete 的比例（三字段全已判断/不适用）
  const assessedCount = evaluated.filter((entry) => {
    const semantics = entry.result.analysis_structure.target_semantics || {};
    return semantics.status === 'complete';
  }).length;
  return {
    evaluated: evaluated.length,
    degraded_count: degradedCount,
    degradation_rate: evaluated.length ? degradedCount / evaluated.length : null,
    assessed_rate: evaluated.length ? assessedCount / evaluated.length : null,
    target_semantics_distribution: targetSemanticsDistribution,
    recommendation_distribution: recommendationDistribution,
    rank_distribution: rankDistribution,
    sentiment_distribution: sentimentDistribution,
    competition_distribution: competitionDistribution
  };
}

/**
 * 实体质量（issue 013 span-based）：先按原文 mention span 对齐预测实体与
 * truth 实体，再计分。逐字可定位但把多个品牌合成一个实体（merged）或无依据
 * 拆分（split）必须计错；canonicalization 只对 span 对齐正确的实体评估
 * 名称归一是否正确，不再因“仅名称精确匹配才进分母”而近似恒为 100%。
 * 真值缺失或未复核时 NOT_EVALUABLE。
 */
function extractPredictedEntities(result = {}) {
  const structure = result.analysis_structure;
  if (!structure || !Array.isArray(structure.entities)) return [];
  const mentionsByEntity = new Map();
  (Array.isArray(structure.mentions) ? structure.mentions : []).forEach((mention) => {
    if (!mention || !mention.entity_id) return;
    if (!mentionsByEntity.has(mention.entity_id)) mentionsByEntity.set(mention.entity_id, []);
    mentionsByEntity.get(mention.entity_id).push({
      start: Number(mention.start),
      end: Number(mention.end),
      surface_form: String(mention.surface_form || '')
    });
  });
  return structure.entities.map((entity) => ({
    name: String(entity?.name || '').trim(),
    surface_forms: (Array.isArray(entity?.surface_forms) ? entity.surface_forms : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
    mentions: mentionsByEntity.get(entity?.entity_id) || []
  })).filter((entity) => entity.name);
}

function spansOverlap(left, right) {
  return Number(left.start) < Number(right.end) && Number(right.start) < Number(left.end);
}

function alignedTruthEntities(predictedEntity, truthEntities) {
  const predictedMentions = Array.isArray(predictedEntity.mentions) ? predictedEntity.mentions : [];
  if (!predictedMentions.length) return [];
  return truthEntities.filter((truthEntity) => (
    (Array.isArray(truthEntity.mentions) ? truthEntity.mentions : []).some((truthMention) => (
      predictedMentions.some((predictedMention) => spansOverlap(predictedMention, truthMention))
    ))
  ));
}

function entityQualityStats(entries, truthBySample = new Map()) {
  const totals = { tp: 0, fp: 0, fn: 0, merged: 0, split: 0, canonical_ok: 0, canonical_evaluated: 0 };
  let evaluatedSamples = 0;
  let missingTruthSamples = 0;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.ok || !entry.result) return;
    const predicted = extractPredictedEntities(entry.result);
    const truth = truthBySample.get(entry.sample_id);
    if (!truth || truth.review_status !== 'confirmed' || !Array.isArray(truth.entities)) {
      if (predicted.length) missingTruthSamples += 1;
      return;
    }
    evaluatedSamples += 1;
    const truthEntities = truth.entities;
    const matchedTruthNames = new Set();
    const truthHitCount = new Map();
    predicted.forEach((entity) => {
      const aligned = alignedTruthEntities(entity, truthEntities);
      if (aligned.length === 0) {
        totals.fp += 1;
        return;
      }
      if (aligned.length > 1) {
        // 组合实体：一个预测实体覆盖多个真值实体 -> 计 fp，被覆盖真值计 fn
        totals.merged += 1;
        totals.fp += 1;
        return;
      }
      const truthEntity = aligned[0];
      const truthName = String(truthEntity.canonical_name || '').trim();
      matchedTruthNames.add(truthName);
      const previousHits = truthHitCount.get(truthName) || 0;
      truthHitCount.set(truthName, previousHits + 1);
      if (previousHits > 0) {
        // 无依据拆分：多个预测实体对齐同一 truth 实体 -> 后续预测计 fp
        totals.split += 1;
        totals.fp += 1;
        return;
      }
      totals.tp += 1;
      totals.canonical_evaluated += 1;
      if (String(entity.name) === truthName) totals.canonical_ok += 1;
    });
    truthEntities.forEach((truthEntity) => {
      if (!matchedTruthNames.has(String(truthEntity.canonical_name || '').trim())) totals.fn += 1;
    });
  });
  if (!evaluatedSamples) {
    return {
      status: 'NOT_EVALUABLE',
      evaluated_samples: 0,
      reason: missingTruthSamples
        ? `缺少已复核实体真值（${missingTruthSamples} 个样本有输出但无 confirmed 真值）`
        : '无成功结果'
    };
  }
  const precision = totals.tp + totals.fp > 0 ? totals.tp / (totals.tp + totals.fp) : null;
  const recall = totals.tp + totals.fn > 0 ? totals.tp / (totals.tp + totals.fn) : null;
  const microF1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return {
    status: 'EVALUATED',
    evaluated_samples: evaluatedSamples,
    tp: totals.tp,
    fp: totals.fp,
    fn: totals.fn,
    precision,
    recall,
    micro_f1: microF1,
    canonicalization_accuracy: totals.canonical_evaluated
      ? totals.canonical_ok / totals.canonical_evaluated
      : null,
    merged_entity_count: totals.merged,
    split_entity_count: totals.split
  };
}

/**
 * 已输出竞品关系真实计分（issue 013 P0 修复）：预测关系（entity_id -> relation）
 * 与 truth relations 计算 TP/FP/FN 与 micro precision/recall/F1。
 * 覆盖样本数达标不等于关系正确；关系全错时 precision 必须为 0，不能 PASS。
 */
function relationQualityStats(entries, truthBySample = new Map()) {
  const totals = { tp: 0, fp: 0, fn: 0 };
  let evaluatedSamples = 0;
  let missingTruthSamples = 0;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.ok || !entry.result) return;
    const structure = entry.result.analysis_structure;
    const truth = truthBySample.get(entry.sample_id);
    if (!truth || truth.review_status !== 'confirmed' || !Array.isArray(truth.relations)) {
      if (structure) missingTruthSamples += 1;
      return;
    }
    if (!structure || !Array.isArray(structure.entities) || !Array.isArray(structure.competitor_relations)) {
      return;
    }
    evaluatedSamples += 1;
    const nameById = new Map(structure.entities.map((entity) => [
      entity.entity_id,
      String(entity?.name || '').trim()
    ]));
    const predicted = new Set(structure.competitor_relations
      .map((relation) => {
        const name = nameById.get(relation.entity_id);
        return name ? `${name}::${relation.relation}` : null;
      })
      .filter(Boolean));
    const expected = new Set((Array.isArray(truth.relations) ? truth.relations : [])
      .map((relation) => `${String(relation.canonical_name || '').trim()}::${relation.relation}`)
      .filter(Boolean));
    predicted.forEach((key) => {
      if (expected.has(key)) totals.tp += 1;
      else totals.fp += 1;
    });
    expected.forEach((key) => {
      if (!predicted.has(key)) totals.fn += 1;
    });
  });
  if (!evaluatedSamples) {
    return {
      status: 'NOT_EVALUABLE',
      evaluated_samples: 0,
      reason: missingTruthSamples ? '缺少已复核关系真值' : '无成功结果'
    };
  }
  const precision = totals.tp + totals.fp > 0 ? totals.tp / (totals.tp + totals.fp) : null;
  const recall = totals.tp + totals.fn > 0 ? totals.tp / (totals.tp + totals.fn) : null;
  const microF1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return {
    status: 'EVALUATED',
    evaluated_samples: evaluatedSamples,
    tp: totals.tp,
    fp: totals.fp,
    fn: totals.fn,
    precision,
    recall,
    micro_f1: microF1
  };
}

function answerSha256(text) {
  return require('node:crypto').createHash('sha256').update(String(text || '')).digest('hex');
}

/**
 * truth schema v3 严格校验（issue 013 P1 修复）：缺字段、哈希不匹配、
 * 重复 canonical_name、relation 引用悬空、span 与原文不一致、
 * 未在冻结语料中的 sample_id 均返回错误；调用方必须 fail-closed。
 */
function validateTruthEntry(entry, sampleById = new Map()) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return ['truth 条目必须是对象'];
  }
  if (!String(entry.sample_id || '').trim()) errors.push('缺少 sample_id');
  if (!['confirmed', 'pending_review'].includes(entry.review_status)) {
    errors.push(`review_status 无效: ${String(entry.review_status)}`);
  }
  if (entry.review_status === 'confirmed') {
    if (!String(entry.reviewer || '').trim()) errors.push('confirmed 必须记录 reviewer');
    if (!String(entry.reviewed_at || '').trim()) errors.push('confirmed 必须记录 reviewed_at');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(entry.answer_sha256 || ''))) {
    errors.push('answer_sha256 必须是 64 位 hex');
  }
  const sample = entry.sample_id ? sampleById.get(entry.sample_id) : undefined;
  if (!sample) {
    errors.push(`sample_id 未在冻结语料中: ${entry.sample_id}`);
  } else if (answerSha256(sample.response_text) !== String(entry.answer_sha256 || '').toLowerCase()) {
    errors.push(`answer_sha256 与冻结回答不一致: ${entry.sample_id}`);
  }
  if (!Array.isArray(entry.entities)) {
    errors.push('entities 必须是数组');
  } else {
    const names = new Set();
    entry.entities.forEach((entity, index) => {
      const field = `entities[${index}]`;
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        errors.push(`${field} 必须是对象`);
        return;
      }
      const name = String(entity.canonical_name || '').trim();
      if (!name) errors.push(`${field}.canonical_name 缺失`);
      else if (names.has(name)) errors.push(`${field}.canonical_name 重复: ${name}`);
      names.add(name);
      if (!Array.isArray(entity.surface_forms) || !entity.surface_forms.length) {
        errors.push(`${field}.surface_forms 必须非空`);
      }
      if (!Array.isArray(entity.mentions)) {
        errors.push(`${field}.mentions 必须是数组`);
      } else {
        entity.mentions.forEach((mention, j) => {
          const mentionField = `${field}.mentions[${j}]`;
          if (!mention || typeof mention !== 'object' || Array.isArray(mention)) {
            errors.push(`${mentionField} 必须是对象`);
            return;
          }
          if (!sample) return;
          const text = String(sample.response_text || '');
          const start = Number(mention.start);
          const end = Number(mention.end);
          const surface = String(mention.surface_form || '');
          if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start) {
            errors.push(`${mentionField} span 无效`);
          } else if (text.slice(start, end) !== surface) {
            errors.push(`${mentionField} span 与 surface_form 不一致`);
          }
        });
      }
    });
  }
  if (!Array.isArray(entry.relations)) {
    errors.push('relations 必须是数组');
  } else {
    const names = new Set((Array.isArray(entry.entities) ? entry.entities : [])
      .map((entity) => String(entity?.canonical_name || '').trim())
      .filter(Boolean));
    entry.relations.forEach((relation, index) => {
      const field = `relations[${index}]`;
      if (!relation || typeof relation !== 'object' || Array.isArray(relation)) {
        errors.push(`${field} 必须是对象`);
        return;
      }
      if (!names.has(String(relation.canonical_name || '').trim())) {
        errors.push(`${field}.canonical_name 未在 entities 中: ${relation.canonical_name}`);
      }
      if (!['competitor', 'non_competitor'].includes(relation.relation)) {
        errors.push(`${field}.relation 无效: ${relation.relation}`);
      }
    });
  }
  return errors;
}

/**
 * 语义真值覆盖（issue 013）：推荐/排名/情绪/已输出竞品关系各自至少 20 个
 * 已复核可评估实例；不足时对应项 pass=false，benchmark 必须输出 NOT EVALUABLE。
 */
function semanticTruthCoverage(truthBySample = new Map()) {
  const counts = { recommendation: 0, rank: 0, sentiment: 0, relations: 0 };
  truthBySample.forEach((truth) => {
    if (!truth || truth.review_status !== 'confirmed') return;
    if (typeof truth.recommendation === 'boolean') counts.recommendation += 1;
    if (truth.rank !== null && truth.rank !== undefined && truth.rank !== 'none') counts.rank += 1;
    if (truth.sentiment && truth.sentiment !== 'none') counts.sentiment += 1;
    if (Array.isArray(truth.relations) && truth.relations.length) counts.relations += 1;
  });
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [
    key,
    { count, pass: count >= 20 }
  ]));
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
  answerSha256,
  competitionJaccard,
  distribution,
  entityQualityStats,
  fieldStatusDistribution,
  metricSignature,
  pairwiseDiff,
  percentile,
  precisionRecallF1,
  relationQualityStats,
  semanticTruthCoverage,
  summarizeArm,
  validateTruthEntry
};

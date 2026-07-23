function roundScore(value) {
  return Number(value.toFixed(4));
}

function statusFromScore(score) {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'needs_improvement';
  return 'high_risk';
}

function pageWeight(instance, scoreConfig) {
  return instance.isHomepage ? scoreConfig.homepageWeight : 1;
}

function calculateTechnicalHealth({
  instances,
  blockers = [],
  evidenceComplete = true,
  unknownReasons = [],
  rules,
  scoreConfig
}) {
  if (!evidenceComplete) {
    return {
      score: null,
      rawScore: null,
      status: 'unknown',
      scoreCap: null,
      blockers: [],
      bottleneck: null,
      stages: [],
      issues: [],
      unknownReasons
    };
  }

  const byRule = new Map();
  instances.forEach((instance) => {
    const id = instance.check.id;
    if (!byRule.has(id)) byRule.set(id, []);
    byRule.get(id).push(instance);
  });

  const ruleResults = new Map();
  const stages = scoreConfig.stages.map((stage) => {
    const totalRuleWeight = stage.ruleIds.reduce(
      (sum, id) => sum + rules.checks[id].weight,
      0
    );
    const deduction = stage.ruleIds.reduce((sum, id) => {
      const ruleInstances = byRule.get(id) || [];
      const applicableWeight = ruleInstances.reduce(
        (total, instance) => total + pageWeight(instance, scoreConfig),
        0
      );
      const failedInstances = ruleInstances.filter((instance) => instance.check.status === 'failed');
      const failedWeight = failedInstances.reduce(
        (total, instance) => total + pageWeight(instance, scoreConfig),
        0
      );
      const coverage = applicableWeight ? failedWeight / applicableWeight : 0;
      const share = rules.checks[id].weight / totalRuleWeight;
      const ruleDeduction = stage.budget * share * coverage;
      ruleResults.set(id, {
        id,
        stage,
        coverage,
        deduction: ruleDeduction,
        instances: ruleInstances,
        failedInstances
      });
      return sum + ruleDeduction;
    }, 0);
    const score = roundScore(Math.max(0, stage.budget - deduction));
    return { ...stage, score, deduction: roundScore(deduction) };
  });

  const rawScore = roundScore(stages.reduce((sum, stage) => sum + stage.score, 0));
  const scoreCap = blockers.length ? Math.min(...blockers.map((blocker) => blocker.cap)) : null;
  const hasFailures = [...ruleResults.values()]
    .some((result) => result.failedInstances.length > 0);
  const roundedScore = Math.min(Math.round(rawScore), hasFailures ? 99 : 100);
  const score = Math.min(roundedScore, scoreCap ?? 100);
  const bottleneck = stages.reduce((lowest, stage) => {
    if (!lowest) return stage;
    return stage.score / stage.budget < lowest.score / lowest.budget ? stage : lowest;
  }, null);
  const issues = [...ruleResults.values()]
    .filter((result) => result.failedInstances.length > 0)
    .map((result) => {
      const first = result.failedInstances[0].check;
      return {
        id: result.id,
        title: first.title,
        finding: first.finding,
        severity: first.severity,
        stage: result.stage.key,
        stageLabel: result.stage.label,
        affectedPages: [...new Set(result.failedInstances.map((instance) => instance.url))],
        applicablePages: new Set(result.instances.map((instance) => instance.url)).size,
        coverage: roundScore(result.coverage),
        affectsHomepage: result.failedInstances.some((instance) => instance.isHomepage),
        deduction: roundScore(result.deduction),
        value: first.value
      };
    });

  return {
    score,
    rawScore,
    status: blockers.length ? 'blocked' : statusFromScore(score),
    scoreCap,
    blockers,
    bottleneck,
    stages,
    issues
  };
}

module.exports = { calculateTechnicalHealth };

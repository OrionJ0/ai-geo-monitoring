const PromptCategoryService = require('./PromptCategoryService');
const CitationMetricSemanticsService = require('./CitationMetricSemanticsService');
const GeoMetricSemanticsService = require('./GeoMetricSemanticsService');
const { CURRENT_METRIC_SEMANTICS } = require('./GeoMetricSemanticsService');
const WebCaptureAnswerQualityService = require('./WebCaptureAnswerQualityService');

class ProjectMetricsService {
  normalizeDays(value, fallback = 30) {
    const parsed = Number.parseInt(value ?? fallback, 10);
    const days = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(1, Math.min(365, days));
  }

  normalizeReferenceDate(value = new Date()) {
    const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  startOfLocalDay(value = new Date()) {
    const date = this.normalizeReferenceDate(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  buildPeriodWindow(days = 30, options = {}) {
    const safeDays = this.normalizeDays(days);
    const periodEnd = this.normalizeReferenceDate(options.referenceDate);
    const periodStart = this.startOfLocalDay(periodEnd);
    periodStart.setDate(periodStart.getDate() - (safeDays - 1));
    const changePeriodStart = this.startOfLocalDay(periodEnd);
    changePeriodStart.setDate(changePeriodStart.getDate() - ((safeDays * 2) - 1));
    return {
      days: safeDays,
      periodStart,
      periodEnd,
      changePeriodStart
    };
  }

  pct(numerator, denominator) {
    if (!denominator) return 0;
    return Number(((numerator / denominator) * 100).toFixed(2));
  }

  nullablePct(numerator, denominator) {
    if (!denominator) return null;
    return Number(((numerator / denominator) * 100).toFixed(2));
  }

  nullableAvg(values) {
    const numbers = (Array.isArray(values) ? values : [])
      .map(Number)
      .filter(Number.isFinite);
    if (!numbers.length) return null;
    return Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(2));
  }

  plain(row) {
    return row?.toJSON ? row.toJSON() : (row || {});
  }

  isCurrentMetric(row) {
    return String(this.plain(row).metric_semantics_version || '').trim() === CURRENT_METRIC_SEMANTICS;
  }

  hasAcquiredAnswer(record) {
    const row = this.plain(record);
    const resultDetail = this.plain(row.resultDetail || row.result_detail);
    return typeof resultDetail.ai_response_original === 'string'
      && resultDetail.ai_response_original.trim().length > 0;
  }

  captureQuality(record) {
    const row = this.plain(record);
    const resultDetail = this.plain(row.resultDetail || row.result_detail);
    return WebCaptureAnswerQualityService.evaluate({
      platform: row.platform,
      responseText: resultDetail.ai_response_original,
      webCapture: row.result_summary?.web_capture
    });
  }

  hasAnalysisEligibleAnswer(record) {
    return this.hasAcquiredAnswer(record)
      && this.captureQuality(record).status !== 'invalid';
  }

  withoutInvalidCaptureMetrics(metrics, records) {
    const invalidRecordIds = new Set(
      (Array.isArray(records) ? records : [])
        .map((row) => this.plain(row))
        .filter((row) => this.captureQuality(row).status === 'invalid')
        .map((row) => String(row.id))
    );
    if (!invalidRecordIds.size) return metrics;
    return metrics.filter((row) => (
      row.question_record_id === null
      || row.question_record_id === undefined
      || !invalidRecordIds.has(String(row.question_record_id))
    ));
  }

  isCurrentLogicalRecord(record) {
    const row = this.plain(record);
    if (row.question_set_run_id === null || row.question_set_run_id === undefined) {
      return true;
    }
    return row.run_slot_index !== null && row.run_slot_index !== undefined;
  }

  normalizePlatformFilter(value) {
    const platform = String(value || 'all').trim().toLowerCase();
    if (platform === 'all') return platform;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(platform)) {
      const error = new Error('平台筛选参数无效');
      error.code = 'INVALID_PLATFORM_FILTER';
      throw error;
    }
    return platform;
  }

  listActualPlatforms(...collections) {
    const platforms = new Set();
    for (const collection of collections) {
      for (const item of Array.isArray(collection) ? collection : []) {
        const platform = String(this.plain(item).platform || '').trim().toLowerCase();
        if (platform) platforms.add(platform);
      }
    }
    return Array.from(platforms).sort((left, right) => left.localeCompare(right));
  }

  filterByPlatform(rows, platform = 'all') {
    const selected = this.normalizePlatformFilter(platform);
    const source = Array.isArray(rows) ? rows : [];
    if (selected === 'all') return source;
    return source.filter(
      (row) => String(this.plain(row).platform || '').trim().toLowerCase() === selected
    );
  }

  citationCount(row, field = 'citation_count') {
    return CitationMetricSemanticsService.citationCount(row, field);
  }

  isCitationEligible(row) {
    return CitationMetricSemanticsService.isCoreKpiEligible(row);
  }

  buildCitationEvidenceRows(metricRows, acquiredRows) {
    const metricsByRecordId = new Map(
      metricRows
        .filter((row) => row.question_record_id !== null && row.question_record_id !== undefined)
        .map((row) => [String(row.question_record_id), row])
    );
    const evidenceRows = [];
    for (const record of acquiredRows) {
      const resultDetail = this.plain(record.resultDetail || record.result_detail);
      const citationAnalysis = resultDetail?.citation_analysis;
      const metric = metricsByRecordId.get(String(record.id));
      if (
        citationAnalysis
        && typeof citationAnalysis === 'object'
        && !Array.isArray(citationAnalysis)
        && CitationMetricSemanticsService.isCoreKpiEligible(citationAnalysis)
      ) {
        evidenceRows.push({
          platform: record.platform,
          prompt_id: record.tracked_prompt_id,
          created_at: record.created_at || record.createdAt || null,
          prompt_category: metric?.prompt_category || null,
          brand_mentioned: metric ? Boolean(metric.brand_mentioned) : null,
          citation_count: citationAnalysis.citation_count,
          owned_citation_count: citationAnalysis.owned_citation_count,
          competitor_citation_count: citationAnalysis.competitor_citation_count,
          citation_sources: Array.isArray(citationAnalysis.sources)
            ? citationAnalysis.sources
            : [],
          analysis_structure: {
            citations: {
              semantics_version: citationAnalysis.semantics_version,
              evidence_status: citationAnalysis.evidence_status
            }
          }
        });
        continue;
      }
      if (metric && this.isCitationEligible(metric)) evidenceRows.push(metric);
    }
    if (!acquiredRows.length) {
      return metricRows.filter((row) => this.isCitationEligible(row));
    }
    return evidenceRows;
  }

  buildCurrentCitationEvidenceRows({ metrics, records } = {}) {
    const recordRows = (Array.isArray(records) ? records : [])
      .map((row) => this.plain(row))
      .filter((row) => this.isCurrentMetric(row))
      .filter((row) => this.isCurrentLogicalRecord(row));
    const metricRows = this.withoutInvalidCaptureMetrics(
      (Array.isArray(metrics) ? metrics : [])
        .map((row) => this.plain(row))
        .filter((row) => this.isCurrentMetric(row)),
      recordRows
    );
    return this.buildCitationEvidenceRows(
      metricRows,
      recordRows.filter((row) => this.hasAnalysisEligibleAnswer(row))
    );
  }

  buildCurrentMetricView({ metrics, records } = {}) {
    const recordRows = (Array.isArray(records) ? records : [])
      .map((row) => this.plain(row))
      .filter((row) => this.isCurrentMetric(row))
      .filter((row) => this.isCurrentLogicalRecord(row));
    const metricRows = this.withoutInvalidCaptureMetrics(
      (Array.isArray(metrics) ? metrics : [])
        .map((row) => this.plain(row))
        .filter((row) => this.isCurrentMetric(row)),
      recordRows
    );
    const acquiredRows = recordRows.filter((row) => this.hasAnalysisEligibleAnswer(row));
    const invalidCaptureRows = recordRows.filter((row) => (
      this.hasAcquiredAnswer(row)
      && this.captureQuality(row).status === 'invalid'
    ));
    const sovValues = metricRows
      .map((row) => {
        const sov = GeoMetricSemanticsService.presentSov(row);
        return sov.status === 'calculated' ? sov.value : null;
      })
      .filter((value) => value !== null);
    const mentioned = metricRows.filter((row) => Boolean(row.brand_mentioned)).length;
    const recommended = metricRows.filter((row) => Boolean(row.brand_recommended)).length;
    const rankValues = metricRows
      .map((row) => Number(row.brand_rank))
      .filter((rank) => Number.isFinite(rank) && rank > 0);
    const citationRows = this.buildCurrentCitationEvidenceRows({
      metrics: metricRows,
      records: recordRows
    });
    const cited = citationRows.filter((row) => this.citationCount(row) > 0).length;
    const ownedCited = citationRows.filter(
      (row) => this.citationCount(row, 'owned_citation_count') > 0
    ).length;
    const sentimentRows = metricRows.filter((row) => Boolean(row.brand_mentioned));
    const negative = sentimentRows.filter((row) => row.sentiment === 'negative').length;
    const competitorMap = new Map();

    for (const row of metricRows) {
      const seenInAnswer = new Set();
      for (const entity of Array.isArray(row.competition_entities) ? row.competition_entities : []) {
        if (entity?.relation !== 'competitor') continue;
        const name = String(entity?.name || '').trim();
        const mentions = Number(entity?.mentions);
        if (!name || !Number.isFinite(mentions) || mentions <= 0) continue;
        const entry = competitorMap.get(name) || { name, mentions: 0, appeared_answers: 0 };
        entry.mentions += mentions;
        if (!seenInAnswer.has(name)) {
          entry.appeared_answers += 1;
          seenInAnswer.add(name);
        }
        competitorMap.set(name, entry);
      }
    }

    const total = metricRows.length;
    return {
      metric_semantics_version: CURRENT_METRIC_SEMANTICS,
      valid_answers: total,
      acquired_answers: acquiredRows.length,
      invalid_captures: invalidCaptureRows.length,
      analysis_coverage_rate: this.nullablePct(total, acquiredRows.length),
      total_checks: total,
      checks: total,
      brand_mentioned_answers: mentioned,
      brand_mention_rate: this.nullablePct(mentioned, total),
      recommended_answers: recommended,
      recommendation_rate: this.nullablePct(recommended, total),
      ranked_answers: rankValues.length,
      avg_brand_rank: this.nullableAvg(rankValues),
      sov_summary: {
        metric_semantics_version: CURRENT_METRIC_SEMANTICS,
        kind: 'contextual_competitor_mentions',
        average: this.nullableAvg(sovValues),
        calculable_answers: sovValues.length
      },
      citation_eligible_checks: citationRows.length,
      citation_unverified_checks: acquiredRows.length - citationRows.length,
      citation_rate: this.nullablePct(cited, citationRows.length),
      owned_citation_rate: this.nullablePct(ownedCited, citationRows.length),
      negative_sentiment_answers: negative,
      negative_sentiment_rate: this.nullablePct(negative, sentimentRows.length),
      competitors: Array.from(competitorMap.values())
        .sort((left, right) => (
          right.mentions - left.mentions
          || left.name.localeCompare(right.name, 'zh-Hans-CN')
        ))
    };
  }

  summarizeRuns(records) {
    const rows = (Array.isArray(records) ? records : [])
      .map((row) => this.plain(row))
      .filter((row) => this.isCurrentLogicalRecord(row));
    const total = rows.length;
    const completed = rows.filter((row) => row.status === 'completed').length;
    const failed = rows.filter((row) => row.status === 'failed').length;
    const pending = rows.filter((row) => row.status === 'pending').length;
    return {
      total_runs: total,
      completed_runs: completed,
      failed_runs: failed,
      pending_runs: pending,
      failure_rate: this.pct(failed, total)
    };
  }

  buildCurrentDashboardSummary({ metrics, records, prompts, sourceAnalysis } = {}) {
    const recordRows = (Array.isArray(records) ? records : [])
      .map((row) => this.plain(row))
      .filter((row) => this.isCurrentMetric(row))
      .filter((row) => this.isCurrentLogicalRecord(row));
    const metricRows = this.withoutInvalidCaptureMetrics(
      (Array.isArray(metrics) ? metrics : [])
        .map((row) => this.plain(row))
        .filter((row) => this.isCurrentMetric(row)),
      recordRows
    );
    const promptRows = Array.isArray(prompts) ? prompts : [];
    const source = sourceAnalysis && typeof sourceAnalysis === 'object' ? sourceAnalysis : {};
    const platforms = this.listActualPlatforms(metricRows, recordRows).map((platform) => ({
      platform,
      ...this.buildCurrentMetricView({
        metrics: this.filterByPlatform(metricRows, platform),
        records: this.filterByPlatform(recordRows, platform)
      })
    }));
    const promptCategoryMap = new Map();
    const categoryMap = new Map();

    for (const prompt of promptRows) {
      const category = PromptCategoryService.derive(prompt);
      const entry = categoryMap.get(category) || {
        category,
        prompt_count: 0,
        enabled_prompt_count: 0
      };
      entry.prompt_count += 1;
      if (prompt?.enabled !== false) entry.enabled_prompt_count += 1;
      categoryMap.set(category, entry);
      if (prompt?.id !== null && prompt?.id !== undefined) {
        promptCategoryMap.set(String(prompt.id), category);
      }
    }

    const categoryOf = (row) => {
      const item = this.plain(row);
      const promptId = item.prompt_id ?? item.tracked_prompt_id;
      if (
        promptId !== null
        && promptId !== undefined
        && promptCategoryMap.has(String(promptId))
      ) {
        return promptCategoryMap.get(String(promptId));
      }
      return String(item.prompt_category || '').trim() || null;
    };
    for (const row of [...metricRows, ...recordRows]) {
      const category = categoryOf(row);
      if (category && !categoryMap.has(category)) {
        categoryMap.set(category, {
          category,
          prompt_count: 0,
          enabled_prompt_count: 0
        });
      }
    }
    const categories = Array.from(categoryMap.values()).map((entry) => {
      const categoryMetrics = metricRows.filter((row) => categoryOf(row) === entry.category);
      const categoryRecords = recordRows.filter((row) => categoryOf(row) === entry.category);
      return {
        ...entry,
        ...this.buildCurrentMetricView({
          metrics: categoryMetrics,
          records: categoryRecords
        }),
        ...this.summarizeRuns(categoryRecords)
      };
    }).sort((left, right) => (
      right.prompt_count - left.prompt_count
      || left.category.localeCompare(right.category, 'zh-Hans-CN')
    ));

    return {
      ...this.buildCurrentMetricView({ metrics: metricRows, records: recordRows }),
      ...this.summarizeRuns(recordRows),
      platforms,
      categories,
      source_summary: source.summary || {},
      source_types: Array.isArray(source.source_types) ? source.source_types : [],
      source_domains: Array.isArray(source.domains) ? source.domains.slice(0, 20) : [],
      source_urls: Array.isArray(source.urls) ? source.urls.slice(0, 20) : [],
      source_changes: source.source_changes || {
        new_domains: [],
        dropped_domains: [],
        retained_domains: [],
        new_urls: [],
        dropped_urls: [],
        retained_urls: []
      }
    };
  }

  buildCurrentPromptPerformance(prompts, metrics, records = []) {
    const promptRows = Array.isArray(prompts) ? prompts : [];
    const recordRows = (Array.isArray(records) ? records : [])
      .map((row) => this.plain(row))
      .filter((row) => this.isCurrentMetric(row))
      .filter((row) => this.isCurrentLogicalRecord(row));
    const metricRows = this.withoutInvalidCaptureMetrics(
      (Array.isArray(metrics) ? metrics : [])
        .map((row) => this.plain(row))
        .filter((row) => this.isCurrentMetric(row)),
      recordRows
    );
    const promptIdOf = (row) => {
      const id = row.prompt_id ?? row.tracked_prompt_id;
      return id === null || id === undefined ? null : String(id);
    };
    const latest = (rows) => rows.reduce((latestValue, row) => {
      const value = row.created_at || row.createdAt || row.detection_time || row.detectionTime || null;
      if (!value) return latestValue;
      if (!latestValue || new Date(value) > new Date(latestValue)) return value;
      return latestValue;
    }, null);
    const result = {};

    for (const prompt of promptRows) {
      if (prompt?.id === null || prompt?.id === undefined) continue;
      const key = String(prompt.id);
      const promptMetrics = metricRows.filter((row) => promptIdOf(row) === key);
      const promptRecords = recordRows.filter((row) => promptIdOf(row) === key);
      result[key] = {
        ...this.buildCurrentMetricView({
          metrics: promptMetrics,
          records: promptRecords
        }),
        ...this.summarizeRuns(promptRecords),
        positive_sentiment_count: promptMetrics.filter(
          (row) => row.brand_mentioned && row.sentiment === 'positive'
        ).length,
        neutral_sentiment_count: promptMetrics.filter(
          (row) => row.brand_mentioned
            && row.sentiment !== 'positive'
            && row.sentiment !== 'negative'
        ).length,
        negative_sentiment_count: promptMetrics.filter(
          (row) => row.brand_mentioned && row.sentiment === 'negative'
        ).length,
        last_run_at: latest([...promptMetrics, ...promptRecords])
      };
    }
    return result;
  }

  formatDateKey(date) {
    const value = date instanceof Date ? date : new Date(date || Date.now());
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  buildCurrentTrend(metrics, records, days = 30, options = {}) {
    const metricRows = Array.isArray(metrics) ? metrics : [];
    const recordRows = (Array.isArray(records) ? records : [])
      .filter((row) => this.isCurrentLogicalRecord(row));
    const safeDays = this.normalizeDays(days);
    const referenceDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    const trend = [];

    for (let index = safeDays - 1; index >= 0; index -= 1) {
      const date = new Date(referenceDate);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - index);
      const key = this.formatDateKey(date);
      const byDate = (row) => (
        this.formatDateKey(this.plain(row).created_at || this.plain(row).createdAt) === key
      );
      trend.push({
        date: key,
        ...this.buildCurrentMetricView({
          metrics: metricRows.filter(byDate),
          records: recordRows.filter(byDate)
        })
      });
    }
    return trend;
  }

  presentCurrentMetric(metric) {
    const row = this.plain(metric);
    const sov = GeoMetricSemanticsService.presentSov(row);
    const normalized = CitationMetricSemanticsService.normalizeForRead(row);
    const {
      share_of_voice: ignoredHistoricalSov,
      competitor_mentions: ignoredHistoricalCompetitors,
      ...current
    } = normalized;
    return {
      ...current,
      sov
    };
  }
}

module.exports = new ProjectMetricsService();

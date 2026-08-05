const CURRENT_ANALYSIS_CONTRACT = 'ai_structured_v4';
const CURRENT_STRUCTURE_VERSION = 'geo_metric_input_v4';
const CURRENT_METRIC_SEMANTICS = 'contextual_competitor_mentions_sov_v1';
const SCOPED_METRIC_SEMANTICS = 'contextual_competitor_mentions_sov_v2_scoped';
const LEGACY_METRIC_SEMANTICS = 'configured_competitor_sov_v1';

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

class GeoMetricSemanticsService {
  presentSov(metric = {}) {
    const version = String(metric.metric_semantics_version || '').trim();
    if (version === CURRENT_METRIC_SEMANTICS) {
      const value = finiteNumberOrNull(metric.answer_competitor_share);
      const numerator = Number(metric.sov_numerator);
      const denominator = Number(metric.sov_denominator);
      const validCounts = (
        Number.isInteger(numerator)
        && numerator >= 0
        && Number.isInteger(denominator)
        && denominator >= 0
        && numerator <= denominator
      );
      if (!validCounts) {
        const error = new Error('新版 SOV 分子或分母无效');
        error.code = 'metric_semantics_mismatch';
        throw error;
      }
      if (denominator === 0 && (numerator !== 0 || value !== null)) {
        const error = new Error('SOV 不适用时必须使用 0/0 和空值');
        error.code = 'metric_semantics_mismatch';
        throw error;
      }
      if (denominator > 0 && (value === null || value < 0 || value > 100)) {
        const error = new Error('可计算 SOV 必须提供 0 至 100 的值');
        error.code = 'metric_semantics_mismatch';
        throw error;
      }
      const calculatedValue = denominator > 0
        ? Number(((numerator / denominator) * 100).toFixed(2))
        : null;
      if (denominator > 0 && value !== calculatedValue) {
        const error = new Error('新版 SOV 值与分子分母不一致');
        error.code = 'metric_semantics_mismatch';
        throw error;
      }
      return {
        metric_semantics_version: CURRENT_METRIC_SEMANTICS,
        kind: 'contextual_competitor_mentions',
        status: denominator === 0 ? 'not_applicable' : 'calculated',
        value,
        numerator,
        denominator
      };
    }
    if (version !== LEGACY_METRIC_SEMANTICS) {
      const error = new Error(`不支持的指标语义版本: ${version || 'missing'}`);
      error.code = 'metric_semantics_mismatch';
      throw error;
    }
    const value = finiteNumberOrNull(metric.share_of_voice);
    return {
      metric_semantics_version: LEGACY_METRIC_SEMANTICS,
      kind: 'legacy_configured_competitors',
      status: value === null ? 'not_applicable' : 'calculated',
      value,
      numerator: null,
      denominator: null
    };
  }

  /**
   * 开放发现 scoped SOV：只表达本次已发现、已锚定且已证明为竞品的实体范围。
   * 固定携带 observed_only / open_discovery / not_proven，不冒充完整市场份额。
   * 与历史 v1 语义版本隔离，不得混入同一趋势。
   */
  presentScopedSov(metric = {}) {
    const version = String(metric.metric_semantics_version || '').trim();
    if (version !== SCOPED_METRIC_SEMANTICS) {
      const error = new Error(`不支持的 scoped 指标语义版本: ${version || 'missing'}`);
      error.code = 'metric_semantics_mismatch';
      throw error;
    }
    if (String(metric.sov_status || '') !== 'observed_only') {
      const error = new Error('开放发现 SOV 状态必须为 observed_only');
      error.code = 'metric_semantics_mismatch';
      throw error;
    }
    const numerator = Number(metric.sov_numerator);
    const denominator = Number(metric.sov_denominator);
    const validCounts = (
      Number.isInteger(numerator)
      && numerator >= 0
      && Number.isInteger(denominator)
      && denominator >= 0
      && numerator <= denominator
    );
    if (!validCounts) {
      const error = new Error('scoped SOV 分子或分母无效');
      error.code = 'metric_semantics_mismatch';
      throw error;
    }
    const value = denominator > 0
      ? Number(((numerator / denominator) * 100).toFixed(2))
      : null;
    if (denominator === 0 && (numerator !== 0 || metric.answer_competitor_share != null)) {
      const error = new Error('SOV 不适用时必须使用 0/0 和空值');
      error.code = 'metric_semantics_mismatch';
      throw error;
    }
    return {
      metric_semantics_version: SCOPED_METRIC_SEMANTICS,
      kind: 'observed_competitor_mentions',
      status: 'observed_only',
      scope: 'open_discovery',
      completeness: 'not_proven',
      value,
      numerator,
      denominator
    };
  }
}

module.exports = new GeoMetricSemanticsService();
module.exports.CURRENT_ANALYSIS_CONTRACT = CURRENT_ANALYSIS_CONTRACT;
module.exports.CURRENT_STRUCTURE_VERSION = CURRENT_STRUCTURE_VERSION;
module.exports.CURRENT_METRIC_SEMANTICS = CURRENT_METRIC_SEMANTICS;
module.exports.SCOPED_METRIC_SEMANTICS = SCOPED_METRIC_SEMANTICS;
module.exports.LEGACY_METRIC_SEMANTICS = LEGACY_METRIC_SEMANTICS;

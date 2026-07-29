export function getBrandSentimentDisplay(metric?: {
  sentiment?: string;
  brand_mentioned?: boolean;
  sentiment_reason?: string;
  sentiment_risk_terms?: string[];
}): {
  sentimentLabel: string;
  sentimentColor: string;
  sentimentReason: string;
  sentimentRiskTerms: string[];
};

export function getHistoryAnalysisDisplay(row?: {
  status?: string;
  visibilityMetric?: {
    share_of_voice?: number;
    metric_semantics_version?: string;
    answer_competitor_share?: number | null;
    sov_numerator?: number;
    sov_denominator?: number;
    sentiment?: string;
    brand_mentioned?: boolean;
    sentiment_reason?: string;
    sentiment_risk_terms?: string[];
  };
}): {
  sov: string;
  sovLabel: string;
  metricSemanticsLabel: string;
  sentimentLabel: string;
  sentimentColor: string;
  sentimentReason: string;
  sentimentRiskTerms: string[];
  brandMentionLabel: string;
  brandMentionColor: string;
};

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const MARKETING_AD_READ_CONTRACT = deepFreeze({
  schemaVersions: {
    dashboard: 'marketing_dashboard_v2',
    adHierarchy: 'marketing_ad_hierarchy_v1',
    keywords: 'marketing_keywords_v1',
    searchTerms: 'marketing_search_terms_v1'
  },
  pagination: {
    defaultPage: 1,
    defaultPageSize: 50,
    maximumPageSize: 200,
    maximumQueryLength: 200
  },
  sortOrders: ['ascend', 'descend'],
  summaryFields: ['impressions', 'clicks', 'costAmountScaled'],
  exactValueType: 'unsigned-decimal-string',
  missingValue: null,
  resources: {
    adHierarchy: {
      schemaVersion: 'marketing_ad_hierarchy_v1',
      filters: []
    },
    keywords: {
      schemaVersion: 'marketing_keywords_v1',
      filters: ['query', 'campaignId', 'adGroupId'],
      sortBy: [
        'keywordName',
        'impressions',
        'clicks',
        'costAmountScaled',
        'ctr',
        'averageCpc'
      ]
    },
    searchTerms: {
      schemaVersion: 'marketing_search_terms_v1',
      filters: [
        'query',
        'accountId',
        'campaignId',
        'adGroupId',
        'keywordName',
        'queryStatus',
        'matchType'
      ],
      sortBy: [
        'searchTerm',
        'keywordName',
        'impressions',
        'clicks',
        'costAmountScaled',
        'ctr',
        'averageCpc'
      ]
    }
  },
  revision: {
    requiredForDetails: true,
    source: 'complete-succeeded-refresh-run',
    projectScoped: true,
    coverageBound: true
  },
  cacheControl: {
    dashboard: 'private, no-store',
    details: 'private, max-age=60'
  },
  errors: {
    revisionRequired: 'MARKETING_REVISION_REQUIRED',
    queryInvalid: 'MARKETING_AD_RESOURCE_QUERY_INVALID',
    revisionNotFound: 'MARKETING_REVISION_NOT_FOUND',
    snapshotUnavailable: 'MARKETING_SNAPSHOT_UNAVAILABLE',
    dateOutOfRange: 'DASHBOARD_DATE_OUT_OF_RANGE',
    internalFailure: 'MARKETING_AD_RESOURCE_FAILED'
  }
});

module.exports = {
  MARKETING_AD_READ_CONTRACT
};

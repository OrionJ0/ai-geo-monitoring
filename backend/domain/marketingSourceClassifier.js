const SOURCE_LABELS = Object.freeze({
  BAIDU_PAID: '百度推广',
  DIRECT: '直接访问',
  BAIDU_SEARCH: '百度自然搜索',
  BING_SEARCH: '必应自然搜索',
  GOOGLE_SEARCH: 'Google 自然搜索',
  OTHER_SEARCH: '其他搜索引擎',
  EXTERNAL_REFERRAL: '外部网站引荐',
  UTM_CAMPAIGN: 'UTM 推广',
  UNKNOWN: '未知来源'
});

const SOURCE_KEYS = Object.freeze(Object.keys(SOURCE_LABELS));
const SOURCE_KEY_SET = new Set(SOURCE_KEYS);
const PAID_UTM_MEDIA = new Set([
  'cpc',
  'ppc',
  'paid',
  'paid_search',
  'sem'
]);
const OTHER_SEARCH_DOMAINS = Object.freeze([
  'sogou.com',
  'so.com',
  'sm.cn',
  'yahoo.com',
  'yandex.com',
  'duckduckgo.com'
]);
const GOOGLE_DOMAINS = Object.freeze([
  'google.com',
  'google.com.hk',
  'google.cn',
  'google.co.uk',
  'google.co.jp'
]);

function nullableText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function domainMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function matchesAnyDomain(host, domains) {
  return domains.some((domain) => domainMatches(host, domain));
}

function parseHttpUrl(value) {
  const normalized = nullableText(value);
  if (!normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) return null;
  try {
    const parsed = new URL(normalized);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hasUtmEvidence(record) {
  return [record.utmSource, record.utmMedium, record.utmCampaign]
    .some((value) => nullableText(value));
}

function isBaiduPaidUtm(record) {
  const source = nullableText(record.utmSource)?.toLocaleLowerCase('en-US');
  const medium = nullableText(record.utmMedium)?.toLocaleLowerCase('en-US');
  return source === 'baidu' && PAID_UTM_MEDIA.has(medium || '');
}

function result(sourceKey, evidenceType, evidenceValue = null) {
  return {
    sourceKey,
    sourceLabel: SOURCE_LABELS[sourceKey],
    evidenceType,
    evidenceValue
  };
}

function classifyWebsiteAttribution(record = {}) {
  if (nullableText(record.bdVid) || nullableText(record.sdclkid)) {
    return result('BAIDU_PAID', 'BAIDU_CLICK_ID');
  }
  if (isBaiduPaidUtm(record)) {
    return result('BAIDU_PAID', 'UTM_PAID_SEARCH');
  }
  if (hasUtmEvidence(record)) {
    return result(
      'UTM_CAMPAIGN',
      'UTM',
      nullableText(record.utmSource)
    );
  }

  const rawReferrer = nullableText(record.referrer);
  const referrer = parseHttpUrl(rawReferrer);
  if (rawReferrer && !referrer) {
    return result('UNKNOWN', 'INVALID_REFERRER');
  }
  const host = referrer?.hostname.toLocaleLowerCase('en-US') || null;
  const isOwnWebsite = host ? domainMatches(host, 'gato.com.cn') : false;
  if (host && !isOwnWebsite) {
    if (matchesAnyDomain(host, ['baidu.com', 'baidu.cn'])) {
      return result('BAIDU_SEARCH', 'REFERRER_HOST', host);
    }
    if (domainMatches(host, 'bing.com')) {
      return result('BING_SEARCH', 'REFERRER_HOST', host);
    }
    if (matchesAnyDomain(host, GOOGLE_DOMAINS)) {
      return result('GOOGLE_SEARCH', 'REFERRER_HOST', host);
    }
    if (matchesAnyDomain(host, OTHER_SEARCH_DOMAINS)) {
      return result('OTHER_SEARCH', 'REFERRER_HOST', host);
    }
    return result('EXTERNAL_REFERRAL', 'REFERRER_HOST', host);
  }

  const sourceChannel = (
    nullableText(record.firstSourceChannel)
    || nullableText(record.sourceChannel)
  )?.toLocaleLowerCase('en-US');
  if (sourceChannel === 'baidu_paid') {
    return result('BAIDU_PAID', 'UPSTREAM_SOURCE_CHANNEL');
  }
  if (sourceChannel === 'direct') {
    return result('DIRECT', 'UPSTREAM_SOURCE_CHANNEL');
  }
  return result('UNKNOWN', 'INSUFFICIENT_EVIDENCE');
}

module.exports = {
  SOURCE_KEYS,
  SOURCE_KEY_SET,
  SOURCE_LABELS,
  classifyWebsiteAttribution,
  parseHttpUrl
};

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SOURCE_KEYS,
  classifyWebsiteAttribution
} = require('../../domain/marketingSourceClassifier');

test('defines the nine canonical marketing source keys', () => {
  assert.deepEqual(SOURCE_KEYS, [
    'BAIDU_PAID',
    'DIRECT',
    'BAIDU_SEARCH',
    'BING_SEARCH',
    'GOOGLE_SEARCH',
    'OTHER_SEARCH',
    'EXTERNAL_REFERRAL',
    'UTM_CAMPAIGN',
    'UNKNOWN'
  ]);
});

test('classifies search-engine and external referrers by exact host', () => {
  assert.equal(
    classifyWebsiteAttribution({ referrer: 'https://cn.bing.com/' }).sourceKey,
    'BING_SEARCH'
  );
  assert.equal(
    classifyWebsiteAttribution({ referrer: 'https://www.baidu.com/s?wd=test' }).sourceKey,
    'BAIDU_SEARCH'
  );
  assert.equal(
    classifyWebsiteAttribution({ referrer: 'https://www.google.com.hk/search?q=test' }).sourceKey,
    'GOOGLE_SEARCH'
  );
  assert.equal(
    classifyWebsiteAttribution({ referrer: 'https://www.sogou.com/web' }).sourceKey,
    'OTHER_SEARCH'
  );
  assert.equal(
    classifyWebsiteAttribution({ referrer: 'https://partner.example.com/article' }).sourceKey,
    'EXTERNAL_REFERRAL'
  );
});

test('does not accept deceptive or same-site hosts as external sources', () => {
  assert.equal(
    classifyWebsiteAttribution({
      sourceChannel: 'organic_search',
      referrer: 'https://bing.com.attacker.example/'
    }).sourceKey,
    'EXTERNAL_REFERRAL'
  );
  assert.equal(
    classifyWebsiteAttribution({
      sourceChannel: 'organic_search',
      referrer: 'https://gato.com.cn/about'
    }).sourceKey,
    'UNKNOWN'
  );
  assert.equal(
    classifyWebsiteAttribution({
      sourceChannel: 'organic_search',
      referrer: 'https://user:secret@bing.com/'
    }).sourceKey,
    'UNKNOWN'
  );
});

test('uses paid and UTM evidence before the referrer', () => {
  assert.equal(
    classifyWebsiteAttribution({
      bdVid: 'synthetic-click-id',
      referrer: 'https://cn.bing.com/'
    }).sourceKey,
    'BAIDU_PAID'
  );
  assert.equal(
    classifyWebsiteAttribution({
      sdclkid: 'synthetic-search-click-id',
      referrer: 'https://cn.bing.com/'
    }).sourceKey,
    'BAIDU_PAID'
  );
  assert.equal(
    classifyWebsiteAttribution({
      utmSource: 'baidu',
      utmMedium: 'cpc',
      referrer: 'https://partner.example.com/'
    }).sourceKey,
    'BAIDU_PAID'
  );
  assert.equal(
    classifyWebsiteAttribution({
      utmSource: 'partner',
      utmCampaign: 'synthetic-campaign',
      referrer: 'https://cn.bing.com/'
    }).sourceKey,
    'UTM_CAMPAIGN'
  );
});

test('uses only explicit paid and direct upstream fallbacks', () => {
  assert.equal(
    classifyWebsiteAttribution({ sourceChannel: 'baidu_paid' }).sourceKey,
    'BAIDU_PAID'
  );
  assert.equal(
    classifyWebsiteAttribution({ sourceChannel: 'direct' }).sourceKey,
    'DIRECT'
  );
  assert.equal(
    classifyWebsiteAttribution({
      firstSourceChannel: 'direct',
      sourceChannel: 'organic_search'
    }).sourceKey,
    'DIRECT'
  );
  assert.equal(
    classifyWebsiteAttribution({ sourceChannel: 'organic_search' }).sourceKey,
    'UNKNOWN'
  );
  assert.equal(
    classifyWebsiteAttribution({ sourceChannel: 'campaign' }).sourceKey,
    'UNKNOWN'
  );
  assert.equal(
    classifyWebsiteAttribution({ referrer: 'not a URL' }).sourceKey,
    'UNKNOWN'
  );
  assert.equal(
    classifyWebsiteAttribution({
      sourceChannel: 'direct',
      referrer: 'not a URL'
    }).sourceKey,
    'UNKNOWN'
  );
  assert.equal(
    classifyWebsiteAttribution({
      sourceChannel: 'direct',
      referrer: 'https://bing.com/\nmalformed'
    }).sourceKey,
    'UNKNOWN'
  );
});

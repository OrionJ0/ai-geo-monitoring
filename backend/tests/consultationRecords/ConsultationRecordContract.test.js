const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ConsultationRecordError,
  coverageState,
  normalizeDetail,
  normalizeListQuery,
  normalizeSourceStatus,
  normalizeSummary,
  sanitizePublicText
} = require('../../modules/consultationRecords/contracts/consultationRecordContract');

const redactedSummary = Object.freeze({
  id: 'form_redacted_001',
  sourceSystem: 'GATO_WEBSITE',
  consultationType: 'WEBSITE_FORM',
  occurredAt: '2026-08-03T03:08:00.000Z',
  source: { key: 'BING_SEARCH', label: '必应自然搜索' },
  landingPage: { label: '振动光纤', path: '/solutions/fiber' },
  contentSummary: '准备建设周界防护项目，希望了解方案范围。',
  maskedContact: {
    displayName: '李**',
    phone: '138****5621',
    email: 'l***@example.com'
  },
  device: 'PC',
  detailAvailable: true
});

test('normalizes bounded list filters and rejects unsafe query input', () => {
  assert.deepEqual(normalizeListQuery({
    from: '2026-07-05',
    to: '2026-08-03',
    page: '2',
    pageSize: '20',
    type: 'WEBSITE_FORM',
    source: 'BING_SEARCH',
    device: 'PC',
    q: '  周界  ',
    sortBy: 'occurredAt',
    sortOrder: 'asc'
  }), {
    from: '2026-07-05',
    to: '2026-08-03',
    page: 2,
    pageSize: 20,
    type: 'WEBSITE_FORM',
    source: 'BING_SEARCH',
    device: 'PC',
    q: '周界',
    sortBy: 'occurredAt',
    sortOrder: 'asc'
  });
  assert.throws(
    () => normalizeListQuery({
      from: '2026-01-01',
      to: '2026-08-03'
    }),
    (error) => error instanceof ConsultationRecordError
      && error.code === 'CONSULTATION_RECORD_DATE_RANGE_TOO_LARGE'
      && error.status === 422
  );
  assert.throws(
    () => normalizeListQuery({
      from: '2026-08-01',
      to: '2026-08-03',
      q: 'unsafe\nsearch'
    }),
    /q 参数无效/u
  );
  assert.throws(
    () => normalizeListQuery({
      from: '2026-08-01',
      to: '2026-08-03',
      source: 'ORGANIC_SEARCH'
    }),
    /source 参数无效/u
  );
});

test('keeps list rows summarized and deterministically masks every contact field', () => {
  assert.deepEqual(normalizeSummary(redactedSummary), redactedSummary);
  const remasked = normalizeSummary({
    ...redactedSummary,
    contentSummary: '请联系 13812345678 或 person@example.com，IP 192.168.0.18。',
    maskedContact: {
      displayName: '李雷*',
      phone: '13812345678*',
      email: 'person@example.com*'
    }
  });
  assert.deepEqual(remasked.maskedContact, {
    displayName: '李**',
    phone: '138****5678',
    email: 'p***@example.com'
  });
  assert.equal(
    remasked.contentSummary,
    '请联系 138****5678 或 p***@example.com，IP [IP 已脱敏]。'
  );
  assert.throws(
    () => normalizeSummary({
      ...redactedSummary,
      contentSummary: '字'.repeat(161)
    }),
    /contentSummary/u
  );
});

test('uses a discriminated detail contract and allowlists source record URLs', () => {
  const detail = normalizeDetail({
    ...redactedSummary,
    externalRecordUrl: 'https://gato.com.cn/admin/contact/redacted',
    form: {
      content: '希望了解周界防护方案和交付周期。',
      fields: [
        { label: '需求类型', value: '周界防护' },
        { label: '预算范围', value: '待确认' }
      ]
    }
  }, ['https://gato.com.cn']);
  assert.equal(detail.consultationType, 'WEBSITE_FORM');
  assert.equal(detail.form.fields.length, 2);
  assert.equal(detail.externalRecordUrl, 'https://gato.com.cn/admin/contact/redacted');

  assert.throws(
    () => normalizeDetail({
      ...redactedSummary,
      externalRecordUrl: 'https://example.invalid/record',
      form: { content: '脱敏正文', fields: [] }
    }, ['https://gato.com.cn']),
    /externalRecordUrl/u
  );

  const sanitized = normalizeDetail({
    ...redactedSummary,
    externalRecordUrl: null,
    form: {
      content: '回拨 18612345678，邮箱 alice@example.com。',
      fields: [{ label: '电话', value: '18612345678' }]
    }
  });
  assert.equal(sanitized.form.content, '回拨 186****5678，邮箱 a***@example.com。');
  assert.equal(sanitized.form.fields[0].value, '186****5678');
});

test('online chat detail excludes system senders and requires a visitor message', () => {
  const chat = normalizeDetail({
    ...redactedSummary,
    id: 'chat_redacted_001',
    sourceSystem: 'KF53',
    consultationType: 'ONLINE_CHAT',
    externalRecordUrl: null,
    conversation: {
      messages: [
        {
          sender: 'VISITOR',
          sentAt: '2026-08-03T03:08:00.000Z',
          content: '想了解周界报警方案。'
        },
        {
          sender: 'AGENT',
          sentAt: '2026-08-03T03:09:00.000Z',
          content: '请问现场是否已有围墙？'
        }
      ]
    }
  });
  assert.equal(chat.conversation.messages.length, 2);
  assert.throws(
    () => normalizeDetail({
      ...redactedSummary,
      id: 'chat_redacted_002',
      sourceSystem: 'KF53',
      consultationType: 'ONLINE_CHAT',
      externalRecordUrl: null,
      conversation: {
        messages: [{
          sender: 'SYSTEM',
          sentAt: '2026-08-03T03:08:00.000Z',
          content: '窗口已打开'
        }]
      }
    }),
    /sender/u
  );
});

test('keeps website and 53KF source coverage independent', () => {
  const website = normalizeSourceStatus({
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    sourceState: 'AGGREGATE_ONLY',
    recordCoverage: 'NONE',
    reasonCode: 'WEBSITE_FORM_RECORD_API_UNVERIFIED'
  });
  const chat = normalizeSourceStatus({
    sourceSystem: 'KF53',
    consultationType: 'ONLINE_CHAT',
    sourceState: 'NOT_CONNECTED',
    recordCoverage: 'NONE',
    reasonCode: 'KF53_API_UNVERIFIED'
  });
  assert.equal(coverageState([website, chat]), 'NONE');
  assert.equal(coverageState([
    { ...website, sourceState: 'AVAILABLE', recordCoverage: 'FULL' },
    chat
  ]), 'PARTIAL');
  assert.throws(
    () => normalizeSourceStatus({
      sourceSystem: 'KF53',
      consultationType: 'ONLINE_CHAT',
      sourceState: 'NOT_CONNECTED',
      recordCoverage: 'PARTIAL',
      reasonCode: 'KF53_API_UNVERIFIED'
    }),
    /覆盖率不一致/u
  );
  assert.throws(
    () => normalizeSourceStatus({
      sourceSystem: 'GATO_WEBSITE',
      consultationType: 'WEBSITE_FORM',
      sourceState: 'PARTIAL',
      recordCoverage: 'PARTIAL',
      reasonCode: null
    }),
    /reasonCode/u
  );
});

test('bounds detail collection size before normalizing third-party payloads', () => {
  assert.throws(
    () => normalizeDetail({
      ...redactedSummary,
      externalRecordUrl: null,
      form: {
        content: '脱敏正文',
        fields: Array.from({ length: 101 }, (_, index) => ({
          label: `字段${index}`,
          value: '值'
        }))
      }
    }),
    /字段数量超限/u
  );
  assert.throws(
    () => normalizeDetail({
      ...redactedSummary,
      id: 'chat_redacted_oversized',
      sourceSystem: 'KF53',
      consultationType: 'ONLINE_CHAT',
      externalRecordUrl: null,
      conversation: {
        messages: Array.from({ length: 501 }, (_, index) => ({
          sender: index % 2 === 0 ? 'VISITOR' : 'AGENT',
          sentAt: '2026-08-03T03:08:00.000Z',
          content: '脱敏消息'
        }))
      }
    }),
    /消息数量超限/u
  );
});

test('redacts common structured identifiers from consultation free text', () => {
  const normalized = sanitizePublicText(
    '手机 138-1234-5678，座机 021-61234567，身份证 310101199001011234，QQ：12345678，微信号: gato_sales，地址：上海市某路 88 号',
    'content',
    1000
  );
  assert.doesNotMatch(
    normalized,
    /138-1234-5678|021-61234567|310101199001011234|12345678|gato_sales|上海市某路 88 号/u
  );
  assert.match(normalized, /已脱敏/u);
});

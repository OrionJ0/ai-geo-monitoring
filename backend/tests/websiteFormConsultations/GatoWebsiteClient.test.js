const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GatoWebsiteClient
} = require('../../modules/websiteFormConsultations/adapters/GatoWebsiteClient');

test('reads only attributed website form consultations from the aggregate dashboard', async () => {
  const calls = [];
  const transport = async (request) => {
    calls.push(request);
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/v1/auth/login') {
      return {
        status: 201,
        body: {
          data: {
            token: 'website-jwt-test'
          }
        }
      };
    }
    assert.equal(pathname, '/api/v1/admin/stats/dashboard');
    assert.equal(request.headers.Authorization, 'Bearer website-jwt-test');
    return {
      status: 200,
      body: {
        data: {
          conversion: {
            summary: {
              visit_sessions: 1103,
              contact_click_sessions: 34,
              submission_sessions: 3
            },
            source_channels: [
              { source: 'direct', visits: 470, clicks: 9, submissions: 2 },
              { source: 'organic_search', visits: 530, clicks: 20, submissions: 1 },
              { source: 'baidu_paid', visits: 60, clicks: 3, submissions: 0 }
            ]
          }
        }
      }
    };
  };
  const client = new GatoWebsiteClient({
    baseUrl: 'https://gato.com.cn',
    username: 'website-reader',
    password: 'secret-from-test-only',
    timeoutMs: 1000,
    transport
  });

  const result = await client.readFormConsultations({
    from: '2026-07-05',
    to: '2026-08-03'
  });

  assert.deepEqual(result, {
    attributedFormSubmissionSessions: '3',
    sourceBreakdown: [
      { upstreamSource: 'direct', attributedFormSubmissionSessions: '2' },
      { upstreamSource: 'organic_search', attributedFormSubmissionSessions: '1' },
      { upstreamSource: 'baidu_paid', attributedFormSubmissionSessions: '0' }
    ]
  });
  assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(result).includes('contact_click'), false);
  assert.equal(JSON.stringify(result).includes('visit_sessions'), false);
});

test('builds a bounded daily website-form series from aggregate-only reads', async () => {
  const dashboardDates = [];
  const client = new GatoWebsiteClient({
    baseUrl: 'https://gato.com.cn',
    username: 'website-reader',
    password: 'secret-from-test-only',
    timeoutMs: 1000,
    transport: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/auth/login') {
        return { status: 200, body: { data: { token: 'daily-jwt' } } };
      }
      const date = url.searchParams.get('start_date');
      assert.equal(url.searchParams.get('end_date'), date);
      dashboardDates.push(date);
      const submissions = date === '2026-08-02' ? 1 : 2;
      return {
        status: 200,
        body: {
          data: {
            conversion: {
              summary: { submission_sessions: submissions },
              source_channels: [
                { source: 'direct', submissions }
              ]
            }
          }
        }
      };
    }
  });

  const result = await client.readFormConsultationDays({
    from: '2026-08-01',
    to: '2026-08-02'
  });

  assert.deepEqual(dashboardDates, ['2026-08-01', '2026-08-02']);
  assert.deepEqual(result, {
    attributedFormSubmissionSessions: '3',
    sourceBreakdown: [
      { upstreamSource: 'direct', attributedFormSubmissionSessions: '3' }
    ],
    days: [
      {
        date: '2026-08-01',
        attributedFormSubmissionSessions: '2',
        sourceBreakdown: [
          { upstreamSource: 'direct', attributedFormSubmissionSessions: '2' }
        ]
      },
      {
        date: '2026-08-02',
        attributedFormSubmissionSessions: '1',
        sourceBreakdown: [
          { upstreamSource: 'direct', attributedFormSubmissionSessions: '1' }
        ]
      }
    ]
  });
});

test('re-authenticates once after an expired website token', async () => {
  let loginCount = 0;
  let dashboardCount = 0;
  const client = new GatoWebsiteClient({
    baseUrl: 'https://gato.com.cn',
    username: 'website-reader',
    password: 'secret-from-test-only',
    timeoutMs: 1000,
    transport: async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/api/v1/auth/login') {
        loginCount += 1;
        return {
          status: 200,
          body: { data: { token: `website-jwt-${loginCount}` } }
        };
      }
      dashboardCount += 1;
      if (dashboardCount === 1) return { status: 401, body: {} };
      assert.equal(request.headers.Authorization, 'Bearer website-jwt-2');
      return {
        status: 200,
        body: {
          data: {
            conversion: {
              summary: { submission_sessions: 0 },
              source_channels: []
            }
          }
        }
      };
    }
  });

  const result = await client.readFormConsultations({
    from: '2026-08-01',
    to: '2026-08-03'
  });

  assert.equal(result.attributedFormSubmissionSessions, '0');
  assert.equal(loginCount, 2);
  assert.equal(dashboardCount, 2);
});

test('uses the bounded HTTP transport against the two allowlisted website paths', async () => {
  const requests = [];
  const client = new GatoWebsiteClient({
    baseUrl: 'https://gato.com.cn',
    username: 'website-reader',
    password: 'secret-from-test-only',
    timeoutMs: 1000,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const pathname = new URL(url).pathname;
      if (pathname === '/api/v1/auth/login') {
        return new Response(JSON.stringify({ data: { token: 'fetch-jwt' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({
        data: {
          conversion: {
            summary: { submission_sessions: 1 },
            source_channels: [
              { source: 'direct', submissions: 1 }
            ]
          }
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  const result = await client.readFormConsultations({
    from: '2026-08-01',
    to: '2026-08-03'
  });

  assert.equal(result.attributedFormSubmissionSessions, '1');
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
    '/api/v1/auth/login',
    '/api/v1/admin/stats/dashboard'
  ]);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer fetch-jwt');
});

test('rejects a website client origin outside the official host', () => {
  assert.throws(() => new GatoWebsiteClient({
    baseUrl: 'https://attacker.example',
    username: 'website-reader',
    password: 'secret-from-test-only',
    timeoutMs: 1000,
    transport: async () => ({ status: 500, body: {} })
  }), {
    code: 'GATO_WEBSITE_FORM_CLIENT_CONFIG_INVALID',
    status: 500
  });
});

test('reads paginated website contact records and a detail through allowlisted GET paths', async () => {
  const calls = [];
  const client = new GatoWebsiteClient({
    baseUrl: 'https://gato.com.cn',
    username: 'website-reader',
    password: 'secret-from-test-only',
    timeoutMs: 1000,
    transport: async (request) => {
      calls.push(request);
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/auth/login') {
        return { status: 200, body: { data: { token: 'record-jwt' } } };
      }
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.Authorization, 'Bearer record-jwt');
      if (url.pathname === '/api/v1/admin/contact/list') {
        const page = Number(url.searchParams.get('page'));
        assert.equal(url.searchParams.get('startDate'), '2026-08-01');
        assert.equal(url.searchParams.get('endDate'), '2026-08-03');
        return {
          status: 200,
          body: {
            data: {
              list: page === 1 ? [{
                id: '91',
                name: '测试姓名',
                phone: '13812345678',
                email: 'person@example.com',
                demandType: '技术咨询',
                company: '测试企业',
                region: '上海',
                detail: '需要了解周界报警方案',
                sourceChannel: 'organic_search',
                firstSourceChannel: 'organic_search',
                referrer: 'https://cn.bing.com/',
                landingPage: '/',
                contactClickPage: 'https://gato.com.cn/',
                contactClickPosition: 'footer',
                utmSource: null,
                utmMedium: null,
                utmCampaign: null,
                bdVid: null,
                sdclkid: null,
                deviceType: 'desktop',
                status: 'pending',
                createdAt: '2026-08-03T03:08:00.000Z'
              }] : [],
              total: 1,
              page,
              pageSize: 100
            }
          }
        };
      }
      assert.equal(url.pathname, '/api/v1/admin/contact/91');
      return {
        status: 200,
        body: {
          data: {
            id: '91',
            name: '测试姓名',
            phone: '13812345678',
            email: 'person@example.com',
            demandType: '技术咨询',
            company: '测试企业',
            region: '上海',
            detail: '需要了解周界报警方案',
            sourceChannel: 'organic_search',
            firstSourceChannel: 'organic_search',
            referrer: 'https://cn.bing.com/',
            landingPage: '/',
            contactClickPage: 'https://gato.com.cn/',
            contactClickPosition: 'footer',
            utmSource: null,
            utmMedium: null,
            utmCampaign: null,
            bdVid: null,
            sdclkid: null,
            deviceType: 'desktop',
            status: 'pending',
            createdAt: '2026-08-03T03:08:00.000Z'
          }
        }
      };
    }
  });

  const records = await client.readContactRecords({
    from: '2026-08-01',
    to: '2026-08-03',
    maxRecords: 10000
  });
  const detail = await client.readContactRecord('91');

  assert.equal(records.length, 1);
  assert.equal(records[0].id, '91');
  assert.equal(records[0].sourceChannel, 'organic_search');
  assert.equal(records[0].referrer, 'https://cn.bing.com/');
  assert.equal(records[0].landingPage, '/');
  assert.equal(records[0].contactClickPage, 'https://gato.com.cn/');
  assert.equal(records[0].deviceType, 'desktop');
  assert.equal(detail.id, '91');
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/api/v1/auth/login',
    '/api/v1/admin/contact/list',
    '/api/v1/admin/contact/91'
  ]);
  assert.equal(calls.some((call) => call.json !== undefined), true);
});

test('reads exactly one bounded website contact page for internal pagination', async () => {
  const calls = [];
  const client = new GatoWebsiteClient({
    baseUrl: 'https://gato.com.cn',
    username: 'website-reader',
    password: 'secret-from-test-only',
    timeoutMs: 1000,
    transport: async (request) => {
      calls.push(request);
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/auth/login') {
        return { status: 200, body: { data: { token: 'record-page-jwt' } } };
      }
      assert.equal(url.pathname, '/api/v1/admin/contact/list');
      assert.equal(url.searchParams.get('page'), '3');
      assert.equal(url.searchParams.get('pageSize'), '25');
      return {
        status: 200,
        body: {
          data: {
            list: [],
            total: 50,
            page: 3,
            pageSize: 25
          }
        }
      };
    }
  });
  const result = await client.readContactRecordPage({
    from: '2026-08-01',
    to: '2026-08-03',
    page: 3,
    pageSize: 25
  });
  assert.deepEqual(result, { total: 50, records: [] });
  assert.equal(calls.length, 2);
});

test('rejects malformed website contact pagination without returning partial records', async () => {
  const client = new GatoWebsiteClient({
    baseUrl: 'https://gato.com.cn',
    username: 'website-reader',
    password: 'secret-from-test-only',
    timeoutMs: 1000,
    transport: async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/api/v1/auth/login') {
        return { status: 200, body: { data: { token: 'record-jwt' } } };
      }
      return {
        status: 200,
        body: {
          data: {
            list: [],
            total: 'not-an-integer',
            page: 1,
            pageSize: 100
          }
        }
      };
    }
  });

  await assert.rejects(
    client.readContactRecords({
      from: '2026-08-01',
      to: '2026-08-03',
      maxRecords: 10000
    }),
    (error) => error.code === 'GATO_WEBSITE_CONTACT_RESPONSE_INVALID'
      && error.status === 502
  );
});

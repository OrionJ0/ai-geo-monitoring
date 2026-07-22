const cheerio = require('cheerio');

const CATEGORY_DEFINITIONS = [
  { key: 'crawlability', label: '收录与抓取' },
  { key: 'metadata', label: '页面信息' },
  { key: 'content', label: '内容结构' },
  { key: 'experience', label: '移动与可访问性' },
  { key: 'structured', label: '结构化与分享' },
  { key: 'performance', label: '基础性能' }
];

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEARCH_VERIFICATION_TAGS = new Map([
  ['google-site-verification', 'Google Search Console'],
  ['msvalidate.01', 'Bing Webmaster Tools'],
  ['baidu-site-verification', '百度搜索资源平台'],
  ['360-site-verification', '360 站长平台'],
  ['sogou-site-verification', '搜狗资源平台'],
  ['yandex-verification', 'Yandex Webmaster']
]);

function normalizeWebsiteUrl(input) {
  const value = String(input || '').trim();
  if (!value) {
    const error = new Error('请输入需要检测的网址');
    error.code = 'INVALID_URL';
    error.status = 400;
    throw error;
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    const error = new Error('网址格式不正确');
    error.code = 'INVALID_URL';
    error.status = 400;
    throw error;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    const error = new Error('仅支持 HTTP 或 HTTPS 网站');
    error.code = 'UNSUPPORTED_PROTOCOL';
    error.status = 400;
    throw error;
  }
  url.hash = '';
  return url.toString();
}

function hasSkippedHeadingLevel($) {
  const levels = $('h1, h2, h3, h4, h5, h6')
    .map((_, element) => Number(element.tagName.slice(1)))
    .get();

  return levels.some((level, index) => index > 0 && level - levels[index - 1] > 1);
}

function createCheck({ id, category, title, finding, passed, severity, weight, value, description, recommendation }) {
  return {
    id,
    category,
    title,
    finding: finding || (passed ? '符合检查要求' : title),
    status: passed ? 'passed' : 'failed',
    severity,
    weight,
    value,
    description,
    recommendation: passed ? '' : recommendation
  };
}

function successfulResponse(result) {
  return result.statusCode >= 200 && result.statusCode < 300;
}

function analyzeRobots(result) {
  const body = String(result.body || '').trim();
  const statusValue = result.statusCode ? `HTTP ${result.statusCode}` : '无法访问';
  if (!successfulResponse(result)) {
    return { passed: false, finding: '未找到可用 robots.txt', value: statusValue };
  }
  if (!body) {
    return { passed: false, finding: 'robots.txt 内容为空', value: `${statusValue} · 0 条规则` };
  }

  const directives = body
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => /^(user-agent|allow|disallow|sitemap)\s*:/i.test(line));
  const hasUserAgent = directives.some((line) => /^user-agent\s*:\s*\S+/i.test(line));
  if (!hasUserAgent) {
    return { passed: false, finding: 'robots.txt 缺少有效规则', value: `${statusValue} · 未发现 User-agent` };
  }
  return { passed: true, finding: 'robots.txt 规则有效', value: `${statusValue} · ${directives.length} 条有效指令` };
}

function analyzeSitemap(result) {
  const body = String(result.body || '').trim();
  const statusValue = result.statusCode ? `HTTP ${result.statusCode}` : '无法访问';
  if (!successfulResponse(result)) {
    return { passed: false, finding: '未找到可用 Sitemap', value: statusValue };
  }
  if (!body) {
    return { passed: false, finding: 'Sitemap 内容为空', value: `${statusValue} · 0 个 URL` };
  }

  const xml = cheerio.load(body, { xmlMode: true });
  const isUrlSet = xml('urlset').length > 0;
  const isIndex = xml('sitemapindex').length > 0;
  const locs = (isUrlSet ? xml('urlset > url > loc') : xml('sitemapindex > sitemap > loc'))
    .map((_, element) => xml(element).text().trim())
    .get()
    .filter((value) => {
      try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    });
  if ((!isUrlSet && !isIndex) || locs.length === 0) {
    return { passed: false, finding: 'Sitemap 格式无效', value: `${statusValue} · 未发现有效 loc` };
  }
  return {
    passed: true,
    finding: isIndex ? 'Sitemap 索引有效' : 'Sitemap 内容有效',
    value: `${statusValue} · ${locs.length} 个${isIndex ? '子 Sitemap' : ' URL'}`
  };
}

function gradeFromScore(score) {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'needs_improvement';
  return 'poor';
}

function createSeoAuditService({ siteClient } = {}) {
  const client = siteClient || require('./SeoSiteClient');

  return {
    async audit(inputUrl) {
      const requestedUrl = normalizeWebsiteUrl(inputUrl);
      const response = await client.fetchPage(requestedUrl);
      const finalUrl = response.finalUrl || requestedUrl;
      const $ = cheerio.load(response.html || '');

      const titleElements = $('title');
      const title = titleElements.first().text().trim();
      const descriptionElements = $('meta[name="description"]');
      const description = descriptionElements.first().attr('content')?.trim() || '';
      const canonicalElements = $('link[rel="canonical"]');
      const canonical = canonicalElements.first().attr('href')?.trim() || '';
      const language = $('html').attr('lang')?.trim() || '';
      const viewport = $('meta[name="viewport"]').attr('content')?.trim() || '';
      const robotsMeta = $('meta[name="robots"]').attr('content')?.toLowerCase() || '';
      const xRobotsTag = String(response.headers?.['x-robots-tag'] || '').toLowerCase();
      const h1Elements = $('h1');
      const h1Count = h1Elements.length;
      const h1Texts = h1Elements.map((_, element) => $(element).text().trim()).get();
      const h2Count = $('h2').length;
      const h3Count = $('h3').length;
      const imageCount = $('img').length;
      const imagesWithAlt = $('img').filter((_, element) => {
        const alt = $(element).attr('alt');
        return typeof alt === 'string' && alt.trim().length > 0;
      }).length;
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      const contentCharacters = bodyText.replace(/\s/g, '').length;
      const links = $('a[href]').map((_, element) => $(element).attr('href')?.trim() || '').get();
      const crawlableLinks = links.filter((href) => href && !href.startsWith('#') && !/^javascript:/i.test(href));
      const internalLinks = crawlableLinks.filter((href) => {
        try {
          return new URL(href, finalUrl).origin === new URL(finalUrl).origin;
        } catch {
          return false;
        }
      }).length;
      const externalLinks = Math.max(0, crawlableLinks.length - internalLinks);
      const jsonLdElements = $('script[type="application/ld+json"]');
      const jsonLdBodies = jsonLdElements.map((_, element) => $(element).text().trim()).get();
      const validJsonLdCount = jsonLdBodies.filter((value) => {
        if (!value) return false;
        try {
          const parsed = JSON.parse(value);
          return Boolean(parsed && typeof parsed === 'object');
        } catch {
          return false;
        }
      }).length;
      const openGraph = {
        title: $('meta[property="og:title"]').attr('content')?.trim() || '',
        description: $('meta[property="og:description"]').attr('content')?.trim() || '',
        image: $('meta[property="og:image"]').attr('content')?.trim() || ''
      };
      const twitterCard = $('meta[name="twitter:card"]').attr('content')?.trim() || '';
      const htmlBytes = Buffer.byteLength(response.html || '', 'utf8');
      const verificationTags = $('meta[name]').map((_, element) => {
        const name = ($(element).attr('name') || '').trim().toLowerCase();
        if (!SEARCH_VERIFICATION_TAGS.has(name)) return null;
        return {
          platform: SEARCH_VERIFICATION_TAGS.get(name),
          content: ($(element).attr('content') || '').trim()
        };
      }).get();
      const validVerificationPlatforms = [...new Set(verificationTags.filter((tag) => tag.content).map((tag) => tag.platform))];
      const emptyVerificationPlatforms = [...new Set(verificationTags.filter((tag) => !tag.content).map((tag) => tag.platform))];
      const verificationPassed = validVerificationPlatforms.length > 0 && emptyVerificationPlatforms.length === 0;
      const verificationFinding = verificationTags.length === 0 ? '未发现搜索平台验证标签'
        : validVerificationPlatforms.length === 0 ? '搜索平台验证标签为空'
          : emptyVerificationPlatforms.length > 0 ? '部分搜索平台验证标签为空'
            : `发现 ${validVerificationPlatforms.length} 个搜索平台验证标签`;
      const verificationValue = [
        validVerificationPlatforms.length ? `已发现：${validVerificationPlatforms.join('、')}` : '',
        emptyVerificationPlatforms.length ? `空值：${emptyVerificationPlatforms.join('、')}` : ''
      ].filter(Boolean).join(' · ') || '页面源码中未发现已知验证标签';
      const titlePassed = title.length >= 10 && title.length <= 60;
      const titleFinding = titleElements.length === 0 ? '缺少页面标题'
        : !title ? '页面标题为空'
          : title.length < 10 ? '页面标题过短'
            : title.length > 60 ? '页面标题过长' : '页面标题长度合理';
      const descriptionPassed = description.length >= 50 && description.length <= 160;
      const descriptionFinding = descriptionElements.length === 0 ? 'Meta 描述缺失'
        : !description ? 'Meta 描述为空'
          : description.length < 50 ? 'Meta 描述过短'
            : description.length > 160 ? 'Meta 描述过长' : 'Meta 描述长度合理';
      let canonicalIsValid = false;
      if (canonical) {
        try {
          canonicalIsValid = ['http:', 'https:'].includes(new URL(canonical, finalUrl).protocol);
        } catch {
          canonicalIsValid = false;
        }
      }
      const canonicalFinding = canonicalElements.length === 0 ? 'Canonical 链接缺失'
        : !canonical ? 'Canonical 链接为空'
          : !canonicalIsValid ? 'Canonical 链接无效' : 'Canonical 链接有效';
      const h1Passed = h1Count === 1 && Boolean(h1Texts[0]);
      const h1Finding = h1Count === 0 ? '缺少 H1'
        : h1Count > 1 ? '存在多个 H1'
          : !h1Texts[0] ? 'H1 内容为空' : 'H1 数量与内容有效';
      const jsonLdPassed = jsonLdElements.length > 0 && validJsonLdCount === jsonLdElements.length;
      const jsonLdFinding = jsonLdElements.length === 0 ? 'JSON-LD 结构化数据缺失'
        : jsonLdBodies.every((value) => !value) ? 'JSON-LD 内容为空'
          : validJsonLdCount === 0 ? 'JSON-LD 格式无效'
            : validJsonLdCount < jsonLdElements.length ? '部分 JSON-LD 无效' : 'JSON-LD 内容有效';
      const openGraphEntries = [
        ['og:title', openGraph.title],
        ['og:description', openGraph.description],
        ['og:image', openGraph.image]
      ];
      const validOpenGraphCount = openGraphEntries.filter(([, value]) => Boolean(value)).length;
      const openGraphElementsCount = $('meta[property="og:title"], meta[property="og:description"], meta[property="og:image"]').length;
      const openGraphFinding = validOpenGraphCount === 3 ? 'Open Graph 信息完整'
        : openGraphElementsCount > 0 && validOpenGraphCount === 0 ? 'Open Graph 标签内容为空'
          : 'Open Graph 信息不完整';

      const origin = new URL(finalUrl).origin;
      const [robotsResult, sitemapResult] = await Promise.all([
        client.probe(`${origin}/robots.txt`).catch(() => ({ statusCode: 0, body: '' })),
        client.probe(`${origin}/sitemap.xml`).catch(() => ({ statusCode: 0, body: '' }))
      ]);
      const robotsAnalysis = analyzeRobots(robotsResult);
      const defaultSitemapUrl = `${origin}/sitemap.xml`;
      const declaredSitemapUrls = [...String(robotsResult.body || '').matchAll(/^sitemap\s*:\s*(\S+)/gim)]
        .map((match) => match[1])
        .filter((value, index, values) => {
          try {
            const parsed = new URL(value);
            return ['http:', 'https:'].includes(parsed.protocol)
              && parsed.toString() !== defaultSitemapUrl
              && values.indexOf(value) === index;
          } catch {
            return false;
          }
        })
        .slice(0, 3);
      const declaredSitemapResults = await Promise.all(declaredSitemapUrls.map(async (url) => ({
        url,
        result: await client.probe(url).catch(() => ({ statusCode: 0, body: '' }))
      })));
      const sitemapCandidates = [
        { url: defaultSitemapUrl, result: sitemapResult },
        ...declaredSitemapResults
      ].map((candidate) => ({ ...candidate, analysis: analyzeSitemap(candidate.result) }));
      const selectedSitemap = sitemapCandidates.find((candidate) => candidate.analysis.passed)
        || sitemapCandidates.find((candidate) => successfulResponse(candidate.result))
        || sitemapCandidates[0];
      const sitemapAnalysis = {
        ...selectedSitemap.analysis,
        value: `${selectedSitemap.analysis.value} · ${new URL(selectedSitemap.url).pathname}`
      };
      const checks = [
        createCheck({
          id: 'http-status', category: 'crawlability', title: '页面访问状态',
          passed: response.statusCode >= 200 && response.statusCode < 300,
          finding: response.statusCode >= 200 && response.statusCode < 300
            ? '页面返回成功状态' : `页面返回 HTTP ${response.statusCode}`,
          severity: 'critical', weight: 14, value: `HTTP ${response.statusCode}`,
          description: '搜索引擎需要获得成功的 HTTP 响应才能读取页面。',
          recommendation: '修复服务器错误或重定向链，确保目标页面直接返回 2xx。'
        }),
        createCheck({
          id: 'indexability', category: 'crawlability', title: '索引指令',
          passed: !robotsMeta.includes('noindex') && !xRobotsTag.includes('noindex'),
          finding: robotsMeta.includes('noindex') || xRobotsTag.includes('noindex')
            ? '页面设置了 noindex' : '未发现 noindex',
          severity: 'critical', weight: 14,
          value: robotsMeta || xRobotsTag || '未发现 noindex',
          description: 'noindex 指令会阻止搜索引擎把页面加入索引。',
          recommendation: '如果页面需要获得自然搜索流量，请移除 noindex 指令。'
        }),
        createCheck({
          id: 'https', category: 'crawlability', title: 'HTTPS',
          passed: new URL(finalUrl).protocol === 'https:', severity: 'high', weight: 7,
          finding: new URL(finalUrl).protocol === 'https:' ? '页面使用 HTTPS' : '页面仍使用 HTTP',
          value: new URL(finalUrl).protocol.replace(':', '').toUpperCase(),
          description: 'HTTPS 保护传输安全，也是现代搜索与浏览器体验的基础。',
          recommendation: '配置有效证书，并将 HTTP 永久重定向到 HTTPS。'
        }),
        createCheck({
          id: 'robots-txt', category: 'crawlability', title: 'robots.txt',
          passed: robotsAnalysis.passed, finding: robotsAnalysis.finding,
          severity: 'high', weight: 7, value: robotsAnalysis.value,
          description: 'robots.txt 用于声明搜索引擎抓取规则。',
          recommendation: '在网站根目录提供可访问的 robots.txt，并检查是否误封重要路径。'
        }),
        createCheck({
          id: 'sitemap', category: 'crawlability', title: 'Sitemap.xml',
          passed: sitemapAnalysis.passed, finding: sitemapAnalysis.finding,
          severity: 'medium', weight: 4, value: sitemapAnalysis.value,
          description: '站点地图帮助搜索引擎发现重要页面。',
          recommendation: '提供 sitemap.xml，并在 robots.txt 中声明其完整地址。'
        }),
        createCheck({
          id: 'search-verification', category: 'crawlability', title: '搜索平台验证标签',
          passed: verificationPassed, finding: verificationFinding,
          severity: 'low', weight: 1, value: verificationValue,
          description: '这里只检查首页 HTML 验证标签；标签存在不能证明平台后台当前已验证，DNS 或验证文件方式也无法从页面判断。',
          recommendation: '如尚未验证站点，可按目标搜索平台要求配置 HTML 标签、验证文件或 DNS 记录。'
        }),
        createCheck({
          id: 'title', category: 'metadata', title: '页面标题', finding: titleFinding,
          passed: titlePassed, severity: 'high', weight: 8,
          value: `标题长度：${title.length} 字符${title ? ` · ${title}` : ''}`,
          description: '标题用于概括页面主题，并常作为搜索结果标题。',
          recommendation: title ? '将标题调整为 10–60 个字符，并自然包含页面核心主题。' : '添加唯一且能准确概括页面主题的 title。'
        }),
        createCheck({
          id: 'meta-description', category: 'metadata', title: 'Meta 描述', finding: descriptionFinding,
          passed: descriptionPassed, severity: 'high', weight: 8,
          value: `描述长度：${description.length} 字符`,
          description: '描述常用于搜索结果摘要，影响用户是否点击。',
          recommendation: description ? '将描述调整为 50–160 个字符，清楚说明页面价值。' : '添加 50–160 个字符的独特页面描述。'
        }),
        createCheck({
          id: 'canonical', category: 'metadata', title: 'Canonical 链接', finding: canonicalFinding,
          passed: canonicalIsValid, severity: 'medium', weight: 4,
          value: canonical || '未检测到有效 URL',
          description: 'Canonical 帮助搜索引擎识别重复页面中的规范版本。',
          recommendation: '添加指向当前规范页面的 rel="canonical" 链接。'
        }),
        createCheck({
          id: 'h1', category: 'content', title: '标题结构', finding: h1Finding,
          passed: h1Passed, severity: 'high', weight: 8, value: `H1：${h1Count} 个 · H2：${h2Count} 个 · H3：${h3Count} 个`,
          description: 'H1 应清晰表达页面最重要的主题。',
          recommendation: h1Count === 0 || !h1Texts.some(Boolean)
            ? '添加一个包含明确页面主题的非空 H1。'
            : '保留一个主 H1，其余标题改为 H2–H6。'
        }),
        createCheck({
          id: 'heading-order', category: 'content', title: '标题层级',
          passed: !hasSkippedHeadingLevel($), severity: 'medium', weight: 4,
          finding: hasSkippedHeadingLevel($) ? '标题层级存在跳级' : '标题层级连续',
          value: `${$('h1, h2, h3, h4, h5, h6').length} 个标题`,
          description: '连续的标题层级让用户和搜索引擎更容易理解内容结构。',
          recommendation: '按 H1 → H2 → H3 的层级组织内容，避免跳级。'
        }),
        createCheck({
          id: 'content-depth', category: 'content', title: '正文信息量',
          passed: contentCharacters >= 300, severity: 'low', weight: 2,
          finding: contentCharacters >= 300 ? '正文信息量达到基础范围' : '页面正文内容较少',
          value: `${contentCharacters} 个正文字符`,
          description: '过短内容通常无法完整回答用户问题。',
          recommendation: '补充原创、具体且能解决搜索意图的正文内容。'
        }),
        createCheck({
          id: 'crawlable-links', category: 'content', title: '页面链接',
          passed: crawlableLinks.length > 0, severity: 'low', weight: 2,
          finding: crawlableLinks.length > 0 ? '页面包含可抓取链接' : '未发现可抓取链接',
          value: `内链 ${internalLinks} · 外链 ${externalLinks}`,
          description: '有效链接帮助用户和搜索引擎发现相关内容。',
          recommendation: '添加指向重要相关页面的标准 href 链接。'
        }),
        createCheck({
          id: 'viewport', category: 'experience', title: '移动端 Viewport',
          passed: /width\s*=\s*device-width/i.test(viewport), severity: 'high', weight: 7,
          finding: /width\s*=\s*device-width/i.test(viewport) ? 'Viewport 配置有效' : 'Viewport 配置缺失或无效',
          value: viewport || '未设置',
          description: 'Viewport 是页面正确适配移动设备的基础。',
          recommendation: '添加 width=device-width, initial-scale=1 的 viewport。'
        }),
        createCheck({
          id: 'image-alt', category: 'experience', title: '图片 Alt',
          finding: imageCount === 0 ? '页面没有需要描述的图片'
            : imagesWithAlt === imageCount ? '所有图片均有有效 Alt' : `${imageCount - imagesWithAlt} 张图片缺少有效 Alt`,
          passed: imageCount === 0 || imagesWithAlt === imageCount, severity: 'medium', weight: 5,
          value: `图片总数：${imageCount} 张 · 有效 Alt：${imagesWithAlt} 张`,
          description: 'Alt 文本帮助搜索引擎和屏幕阅读器理解图片。',
          recommendation: `为缺少 alt 的 ${imageCount - imagesWithAlt} 张图片补充准确描述。`
        }),
        createCheck({
          id: 'language', category: 'experience', title: '页面语言',
          passed: Boolean(language), severity: 'medium', weight: 4,
          finding: language ? '页面语言已声明' : '页面语言声明缺失',
          value: language || '未设置',
          description: 'lang 属性帮助搜索引擎和辅助技术识别页面语言。',
          recommendation: '在 html 元素上添加准确的 lang 属性。'
        }),
        createCheck({
          id: 'structured-data', category: 'structured', title: 'JSON-LD 结构化数据', finding: jsonLdFinding,
          passed: jsonLdPassed, severity: 'medium', weight: 5,
          value: `标签总数：${jsonLdElements.length} 个 · 有效：${validJsonLdCount} 个`,
          description: '结构化数据能更明确地描述组织、产品和内容实体。',
          recommendation: '按页面类型添加有效的 Schema.org JSON-LD。'
        }),
        createCheck({
          id: 'open-graph', category: 'structured', title: 'Open Graph', finding: openGraphFinding,
          passed: validOpenGraphCount === 3, severity: 'low', weight: 3,
          value: `有效字段：${validOpenGraphCount}/3 · ${openGraphEntries.filter(([, value]) => !value).map(([name]) => name).join('、') || '无缺失'}`,
          description: 'Open Graph 控制页面在社交平台分享时的标题、描述和图片。',
          recommendation: '补全 og:title、og:description 和 og:image。'
        }),
        createCheck({
          id: 'twitter-card', category: 'structured', title: 'Twitter Card',
          passed: Boolean(twitterCard), severity: 'low', weight: 2,
          finding: twitterCard ? 'Twitter Card 已配置' : 'Twitter Card 缺失或为空',
          value: twitterCard || '未设置',
          description: 'Twitter Card 改善链接在 X 等平台中的分享展示。',
          recommendation: '添加 twitter:card，并复用合适的分享标题、描述和图片。'
        }),
        createCheck({
          id: 'response-time', category: 'performance', title: '服务器响应时间',
          passed: response.durationMs <= 2000, severity: 'medium', weight: 5,
          finding: response.durationMs <= 2000 ? '服务器响应及时' : '服务器响应偏慢',
          value: `${response.durationMs} ms`,
          description: '较慢的服务器响应会拖累页面加载和抓取效率。',
          recommendation: '优化服务器处理、缓存和网络链路，将响应控制在 2 秒内。'
        }),
        createCheck({
          id: 'html-size', category: 'performance', title: 'HTML 体积',
          passed: htmlBytes <= 500 * 1024, severity: 'medium', weight: 4,
          finding: htmlBytes <= 500 * 1024 ? 'HTML 体积适中' : 'HTML 体积偏大',
          value: `${Math.max(1, Math.round(htmlBytes / 1024))} KB`,
          description: '过大的 HTML 会增加下载、解析和抓取成本。',
          recommendation: '减少冗余标记和内联数据，将 HTML 控制在 500 KB 内。'
        })
      ];

      const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
      const passedWeight = checks.filter((check) => check.status === 'passed').reduce((sum, check) => sum + check.weight, 0);
      const score = Math.round((passedWeight / totalWeight) * 100);
      const issues = checks.filter((check) => check.status === 'failed');
      const categories = CATEGORY_DEFINITIONS.map((definition) => {
        const categoryChecks = checks
          .filter((check) => check.category === definition.key)
          .sort((a, b) => Number(a.status === 'passed') - Number(b.status === 'passed') || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
        const weight = categoryChecks.reduce((sum, check) => sum + check.weight, 0);
        const categoryPassedWeight = categoryChecks.filter((check) => check.status === 'passed').reduce((sum, check) => sum + check.weight, 0);
        return { ...definition, score: Math.round((categoryPassedWeight / weight) * 100), checks: categoryChecks };
      });

      return {
        requestedUrl,
        finalUrl,
        checkedAt: new Date().toISOString(),
        statusCode: response.statusCode,
        durationMs: response.durationMs,
        score,
        grade: gradeFromScore(score),
        summary: {
          total: checks.length,
          passed: checks.length - issues.length,
          issues: issues.length,
          critical: issues.filter((check) => check.severity === 'critical').length,
          high: issues.filter((check) => check.severity === 'high').length,
          medium: issues.filter((check) => check.severity === 'medium').length,
          low: issues.filter((check) => check.severity === 'low').length
        },
        page: {
          title,
          description,
          canonical,
          language,
          h1Count,
          imageCount,
          imagesWithAlt,
          internalLinks,
          externalLinks,
          htmlBytes
        },
        previews: {
          search: { title: title || finalUrl, description, url: finalUrl },
          social: {
            title: openGraph.title || title || finalUrl,
            description: openGraph.description || description,
            image: openGraph.image,
            url: finalUrl
          }
        },
        priorities: issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.weight - a.weight),
        categories
      };
    }
  };
}

module.exports = { createSeoAuditService, normalizeWebsiteUrl };

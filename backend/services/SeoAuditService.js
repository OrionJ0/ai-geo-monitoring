const cheerio = require('cheerio');
const {
  defaultSeoAuditRules,
  defaultSeoHealthScoreConfig,
  validateSeoAuditRules,
  validateSeoHealthScoreConfig
} = require('../config/seoAuditRules');
const { evaluateCrawlerAccess } = require('./RobotsAccessService');
const {
  calculateTechnicalHealth,
  detectTechnicalHealthBlockers
} = require('./SeoHealthScoreService');
const { isPrivateAuditAddress } = require('./SeoSiteClient');

const CATEGORY_DEFINITIONS = [
  { key: 'crawlability', label: '收录与抓取' },
  { key: 'metadata', label: '页面信息' },
  { key: 'content', label: '内容结构' },
  { key: 'experience', label: '移动与可访问性' },
  { key: 'structured', label: '结构化与分享' },
  { key: 'performance', label: '基础性能' }
];

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEARCH_VERIFICATION_PLATFORMS = Object.freeze([
  { key: 'google', label: 'Google Search Console', tag: 'google-site-verification' },
  { key: 'bing', label: 'Bing Webmaster Tools', tag: 'msvalidate.01' },
  { key: 'baidu', label: '百度搜索资源平台', tag: 'baidu-site-verification' }
]);

function normalizeWebsiteUrl(input) {
  const value = String(input || '').trim();
  if (!value) {
    const error = new Error('请输入需要检测的网址');
    error.code = 'INVALID_URL';
    error.status = 400;
    throw error;
  }

  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  let defaultProtocol = 'https';
  if (!hasProtocol) {
    try {
      const hostname = new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
      if (hostname === 'localhost' || isPrivateAuditAddress(hostname)) {
        defaultProtocol = 'http';
      }
    } catch {
      // Keep the public default; the normal URL parser below returns the user-facing error.
    }
  }
  const withProtocol = hasProtocol ? value : `${defaultProtocol}://${value}`;
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

function buildCheck({ id, category, title, finding, passed, severity, weight, value, description, recommendation }) {
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

function createSeoAuditService({
  siteClient,
  ruleConfig = defaultSeoAuditRules,
  scoreConfig = defaultSeoHealthScoreConfig
} = {}) {
  const client = siteClient || require('./SeoSiteClient');
  const rules = validateSeoAuditRules(ruleConfig);
  const scoring = validateSeoHealthScoreConfig(scoreConfig, rules);
  const thresholds = rules.thresholds;
  const createCheck = (input) => {
    const configuredRule = rules.checks[input.id];
    if (!configuredRule) throw new Error(`SEO 规则配置缺少检查项 ${input.id}`);
    return buildCheck({ ...input, ...configuredRule });
  };

  return {
    async audit(inputUrl) {
      const requestedUrl = normalizeWebsiteUrl(inputUrl);
      const response = await client.fetchPage(requestedUrl);
      const finalUrl = response.finalUrl || requestedUrl;
      const $ = cheerio.load(response.html || '');
      const origin = new URL(finalUrl).origin;
      const homepageUrl = `${origin}/`;
      let homepageHtml = response.html || '';
      if (new URL(finalUrl).pathname !== '/') {
        try {
          const homepageResponse = await client.fetchPage(homepageUrl);
          homepageHtml = homepageResponse.html || '';
        } catch {
          homepageHtml = '';
        }
      }

      const titleElements = $('title');
      const title = titleElements.first().text().trim();
      const descriptionElements = $('meta[name="description"]');
      const description = descriptionElements.first().attr('content')?.trim() || '';
      const keywordsElements = $('meta[name="keywords"]');
      const keywordsContent = keywordsElements.first().attr('content')?.trim() || '';
      const keywords = keywordsContent.split(/[,，;；]/).map((value) => value.trim()).filter(Boolean);
      const normalizedKeywords = keywords.map((value) => value.toLocaleLowerCase());
      const hasDuplicateKeywords = new Set(normalizedKeywords).size !== normalizedKeywords.length;
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
      const homepage = cheerio.load(homepageHtml);
      const platforms = SEARCH_VERIFICATION_PLATFORMS.map((platform) => {
        const element = homepage(`meta[name="${platform.tag}"]`).first();
        const isPresent = element.length > 0;
        const content = element.attr('content')?.trim() || '';
        return {
          ...platform,
          status: !isPresent ? 'missing' : content ? 'detected' : 'empty',
          content,
          sourceUrl: homepageUrl
        };
      });
      const detectedPlatforms = platforms.filter((platform) => platform.status === 'detected');
      const emptyPlatforms = platforms.filter((platform) => platform.status === 'empty');
      const verificationPassed = detectedPlatforms.length === SEARCH_VERIFICATION_PLATFORMS.length;
      const verificationFinding = verificationPassed ? 'Google、Bing、百度验证标签完整'
        : detectedPlatforms.length === 0 && emptyPlatforms.length === 0 ? '未发现 Google、Bing、百度验证标签'
          : emptyPlatforms.length > 0 ? '部分搜索平台验证标签为空' : '部分搜索平台验证标签缺失';
      const verificationValue = platforms
        .map((platform) => `${platform.label}：${platform.status === 'detected' ? '已检测到' : platform.status === 'empty' ? '空值' : '缺失'}`)
        .join(' · ');
      const titlePassed = title.length >= thresholds.titleMinCharacters && title.length <= thresholds.titleMaxCharacters;
      const titleFinding = titleElements.length === 0 ? '缺少页面标题'
        : !title ? '页面标题为空'
          : title.length < thresholds.titleMinCharacters ? '页面标题过短'
            : title.length > thresholds.titleMaxCharacters ? '页面标题过长' : '页面标题长度合理';
      const descriptionPassed = description.length >= thresholds.descriptionMinCharacters
        && description.length <= thresholds.descriptionMaxCharacters;
      const descriptionFinding = descriptionElements.length === 0 ? 'Meta 描述缺失'
        : !description ? 'Meta 描述为空'
          : description.length < thresholds.descriptionMinCharacters ? 'Meta 描述过短'
            : description.length > thresholds.descriptionMaxCharacters ? 'Meta 描述过长' : 'Meta 描述长度合理';
      const keywordsPassed = keywordsElements.length > 0
        && keywords.length > 0
        && keywords.length <= thresholds.keywordsMaxItems
        && !hasDuplicateKeywords;
      const keywordsFinding = keywordsElements.length === 0 ? 'Keywords 标签缺失'
        : !keywordsContent || keywords.length === 0 ? 'Keywords 标签内容为空'
          : hasDuplicateKeywords ? 'Keywords 标签包含重复词'
            : keywords.length > thresholds.keywordsMaxItems ? 'Keywords 标签关键词过多' : 'Keywords 标签内容有效';
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

      const [robotsResult, sitemapResult] = await Promise.all([
        client.probe(`${origin}/robots.txt`).catch(() => ({ statusCode: 0, body: '' })),
        client.probe(`${origin}/sitemap.xml`).catch(() => ({ statusCode: 0, body: '' }))
      ]);
      const robotsAnalysis = analyzeRobots(robotsResult);
      const crawlerAccess = evaluateCrawlerAccess({
        robotsResult,
        targetUrl: finalUrl,
        profiles: rules.crawlerProfiles
      });
      const scoringCrawlers = crawlerAccess.crawlers.filter((crawler) => crawler.affectsScore);
      const blockedScoringCrawlers = scoringCrawlers.filter((crawler) => crawler.status === 'blocked');
      const unknownScoringCrawlers = scoringCrawlers.filter((crawler) => crawler.status === 'unknown');
      const crawlerAccessFinding = crawlerAccess.passed
        ? '重要搜索与 AI 抓取 UA 均被 robots.txt 允许'
        : blockedScoringCrawlers.length
          ? `${blockedScoringCrawlers.length} 个重要搜索或 AI 抓取 UA 被 robots.txt 禁止`
          : `无法确认 ${unknownScoringCrawlers.length} 个重要搜索或 AI 抓取 UA 的 robots 权限`;
      const crawlerAccessValue = [
        `计分 UA：${scoringCrawlers.length} 个`,
        `允许：${scoringCrawlers.filter((crawler) => crawler.status === 'allowed').length} 个`,
        `禁止：${blockedScoringCrawlers.length} 个`,
        `无法判断：${unknownScoringCrawlers.length} 个`
      ].join(' · ');
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
          value: `HTTP ${response.statusCode}`,
          description: '搜索引擎需要获得成功的 HTTP 响应才能读取页面。',
          recommendation: '修复服务器错误或重定向链，确保目标页面直接返回 2xx。'
        }),
        createCheck({
          id: 'indexability', category: 'crawlability', title: '索引指令',
          passed: !robotsMeta.includes('noindex') && !xRobotsTag.includes('noindex'),
          finding: robotsMeta.includes('noindex') || xRobotsTag.includes('noindex')
            ? '页面设置了 noindex' : '未发现 noindex',
          value: robotsMeta || xRobotsTag || '未发现 noindex',
          description: 'noindex 指令会阻止搜索引擎把页面加入索引。',
          recommendation: '如果页面需要获得自然搜索流量，请移除 noindex 指令。'
        }),
        createCheck({
          id: 'https', category: 'crawlability', title: 'HTTPS',
          passed: new URL(finalUrl).protocol === 'https:',
          finding: new URL(finalUrl).protocol === 'https:' ? '页面使用 HTTPS' : '页面仍使用 HTTP',
          value: new URL(finalUrl).protocol.replace(':', '').toUpperCase(),
          description: 'HTTPS 保护传输安全，也是现代搜索与浏览器体验的基础。',
          recommendation: '配置有效证书，并将 HTTP 永久重定向到 HTTPS。'
        }),
        createCheck({
          id: 'robots-txt', category: 'crawlability', title: 'robots.txt',
          passed: robotsAnalysis.passed, finding: robotsAnalysis.finding,
          value: robotsAnalysis.value,
          description: 'robots.txt 用于声明搜索引擎抓取规则。',
          recommendation: '在网站根目录提供可访问的 robots.txt，并检查是否误封重要路径。'
        }),
        createCheck({
          id: 'crawler-access', category: 'crawlability', title: '搜索与 AI 爬虫权限',
          passed: crawlerAccess.passed, finding: crawlerAccessFinding,
          value: crawlerAccessValue,
          description: '按当前页面路径解析 robots.txt 中各 UA 的抓取声明；允许不等于一定收录或引用，也不能证明 WAF、登录和 IP 策略已放行真实爬虫。',
          recommendation: blockedScoringCrawlers.length
            ? `检查并放行 ${blockedScoringCrawlers.map((crawler) => crawler.label).join('、')} 对当前路径的 robots 规则。`
            : '修复 robots.txt 的访问或格式问题，再确认重要搜索与 AI 搜索爬虫的路径权限。'
        }),
        createCheck({
          id: 'sitemap', category: 'crawlability', title: 'Sitemap.xml',
          passed: sitemapAnalysis.passed, finding: sitemapAnalysis.finding,
          value: sitemapAnalysis.value,
          description: '站点地图帮助搜索引擎发现重要页面。',
          recommendation: '提供 sitemap.xml，并在 robots.txt 中声明其完整地址。'
        }),
        createCheck({
          id: 'search-verification', category: 'crawlability', title: '搜索平台验证标签',
          passed: verificationPassed, finding: verificationFinding,
          value: verificationValue,
          description: '这里只检查站点首页的 Google、Bing、百度 HTML 验证标签；标签存在不能证明平台后台当前已验证。',
          recommendation: '在站点首页配置三个目标搜索平台提供的非空 HTML 验证标签。'
        }),
        createCheck({
          id: 'title', category: 'metadata', title: '页面标题', finding: titleFinding,
          passed: titlePassed,
          value: `标题长度：${title.length} 字符${title ? ` · ${title}` : ''}`,
          description: '标题用于概括页面主题，并常作为搜索结果标题。',
          recommendation: title ? '将标题调整为 10–60 个字符，并自然包含页面核心主题。' : '添加唯一且能准确概括页面主题的 title。'
        }),
        createCheck({
          id: 'meta-description', category: 'metadata', title: 'Meta 描述', finding: descriptionFinding,
          passed: descriptionPassed,
          value: `描述长度：${description.length} 字符`,
          description: '描述常用于搜索结果摘要，影响用户是否点击。',
          recommendation: description ? '将描述调整为 50–160 个字符，清楚说明页面价值。' : '添加 50–160 个字符的独特页面描述。'
        }),
        createCheck({
          id: 'meta-keywords', category: 'metadata', title: 'Keywords 标签', finding: keywordsFinding,
          passed: keywordsPassed,
          value: `${keywords.length} 个关键词${keywords.length ? ` · ${keywords.join('、')}` : ''}`,
          description: 'Keywords 是面向部分平台和传统工具的辅助元信息，Google 与 Bing 不把它作为直接排名加分项。',
          recommendation: hasDuplicateKeywords
            ? '删除重复关键词，保留少量与页面正文一致的主题词。'
            : '如需兼容百度及站长工具，可填写少量与页面正文一致的关键词，避免堆砌。'
        }),
        createCheck({
          id: 'canonical', category: 'metadata', title: 'Canonical 链接', finding: canonicalFinding,
          passed: canonicalIsValid,
          value: canonical || '未检测到有效 URL',
          description: 'Canonical 帮助搜索引擎识别重复页面中的规范版本。',
          recommendation: '添加指向当前规范页面的 rel="canonical" 链接。'
        }),
        createCheck({
          id: 'h1', category: 'content', title: '标题结构', finding: h1Finding,
          passed: h1Passed, value: `H1：${h1Count} 个 · H2：${h2Count} 个 · H3：${h3Count} 个`,
          description: 'H1 应清晰表达页面最重要的主题。',
          recommendation: h1Count === 0 || !h1Texts.some(Boolean)
            ? '添加一个包含明确页面主题的非空 H1。'
            : '保留一个主 H1，其余标题改为 H2–H6。'
        }),
        createCheck({
          id: 'heading-order', category: 'content', title: '标题层级',
          passed: !hasSkippedHeadingLevel($),
          finding: hasSkippedHeadingLevel($) ? '标题层级存在跳级' : '标题层级连续',
          value: `${$('h1, h2, h3, h4, h5, h6').length} 个标题`,
          description: '连续的标题层级让用户和搜索引擎更容易理解内容结构。',
          recommendation: '按 H1 → H2 → H3 的层级组织内容，避免跳级。'
        }),
        createCheck({
          id: 'content-depth', category: 'content', title: '正文信息量',
          passed: contentCharacters >= thresholds.contentMinCharacters,
          finding: contentCharacters >= thresholds.contentMinCharacters ? '正文信息量达到基础范围' : '页面正文内容较少',
          value: `${contentCharacters} 个正文字符`,
          description: '过短内容通常无法完整回答用户问题。',
          recommendation: '补充原创、具体且能解决搜索意图的正文内容。'
        }),
        createCheck({
          id: 'crawlable-links', category: 'content', title: '页面链接',
          passed: crawlableLinks.length > 0,
          finding: crawlableLinks.length > 0 ? '页面包含可抓取链接' : '未发现可抓取链接',
          value: `内链 ${internalLinks} · 外链 ${externalLinks}`,
          description: '有效链接帮助用户和搜索引擎发现相关内容。',
          recommendation: '添加指向重要相关页面的标准 href 链接。'
        }),
        createCheck({
          id: 'viewport', category: 'experience', title: '移动端 Viewport',
          passed: /width\s*=\s*device-width/i.test(viewport),
          finding: /width\s*=\s*device-width/i.test(viewport) ? 'Viewport 配置有效' : 'Viewport 配置缺失或无效',
          value: viewport || '未设置',
          description: 'Viewport 是页面正确适配移动设备的基础。',
          recommendation: '添加 width=device-width, initial-scale=1 的 viewport。'
        }),
        createCheck({
          id: 'image-alt', category: 'experience', title: '图片 Alt',
          finding: imageCount === 0 ? '页面没有需要描述的图片'
            : imagesWithAlt === imageCount ? '所有图片均有有效 Alt' : `${imageCount - imagesWithAlt} 张图片缺少有效 Alt`,
          passed: imageCount === 0 || imagesWithAlt === imageCount,
          value: `图片总数：${imageCount} 张 · 有效 Alt：${imagesWithAlt} 张`,
          description: 'Alt 文本帮助搜索引擎和屏幕阅读器理解图片。',
          recommendation: `为缺少 alt 的 ${imageCount - imagesWithAlt} 张图片补充准确描述。`
        }),
        createCheck({
          id: 'language', category: 'experience', title: '页面语言',
          passed: Boolean(language),
          finding: language ? '页面语言已声明' : '页面语言声明缺失',
          value: language || '未设置',
          description: 'lang 属性帮助搜索引擎和辅助技术识别页面语言。',
          recommendation: '在 html 元素上添加准确的 lang 属性。'
        }),
        createCheck({
          id: 'structured-data', category: 'structured', title: 'JSON-LD 结构化数据', finding: jsonLdFinding,
          passed: jsonLdPassed,
          value: `标签总数：${jsonLdElements.length} 个 · 有效：${validJsonLdCount} 个`,
          description: '结构化数据能更明确地描述组织、产品和内容实体。',
          recommendation: '按页面类型添加有效的 Schema.org JSON-LD。'
        }),
        createCheck({
          id: 'open-graph', category: 'structured', title: 'Open Graph', finding: openGraphFinding,
          passed: validOpenGraphCount === 3,
          value: `有效字段：${validOpenGraphCount}/3 · ${openGraphEntries.filter(([, value]) => !value).map(([name]) => name).join('、') || '无缺失'}`,
          description: 'Open Graph 控制页面在社交平台分享时的标题、描述和图片。',
          recommendation: '补全 og:title、og:description 和 og:image。'
        }),
        createCheck({
          id: 'twitter-card', category: 'structured', title: 'Twitter Card',
          passed: Boolean(twitterCard),
          finding: twitterCard ? 'Twitter Card 已配置' : 'Twitter Card 缺失或为空',
          value: twitterCard || '未设置',
          description: 'Twitter Card 改善链接在 X 等平台中的分享展示。',
          recommendation: '添加 twitter:card，并复用合适的分享标题、描述和图片。'
        }),
        createCheck({
          id: 'response-time', category: 'performance', title: '服务器响应时间',
          passed: response.durationMs <= thresholds.responseTimeMaxMs,
          finding: response.durationMs <= thresholds.responseTimeMaxMs ? '服务器响应及时' : '服务器响应偏慢',
          value: `${response.durationMs} ms`,
          description: '较慢的服务器响应会拖累页面加载和抓取效率。',
          recommendation: '优化服务器处理、缓存和网络链路，将响应控制在 2 秒内。'
        }),
        createCheck({
          id: 'html-size', category: 'performance', title: 'HTML 体积',
          passed: htmlBytes <= thresholds.htmlMaxBytes,
          finding: htmlBytes <= thresholds.htmlMaxBytes ? 'HTML 体积适中' : 'HTML 体积偏大',
          value: `${Math.max(1, Math.round(htmlBytes / 1024))} KB`,
          description: '过大的 HTML 会增加下载、解析和抓取成本。',
          recommendation: '减少冗余标记和内联数据，将 HTML 控制在 500 KB 内。'
        })
      ];

      const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
      const issues = checks.filter((check) => check.status === 'failed');
      const categories = CATEGORY_DEFINITIONS.map((definition) => {
        const categoryChecks = checks
          .filter((check) => check.category === definition.key)
          .sort((a, b) => Number(a.status === 'passed') - Number(b.status === 'passed') || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
        const weight = categoryChecks.reduce((sum, check) => sum + check.weight, 0);
        const categoryPassedWeight = categoryChecks.filter((check) => check.status === 'passed').reduce((sum, check) => sum + check.weight, 0);
        return { ...definition, score: Math.round((categoryPassedWeight / weight) * 100), checks: categoryChecks };
      });
      const isHomepage = new URL(finalUrl).pathname === '/';
      const indexabilityCheck = checks.find((check) => check.id === 'indexability');
      const pageFacts = {
        url: finalUrl,
        isHomepage,
        statusCode: response.statusCode,
        indexable: indexabilityCheck?.status === 'passed',
        contentCharacters
      };
      const blockers = detectTechnicalHealthBlockers({
        pages: [pageFacts],
        crawlerAccess,
        scoreConfig: scoring
      });
      const unknownReasons = unknownScoringCrawlers.length
        ? ['robots.txt 证据不足，无法确认重要搜索与 AI 搜索爬虫权限']
        : [];
      const health = calculateTechnicalHealth({
        instances: checks.map((check) => ({ url: finalUrl, isHomepage, check })),
        blockers,
        evidenceComplete: unknownReasons.length === 0,
        unknownReasons,
        rules,
        scoreConfig: scoring
      });

      return {
        mode: 'page',
        scoreVersion: scoring.version,
        scoreModel: 'technical-health-v4',
        ruleVersion: rules.version,
        requestedUrl,
        finalUrl,
        checkedAt: new Date().toISOString(),
        statusCode: response.statusCode,
        durationMs: response.durationMs,
        score: health.score,
        grade: health.status,
        summary: {
          total: checks.length,
          totalWeight,
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
          keywords,
          canonical,
          language,
          h1Count,
          imageCount,
          imagesWithAlt,
          internalLinks,
          externalLinks,
          htmlBytes,
          contentCharacters,
          indexable: pageFacts.indexable,
          isHomepage
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
        platforms,
        crawlerAccess,
        health,
        priorities: health.priorities,
        categories
      };
    }
  };
}

module.exports = { createSeoAuditService, normalizeWebsiteUrl };

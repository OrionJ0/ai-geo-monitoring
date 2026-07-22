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

function normalizeWebsiteUrl(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('请输入需要检测的网址');

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 网站');
  url.hash = '';
  return url.toString();
}

function hasSkippedHeadingLevel($) {
  const levels = $('h1, h2, h3, h4, h5, h6')
    .map((_, element) => Number(element.tagName.slice(1)))
    .get();

  return levels.some((level, index) => index > 0 && level - levels[index - 1] > 1);
}

function createCheck({ id, category, title, passed, severity, weight, value, description, recommendation }) {
  return {
    id,
    category,
    title,
    status: passed ? 'passed' : 'failed',
    severity,
    weight,
    value,
    description,
    recommendation: passed ? '' : recommendation
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

      const title = $('title').first().text().trim();
      const description = $('meta[name="description"]').attr('content')?.trim() || '';
      const canonical = $('link[rel="canonical"]').attr('href')?.trim() || '';
      const language = $('html').attr('lang')?.trim() || '';
      const viewport = $('meta[name="viewport"]').attr('content')?.trim() || '';
      const robotsMeta = $('meta[name="robots"]').attr('content')?.toLowerCase() || '';
      const xRobotsTag = String(response.headers?.['x-robots-tag'] || '').toLowerCase();
      const h1Count = $('h1').length;
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
      const hasJsonLd = $('script[type="application/ld+json"]').length > 0;
      const openGraph = {
        title: $('meta[property="og:title"]').attr('content')?.trim() || '',
        description: $('meta[property="og:description"]').attr('content')?.trim() || '',
        image: $('meta[property="og:image"]').attr('content')?.trim() || ''
      };
      const twitterCard = $('meta[name="twitter:card"]').attr('content')?.trim() || '';
      const htmlBytes = Buffer.byteLength(response.html || '', 'utf8');

      const origin = new URL(finalUrl).origin;
      const [robotsResult, sitemapResult] = await Promise.all([
        client.probe(`${origin}/robots.txt`).catch(() => ({ statusCode: 0, body: '' })),
        client.probe(`${origin}/sitemap.xml`).catch(() => ({ statusCode: 0, body: '' }))
      ]);
      const robotsHasSitemap = /^sitemap:\s*https?:\/\//im.test(robotsResult.body || '');
      const checks = [
        createCheck({
          id: 'http-status', category: 'crawlability', title: '页面可正常访问',
          passed: response.statusCode >= 200 && response.statusCode < 300,
          severity: 'critical', weight: 14, value: `HTTP ${response.statusCode}`,
          description: '搜索引擎需要获得成功的 HTTP 响应才能读取页面。',
          recommendation: '修复服务器错误或重定向链，确保目标页面直接返回 2xx。'
        }),
        createCheck({
          id: 'indexability', category: 'crawlability', title: '页面允许索引',
          passed: !robotsMeta.includes('noindex') && !xRobotsTag.includes('noindex'),
          severity: 'critical', weight: 14,
          value: robotsMeta || xRobotsTag || '未发现 noindex',
          description: 'noindex 指令会阻止搜索引擎把页面加入索引。',
          recommendation: '如果页面需要获得自然搜索流量，请移除 noindex 指令。'
        }),
        createCheck({
          id: 'https', category: 'crawlability', title: '使用 HTTPS',
          passed: new URL(finalUrl).protocol === 'https:', severity: 'high', weight: 7,
          value: new URL(finalUrl).protocol.replace(':', '').toUpperCase(),
          description: 'HTTPS 保护传输安全，也是现代搜索与浏览器体验的基础。',
          recommendation: '配置有效证书，并将 HTTP 永久重定向到 HTTPS。'
        }),
        createCheck({
          id: 'robots-txt', category: 'crawlability', title: 'robots.txt 可访问',
          passed: robotsResult.statusCode >= 200 && robotsResult.statusCode < 300,
          severity: 'high', weight: 7, value: robotsResult.statusCode ? `HTTP ${robotsResult.statusCode}` : '无法访问',
          description: 'robots.txt 用于声明搜索引擎抓取规则。',
          recommendation: '在网站根目录提供可访问的 robots.txt，并检查是否误封重要路径。'
        }),
        createCheck({
          id: 'sitemap', category: 'crawlability', title: '提供站点地图',
          passed: (sitemapResult.statusCode >= 200 && sitemapResult.statusCode < 300) || robotsHasSitemap,
          severity: 'medium', weight: 4,
          value: robotsHasSitemap ? 'robots.txt 已声明' : (sitemapResult.statusCode ? `HTTP ${sitemapResult.statusCode}` : '未发现'),
          description: '站点地图帮助搜索引擎发现重要页面。',
          recommendation: '提供 sitemap.xml，并在 robots.txt 中声明其完整地址。'
        }),
        createCheck({
          id: 'title', category: 'metadata', title: '标题清晰且长度合理',
          passed: title.length >= 10 && title.length <= 60, severity: 'high', weight: 8,
          value: title ? `${title.length} 字符 · ${title}` : '未设置',
          description: '标题用于概括页面主题，并常作为搜索结果标题。',
          recommendation: title ? '将标题调整为 10–60 个字符，并自然包含页面核心主题。' : '添加唯一且能准确概括页面主题的 title。'
        }),
        createCheck({
          id: 'meta-description', category: 'metadata', title: 'Meta 描述完整',
          passed: description.length >= 50 && description.length <= 160, severity: 'high', weight: 8,
          value: description ? `${description.length} 字符` : '未设置',
          description: '描述常用于搜索结果摘要，影响用户是否点击。',
          recommendation: description ? '将描述调整为 50–160 个字符，清楚说明页面价值。' : '添加 50–160 个字符的独特页面描述。'
        }),
        createCheck({
          id: 'canonical', category: 'metadata', title: '声明 Canonical URL',
          passed: Boolean(canonical), severity: 'medium', weight: 4,
          value: canonical || '未设置',
          description: 'Canonical 帮助搜索引擎识别重复页面中的规范版本。',
          recommendation: '添加指向当前规范页面的 rel="canonical" 链接。'
        }),
        createCheck({
          id: 'h1', category: 'content', title: '页面只有一个 H1',
          passed: h1Count === 1, severity: 'high', weight: 8, value: `${h1Count} 个`,
          description: 'H1 应清晰表达页面最重要的主题。',
          recommendation: h1Count === 0 ? '添加一个描述页面主题的 H1。' : '保留一个主 H1，其余标题改为 H2–H6。'
        }),
        createCheck({
          id: 'heading-order', category: 'content', title: '标题层级连续',
          passed: !hasSkippedHeadingLevel($), severity: 'medium', weight: 4,
          value: `${$('h1, h2, h3, h4, h5, h6').length} 个标题`,
          description: '连续的标题层级让用户和搜索引擎更容易理解内容结构。',
          recommendation: '按 H1 → H2 → H3 的层级组织内容，避免跳级。'
        }),
        createCheck({
          id: 'content-depth', category: 'content', title: '正文信息量充足',
          passed: contentCharacters >= 300, severity: 'low', weight: 2,
          value: `${contentCharacters} 个正文字符`,
          description: '过短内容通常无法完整回答用户问题。',
          recommendation: '补充原创、具体且能解决搜索意图的正文内容。'
        }),
        createCheck({
          id: 'crawlable-links', category: 'content', title: '包含可抓取链接',
          passed: crawlableLinks.length > 0, severity: 'low', weight: 2,
          value: `内链 ${internalLinks} · 外链 ${externalLinks}`,
          description: '有效链接帮助用户和搜索引擎发现相关内容。',
          recommendation: '添加指向重要相关页面的标准 href 链接。'
        }),
        createCheck({
          id: 'viewport', category: 'experience', title: '配置移动端 Viewport',
          passed: /width\s*=\s*device-width/i.test(viewport), severity: 'high', weight: 7,
          value: viewport || '未设置',
          description: 'Viewport 是页面正确适配移动设备的基础。',
          recommendation: '添加 width=device-width, initial-scale=1 的 viewport。'
        }),
        createCheck({
          id: 'image-alt', category: 'experience', title: '图片具备替代文本',
          passed: imageCount === 0 || imagesWithAlt === imageCount, severity: 'medium', weight: 5,
          value: `${imagesWithAlt}/${imageCount} 张图片`,
          description: 'Alt 文本帮助搜索引擎和屏幕阅读器理解图片。',
          recommendation: `为缺少 alt 的 ${imageCount - imagesWithAlt} 张图片补充准确描述。`
        }),
        createCheck({
          id: 'language', category: 'experience', title: '声明页面语言',
          passed: Boolean(language), severity: 'medium', weight: 4,
          value: language || '未设置',
          description: 'lang 属性帮助搜索引擎和辅助技术识别页面语言。',
          recommendation: '在 html 元素上添加准确的 lang 属性。'
        }),
        createCheck({
          id: 'structured-data', category: 'structured', title: '包含 JSON-LD 结构化数据',
          passed: hasJsonLd, severity: 'medium', weight: 5,
          value: hasJsonLd ? '已设置' : '未设置',
          description: '结构化数据能更明确地描述组织、产品和内容实体。',
          recommendation: '按页面类型添加有效的 Schema.org JSON-LD。'
        }),
        createCheck({
          id: 'open-graph', category: 'structured', title: 'Open Graph 信息完整',
          passed: Boolean(openGraph.title && openGraph.description && openGraph.image), severity: 'low', weight: 3,
          value: [openGraph.title, openGraph.description, openGraph.image].filter(Boolean).length + '/3 项',
          description: 'Open Graph 控制页面在社交平台分享时的标题、描述和图片。',
          recommendation: '补全 og:title、og:description 和 og:image。'
        }),
        createCheck({
          id: 'twitter-card', category: 'structured', title: '配置 Twitter Card',
          passed: Boolean(twitterCard), severity: 'low', weight: 2,
          value: twitterCard || '未设置',
          description: 'Twitter Card 改善链接在 X 等平台中的分享展示。',
          recommendation: '添加 twitter:card，并复用合适的分享标题、描述和图片。'
        }),
        createCheck({
          id: 'response-time', category: 'performance', title: '服务器响应及时',
          passed: response.durationMs <= 2000, severity: 'medium', weight: 5,
          value: `${response.durationMs} ms`,
          description: '较慢的服务器响应会拖累页面加载和抓取效率。',
          recommendation: '优化服务器处理、缓存和网络链路，将响应控制在 2 秒内。'
        }),
        createCheck({
          id: 'html-size', category: 'performance', title: 'HTML 体积适中',
          passed: htmlBytes <= 500 * 1024, severity: 'medium', weight: 4,
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

/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settingsSource = fs.readFileSync(path.resolve(__dirname, '../app/admin/settings/page.tsx'), 'utf8');
const platformSource = fs.readFileSync(path.resolve(__dirname, '../app/admin/settings/AIPlatformSettings.tsx'), 'utf8');
const analysisSource = fs.readFileSync(path.resolve(__dirname, '../app/admin/settings/AIAnalysisSettings.tsx'), 'utf8');
const layoutSource = fs.readFileSync(path.resolve(__dirname, '../app/admin/layout.tsx'), 'utf8');

test('admin settings is the single settings center with an analysis API tab', () => {
  assert.match(settingsSource, /AI 平台/);
  assert.match(settingsSource, /AI 分析 API/);
  assert.match(settingsSource, /运行设置/);
  assert.match(settingsSource, /站点 SEO/);
  assert.match(settingsSource, /useState\('ai-platforms'\)/);
  assert.match(settingsSource, /activeKey=\{activeTab\}/);
  assert.equal(
    (settingsSource.match(/forceRender: true/g) || []).length,
    2,
    'inactive form tabs must stay mounted before setFieldsValue runs',
  );
  assert.match(
    layoutSource,
    /key: 'settings', label: <Link href="\/admin\/settings">设置中心<\/Link>/,
  );
  assert.match(settingsSource, /刷新全部设置/);
  assert.doesNotMatch(layoutSource, /key: 'platforms'|平台自检/);
});

test('SEO title may be cleared to use the application default', () => {
  const titleStart = settingsSource.indexOf('<Form.Item name="seo_title"');
  const titleEnd = settingsSource.indexOf('</Form.Item>', titleStart);
  const titleField = settingsSource.slice(titleStart, titleEnd);

  assert.ok(titleStart >= 0 && titleEnd > titleStart, '应找到站点标题字段');
  assert.doesNotMatch(titleField, /required:\s*true/);
  assert.match(titleField, /留空使用应用默认标题/);
});

test('analysis API settings select a configured platform and an independent model', () => {
  assert.match(analysisSource, /\/api\/settings\/analysis-api/);
  assert.match(analysisSource, /\/api\/settings\/analysis-api\/test/);
  assert.match(analysisSource, /\/api\/settings\/analysis-api\/prompt/);
  assert.match(analysisSource, /\/api\/admin\/ai-platforms\/\$\{platformId\}\/models/);
  assert.match(analysisSource, /name="platform_code"/);
  assert.match(analysisSource, /name="model_name"/);
  assert.match(analysisSource, /name="model_name"\s+noStyle/);
  assert.match(analysisSource, /分析平台/);
  assert.match(analysisSource, /分析模型/);
  assert.match(analysisSource, /request_profile/);
  assert.match(analysisSource, /request_parameters/);
  assert.match(analysisSource, /分析专用调用参数/);
  assert.match(analysisSource, /实际请求参数/);
  assert.match(analysisSource, /不设置应用层 Token 上限/);
  assert.match(analysisSource, /高强度（reasoning_effort=high）/);
  assert.match(analysisSource, /请求超时/);
  assert.match(analysisSource, /不会修改监测平台参数/);
  assert.match(analysisSource, /测试输入/);
  assert.match(analysisSource, /分析模型原始 JSON 输出/);
  assert.match(analysisSource, /当前分析提示词/);
  assert.match(analysisSource, /刷新模型列表/);
  assert.match(analysisSource, /setModelDropdownOpen\(true\)/);
  assert.match(analysisSource, /open=\{modelDropdownOpen\}/);
  assert.match(analysisSource, /本次读取的列表不会保存/);
  assert.match(analysisSource, /不会保存测试输入和输出/);
  assert.match(analysisSource, /全部品牌和公司/);
  assert.match(analysisSource, /目标品牌\/竞品实体映射/);
  assert.match(analysisSource, /引用数据不由分析模型生成/);
  assert.doesNotMatch(analysisSource, /逐字原文/);
});

test('analysis API test sends the current question required by the runtime contract', () => {
  assert.match(analysisSource, /name="question_text"/);
  assert.match(analysisSource, /question_text:\s*values\.question_text/);
  assert.match(analysisSource, /当前问题/);
});

test('analysis request parameters are editable only after an explicit confirmation', () => {
  assert.match(analysisSource, /name="request_options_text"/);
  assert.match(analysisSource, /JSON\.parse\(values\.request_options_text/);
  assert.match(analysisSource, /request_options:\s*requestOptions/);
  assert.match(analysisSource, /Modal\.confirm/);
  assert.match(analysisSource, /确认修改分析请求参数？/);
  assert.match(analysisSource, /确认修改并保存/);
  assert.match(analysisSource, /错误参数可能导致分析失败或变慢/);
  assert.match(analysisSource, /DeepSeek 思考模式/);
  assert.match(analysisSource, /关闭/);
});

test('platform settings use the management API for every explicit operation', () => {
  assert.match(platformSource, /\/api\/admin\/ai-platforms/);
  assert.match(platformSource, /\/enabled/);
  assert.match(platformSource, /\/api-key/);
  assert.match(platformSource, /\/api-key`/);
  assert.match(platformSource, /\/ai-platforms\/\$\{platformId\}\/models/);
  assert.match(platformSource, /刷新模型/);
  assert.match(platformSource, /name="default_model"/);
  assert.match(
    platformSource,
    /name="default_model"[\s\S]*?<AutoComplete/,
    'the default model editor must accept a supplier model or an arbitrary model name',
  );
  assert.match(platformSource, /placeholder="选择或输入模型名称"/);
  assert.match(platformSource, /title: '接口参数'/);
  assert.match(platformSource, /title: '当前模型'/);
  assert.doesNotMatch(platformSource, /loadPlatformModels/);
  assert.match(platformSource, /\/test/);
  assert.match(platformSource, /\/test-web-search/);
  const maskedApiKey = platformSource.match(/const MASKED_API_KEY = '(\*+)'/)?.[1];
  assert.equal(maskedApiKey?.length, 32);
  assert.match(platformSource, /visibilityToggle=\{\{/);
  assert.match(platformSource, /onVisibleChange: handleApiKeyVisibilityChange/);
  assert.match(platformSource, /preserveExistingApiKey \? '' : values\.api_key\?\.trim\(\)/);
  assert.doesNotMatch(platformSource, /显示现有密钥/);
  assert.match(platformSource, /删除/);
  assert.doesNotMatch(platformSource, /归档/);
  assert.doesNotMatch(platformSource, /max_keyword/);
  assert.doesNotMatch(platformSource, /doubao_responses|豆包 Responses/);
  assert.match(platformSource, /request_options/);
  assert.match(platformSource, /请求参数/);
  assert.match(platformSource, /联网能力/);
  assert.match(platformSource, /测试输入/);
  assert.match(platformSource, /模型文本输出/);
  assert.match(platformSource, /供应商 API 输出/);
  assert.match(platformSource, /输入和 API 输出不会写入数据库/);
  assert.match(platformSource, /Popconfirm/);
  assert.match(
    platformSource,
    /const openCreate = \(\) => \{[\s\S]*?enabled: false/,
    'new custom platforms must start disabled until an administrator opts in',
  );
});

test('platform settings treat both managed Web adapters as browser sessions instead of APIs', () => {
  assert.match(platformSource, /webPlatformAdminSession\.cjs/);
  assert.match(platformSource, /isManagedWebAdapter/);
  assert.match(platformSource, /doubao_web/);
  assert.doesNotMatch(platformSource, /adapter_type === 'deepseek_web'/);
  assert.doesNotMatch(platformSource, /adapter_type !== 'deepseek_web'/);
  assert.match(platformSource, /真实网页 · 专用 Chrome/);
  assert.match(platformSource, /\/web-session/);
  assert.match(platformSource, /\/web-session\/open/);
  assert.match(platformSource, /\/web-session\/verify/);
  assert.match(platformSource, /browser_configured/);
  assert.match(platformSource, /profile_initialized/);
  assert.match(platformSource, /登录 \/ 打开 Chrome/);
  assert.match(platformSource, /切换账号/);
  assert.match(platformSource, /验证登录/);
  assert.match(platformSource, /刷新配置信息/);
  assert.match(platformSource, /刷新配置信息.*不会检查当前登录是否仍有效/);
  assert.match(platformSource, /配置信息已刷新（未验证登录）/);
  assert.match(platformSource, /刷新平台列表/);
  assert.doesNotMatch(platformSource, /重新加载/);
  assert.doesNotMatch(platformSource, /刷新状态/);
});

test('the retired standalone platform page is removed', () => {
  assert.equal(fs.existsSync(path.resolve(__dirname, '../app/admin/platforms/page.tsx')), false);
});

/**
 * 模型外竞品注册表身份归一服务。
 *
 * 职责：复用现有 `brand_competitors` 作为项目级已核验身份注册表，在阶段 1
 * 的原文实体已经锚定后执行纯程序身份匹配。匹配只附加
 * `matched / unmatched / ambiguous` 身份元数据，不改变任何原文事实：
 * 不新增实体、不增加表面词/提及位置、不修改 source ID、不改变 occurrence。
 *
 * 约束：
 * - 匹配只使用已经通过原文校验的实体 `surface_forms`，不扫描回答补充注册
 *   别名的额外出现位置，不用模型 canonical name 单独命中。
 * - 表外实体与歧义实体必须保留；表内但原回答未出现的品牌没有进入结果的路径。
 * - 阶段 2 只接收匹配前的 grounded 实体投影（见 `projectForSemantic`），
 *   注册表身份在阶段 2 完成后按 `entity_id` 回接，不进入任何模型提示。
 */
const { createHash } = require('node:crypto');

const SNAPSHOT_VERSION = 'competitor_registry_snapshot_v1';

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function canonicalKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
}

/**
 * 从竞品主数据构建不可变快照。空注册表生成合法空快照而非 null。
 * entries 按 competitor_id 排序，保证相同内容产生相同 sha256。
 */
function buildRegistrySnapshot(competitors = []) {
  const list = Array.isArray(competitors) ? competitors : [];
  const entries = list
    .map((competitor) => ({
      competitor_id: Number(competitor?.id ?? competitor?.competitor_id),
      name: String(competitor?.name || '').trim(),
      aliases: Array.isArray(competitor?.aliases) ? competitor.aliases.map((alias) => String(alias || '').trim()) : [],
      website: String(competitor?.website || '').trim()
    }))
    .filter((entry) => Number.isInteger(entry.competitor_id) && entry.name)
    .sort((left, right) => left.competitor_id - right.competitor_id);
  const payload = { version: SNAPSHOT_VERSION, entries };
  return {
    version: SNAPSHOT_VERSION,
    sha256: hashJson(payload),
    entries,
    entry_count: entries.length
  };
}

/**
 * 对单个已锚定实体执行确定性身份匹配。
 * 匹配使用实体已验证 surface_forms 与注册表 name/aliases 的
 * NFKC + 大小写折叠 + 受控空白归一后的精确相等比较。
 */
function resolveEntityRegistry(entity, snapshot) {
  const surfaceTerms = (Array.isArray(entity?.surface_forms) ? entity.surface_forms : [])
    .map((form) => String(form || '').trim())
    .filter(Boolean);
  const matches = [];
  (Array.isArray(snapshot?.entries) ? snapshot.entries : []).forEach((entry) => {
    const registryTerms = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
      .map(canonicalKey)
      .filter(Boolean);
    const matchedSurface = surfaceTerms.find((surface) => registryTerms.includes(canonicalKey(surface)));
    if (matchedSurface) {
      matches.push({
        competitor_id: entry.competitor_id,
        registry_name: entry.name,
        matched_term: matchedSurface
      });
    }
  });
  const uniqueMatches = matches.filter((match, index) => (
    matches.findIndex((other) => other.competitor_id === match.competitor_id) === index
  ));
  const base = { entity_id: String(entity?.entity_id || '') };
  if (uniqueMatches.length === 0) {
    return { ...base, status: 'unmatched', candidate_competitor_ids: [] };
  }
  if (uniqueMatches.length === 1) {
    return {
      ...base,
      status: 'matched',
      competitor_id: uniqueMatches[0].competitor_id,
      registry_name: uniqueMatches[0].registry_name,
      matched_term: uniqueMatches[0].matched_term
    };
  }
  return {
    ...base,
    status: 'ambiguous',
    candidate_competitor_ids: uniqueMatches.map((match) => match.competitor_id)
  };
}

/**
 * 给实体目录附加 registry_match 身份元数据；除 registry_match 外的字段
 * 深度不变，因此匹配前后 occurrence、source ID、绝对位置、表面词与
 * 提及次数严格相等。
 */
function withRegistryMatches(catalog, snapshot) {
  const entities = (Array.isArray(catalog?.entities) ? catalog.entities : []).map((entity) => ({
    ...entity,
    registry_match: resolveEntityRegistry(entity, snapshot)
  }));
  return { ...catalog, entities };
}

/**
 * 阶段 2 使用的匹配前 grounded 实体投影。只保留 entity_id / name / type /
 * surface_forms / source_ids，任何注册表标准名、competitor_id、匹配状态
 * 与"已知竞品"标签都不会进入阶段 2 模型输入。
 */
function projectForSemantic(catalog) {
  return (Array.isArray(catalog?.entities) ? catalog.entities : []).map((entity) => ({
    entity_id: entity.entity_id,
    name: entity.name,
    type: entity.type,
    surface_forms: entity.surface_forms,
    source_ids: [...new Set((Array.isArray(entity.mentions) ? entity.mentions : []).map((mention) => mention.source_id))]
  }));
}

module.exports = {
  SNAPSHOT_VERSION,
  buildRegistrySnapshot,
  canonicalKey,
  projectForSemantic,
  resolveEntityRegistry,
  withRegistryMatches
};

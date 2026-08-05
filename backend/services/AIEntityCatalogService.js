const { createSourceMap } = require('./AIAnalysisSourceMapService');

const VALID_ENTITY_TYPES = new Set(['brand', 'company', 'other_organization']);

class AIEntityCatalogError extends Error {
  constructor(message, code = 'analysis_entity_output_invalid', details = {}) {
    super(message);
    this.name = 'AIEntityCatalogError';
    this.code = code;
    this.details = details;
  }
}

function normalizedName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function assertSourceMap(answer, sourceMap) {
  const expected = createSourceMap(answer);
  if (
    sourceMap?.version !== expected.version
    || sourceMap?.answer_sha256 !== expected.answer_sha256
    || !Array.isArray(sourceMap?.segments)
  ) {
    throw new AIEntityCatalogError(
      '原回答与 source map 不一致',
      'analysis_entity_grounding_invalid'
    );
  }
}

function occurrenceOffsets(text, surfaceForm) {
  const offsets = [];
  let start = 0;
  while (start <= text.length - surfaceForm.length) {
    const index = text.indexOf(surfaceForm, start);
    if (index < 0) break;
    offsets.push(index);
    start = index + Math.max(1, surfaceForm.length);
  }
  return offsets;
}

function targetAliasMatchesSurface(surfaceForm, targetAliases) {
  const surface = normalizedName(surfaceForm);
  return targetAliases.some((alias) => {
    if (surface === alias) return true;
    const index = surface.indexOf(alias);
    if (index < 0) return false;
    if (/[^a-z0-9]/u.test(alias)) return true;
    const before = surface[index - 1] || '';
    const after = surface[index + alias.length] || '';
    return !/[a-z0-9]/u.test(before) && !/[a-z0-9]/u.test(after);
  });
}

function canonicalRedirects(extractedMentions, segmentById) {
  const redirects = new Map();
  for (let leftIndex = 0; leftIndex < extractedMentions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < extractedMentions.length; rightIndex += 1) {
      const left = extractedMentions[leftIndex];
      const right = extractedMentions[rightIndex];
      if (left?.source_id !== right?.source_id) continue;
      if (!new Set([left?.entity_type, right?.entity_type]).has('company')) continue;
      if (!new Set([left?.entity_type, right?.entity_type]).has('brand')) continue;
      const segment = segmentById.get(String(left.source_id || '').trim());
      if (!segment) continue;
      const leftStart = segment.text.indexOf(String(left.surface_form || '').trim());
      const rightStart = segment.text.indexOf(String(right.surface_form || '').trim());
      if (leftStart < 0 || rightStart < 0 || leftStart === rightStart) continue;
      const first = leftStart < rightStart ? left : right;
      const second = leftStart < rightStart ? right : left;
      const firstStart = Math.min(leftStart, rightStart);
      const secondStart = Math.max(leftStart, rightStart);
      const between = segment.text.slice(
        firstStart + String(first.surface_form || '').trim().length,
        secondStart
      );
      const after = segment.text.slice(
        secondStart + String(second.surface_form || '').trim().length
      );
      if (!/^[\s*_~]*[（(【\[]\s*$/u.test(between)) continue;
      if (!/^\s*[）)】\]]/u.test(after)) continue;
      const company = left.entity_type === 'company' ? left : right;
      const companyKey = normalizedName(company.canonical_name);
      const aliasKey = normalizedName((company === left ? right : left).canonical_name);
      if (companyKey && aliasKey && companyKey !== aliasKey) redirects.set(aliasKey, companyKey);
    }
  }
  return redirects;
}

function resolvedCanonicalKey(value, redirects) {
  let key = normalizedName(value);
  const visited = new Set();
  while (redirects.has(key) && !visited.has(key)) {
    visited.add(key);
    key = redirects.get(key);
  }
  return key;
}

function preferredEntityType(current, incoming) {
  if (current === incoming) return current;
  if (new Set([current, incoming]).size === 2
    && new Set([current, incoming]).has('company')
    && new Set([current, incoming]).has('brand')) {
    return 'company';
  }
  return null;
}

function hasAsciiBoundaries(text, index, value) {
  if (/[^a-z0-9]/iu.test(value)) return true;
  const before = text[index - 1] || '';
  const after = text[index + value.length] || '';
  return !/[a-z0-9]/iu.test(before) && !/[a-z0-9]/iu.test(after);
}

function buildTargetMentions(sourceMap, targetBrand) {
  const aliases = [targetBrand?.name, ...(Array.isArray(targetBrand?.aliases) ? targetBrand.aliases : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const candidates = [];
  sourceMap.segments.forEach((segment) => {
    aliases.forEach((surfaceForm) => {
      occurrenceOffsets(segment.text, surfaceForm).forEach((localStart) => {
        if (!hasAsciiBoundaries(segment.text, localStart, surfaceForm)) return;
        candidates.push({
          source_id: segment.source_id,
          local_start: localStart,
          local_end: localStart + surfaceForm.length,
          start: segment.start + localStart,
          end: segment.start + localStart + surfaceForm.length,
          surface_form: surfaceForm
        });
      });
    });
  });
  candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  const selected = [];
  candidates.forEach((candidate) => {
    const previous = selected.at(-1);
    if (previous && candidate.start < previous.end) return;
    if (previous && previous.source_id === candidate.source_id) {
      const segment = sourceMap.segments.find((item) => item.source_id === candidate.source_id);
      const between = segment.text.slice(previous.local_end, candidate.local_start);
      if (/^(?:信息技术|数字技术|安防设备|智能科技|电子科技|安全科技|科技发展|智慧感知|技术|科技|电子|智能|光电|通信|股份|集团|有限责任公司|有限公司|公司)+[（(][^）)]*$/u.test(between)) return;
      if (between.length <= 30 && /[（(]/u.test(between) && !/[。；，,：:]/u.test(between)) return;
    }
    selected.push(candidate);
  });
  return selected.map(({ local_start: _localStart, local_end: _localEnd, ...mention }) => mention);
}

function expandGroundedEntityOccurrences(entity, sourceMap) {
  // 只使用已经通过原文锚定的 surface_forms 扫描全部片段；
  // 不使用模型 canonical name，不派生未注册短名/别名，也不做"市"等变体替换。
  [...new Set(entity.surface_forms)]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .forEach((surfaceForm) => {
      sourceMap.segments.forEach((segment) => {
        occurrenceOffsets(segment.text, surfaceForm).forEach((localStart) => {
          if (!hasAsciiBoundaries(segment.text, localStart, surfaceForm)) return;
          const start = segment.start + localStart;
          const end = start + surfaceForm.length;
          const overlaps = entity.mentions.some((mention) => start < mention.end && end > mention.start);
          if (overlaps) return;
          entity.surface_forms.push(surfaceForm);
          entity.mentions.push({
            source_id: segment.source_id,
            start,
            end,
            surface_form: surfaceForm
          });
        });
      });
    });
  entity.surface_forms = [...new Set(entity.surface_forms)];
  entity.mentions.sort((left, right) => left.start - right.start || right.end - left.end);
}

function buildEntityCatalog({ answer: inputAnswer, sourceMap, extractedMentions, targetBrand = {} }) {
  const answer = String(inputAnswer ?? '');
  assertSourceMap(answer, sourceMap);
  if (!Array.isArray(extractedMentions)) {
    throw new AIEntityCatalogError('mentions 必须是数组');
  }

  const segmentById = new Map(sourceMap.segments.map((segment) => [segment.source_id, segment]));
  const redirects = canonicalRedirects(extractedMentions, segmentById);
  const grouped = new Map();

  extractedMentions.forEach((mention, index) => {
    const sourceId = String(mention?.source_id || '').trim();
    const surfaceForm = String(mention?.surface_form || '').trim();
    const canonicalName = String(mention?.canonical_name || '').trim();
    const entityType = String(mention?.entity_type || '').trim();
    const segment = segmentById.get(sourceId);
    if (!segment) {
      throw new AIEntityCatalogError(
        `mentions[${index}].source_id 不存在`,
        'analysis_entity_grounding_invalid',
        { field: `mentions[${index}].source_id` }
      );
    }
    if (!surfaceForm || surfaceForm.length > 120 || surfaceForm.includes('\n')) {
      throw new AIEntityCatalogError(`mentions[${index}].surface_form 无效`, undefined, {
        field: `mentions[${index}].surface_form`
      });
    }
    const localOffsets = occurrenceOffsets(segment.text, surfaceForm);
    if (!localOffsets.length) {
      throw new AIEntityCatalogError(
        `mentions[${index}].surface_form 无法在对应原文片段定位`,
        'analysis_entity_grounding_invalid',
        { field: `mentions[${index}].surface_form` }
      );
    }
    if (!canonicalName || canonicalName.length > 120) {
      throw new AIEntityCatalogError(`mentions[${index}].canonical_name 无效`, undefined, {
        field: `mentions[${index}].canonical_name`
      });
    }
    if (!VALID_ENTITY_TYPES.has(entityType)) {
      throw new AIEntityCatalogError(`mentions[${index}].entity_type 无效`, undefined, {
        field: `mentions[${index}].entity_type`
      });
    }

    const key = resolvedCanonicalKey(canonicalName, redirects);
    const current = grouped.get(key) || {
      name: canonicalName,
      type: entityType,
      surface_forms: new Set(),
      mentions: new Map()
    };
    const resolvedType = preferredEntityType(current.type, entityType);
    if (!resolvedType) {
      throw new AIEntityCatalogError(
        `实体 ${canonicalName} 存在类型冲突`,
        'analysis_entity_output_invalid',
        { field: `mentions[${index}].entity_type` }
      );
    }
    current.type = resolvedType;
    current.surface_forms.add(surfaceForm);
    localOffsets.forEach((localStart) => {
      const start = segment.start + localStart;
      const occurrence = {
        source_id: sourceId,
        start,
        end: start + surfaceForm.length,
        surface_form: surfaceForm
      };
      current.mentions.set(`${start}:${occurrence.end}:${surfaceForm}`, occurrence);
    });
    grouped.set(key, current);
  });

  const entities = [...grouped.values()]
    .map((entity) => ({
      ...entity,
      surface_forms: [...entity.surface_forms],
      mentions: [...entity.mentions.values()].sort((left, right) => (
        left.start - right.start || right.end - left.end
      ))
    }))
    .sort((left, right) => (
      (left.mentions[0]?.start ?? Infinity) - (right.mentions[0]?.start ?? Infinity)
      || left.name.localeCompare(right.name)
    ))
    .map((entity, index) => ({
      entity_id: `E${String(index + 1).padStart(3, '0')}`,
      ...entity
    }));

  const targetAliases = [targetBrand?.name, ...(Array.isArray(targetBrand?.aliases) ? targetBrand.aliases : [])]
    .map(normalizedName)
    .filter(Boolean);
  const targetMatches = entities.filter((entity) => (
    entity.surface_forms.some((surfaceForm) => targetAliasMatchesSurface(surfaceForm, targetAliases))
  ));
  if (targetMatches.length > 1) {
    throw new AIEntityCatalogError(
      '多个实体同时命中目标品牌别名',
      'analysis_target_mapping_ambiguous'
    );
  }
  // 目标别名扫描只发生在 buildTargetMentions（确定性目标事实轨）内，
  // 不会把配置别名注入开放实体目录，避免派生未确认别名扩大 occurrence。
  entities.forEach((entity) => expandGroundedEntityOccurrences(entity, sourceMap));

  return {
    entities,
    target_entity_id: targetMatches[0]?.entity_id || null,
    target_mentions: targetMatches.length === 1
      ? buildTargetMentions(sourceMap, targetBrand)
      : []
  };
}

module.exports = {
  AIEntityCatalogError,
  buildEntityCatalog,
  buildTargetMentions
};

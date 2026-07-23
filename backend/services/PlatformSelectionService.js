function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,，;；\n]/);
  return [];
}

function normalize(value) {
  return Array.from(new Set(
    asArray(value)
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  ));
}

function hasValidCodeFormat(code) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) && code.length >= 2 && code.length <= 50;
}

class PlatformSelectionService {
  normalize(value) {
    return normalize(value);
  }

  validate(value, options = {}) {
    const restrictToAvailable = Object.prototype.hasOwnProperty.call(options, 'availablePlatforms');
    const availablePlatforms = normalize(options.availablePlatforms);
    const available = new Set(availablePlatforms);
    const raw = normalize(value);
    const defaults = normalize(
      options.defaultPlatforms !== undefined ? options.defaultPlatforms : availablePlatforms
    );
    const selected = raw.length ? raw : defaults;
    const invalid = selected.filter((platform) => (
      !hasValidCodeFormat(platform)
      || (restrictToAvailable && !available.has(platform))
    ));
    if (invalid.length) {
      return {
        ok: false,
        platforms: [],
        invalid_platforms: invalid,
        message: `监测平台当前不可选择：${invalid.join('、')}`
      };
    }
    return { ok: true, platforms: selected, invalid_platforms: [] };
  }

  validateWithinProject(value, projectPlatforms, availablePlatforms = projectPlatforms) {
    const selectable = normalize(availablePlatforms);
    const projectList = normalize(projectPlatforms).filter((platform) => (
      !selectable.length || selectable.includes(platform)
    ));
    const result = this.validate(value, {
      availablePlatforms: selectable,
      defaultPlatforms: projectList
    });
    if (!result.ok) return result;

    const allowed = new Set(projectList);
    const invalid = result.platforms.filter((platform) => !allowed.has(platform));
    if (invalid.length) {
      return {
        ok: false,
        platforms: [],
        invalid_platforms: invalid,
        message: `问题监测平台必须包含在项目监测平台内：${projectList.join('、')}`
      };
    }
    return result;
  }

  validateProjectUpdate(value, currentProjectPlatforms, availablePlatforms) {
    const current = normalize(currentProjectPlatforms);
    const selectable = normalize(availablePlatforms);
    return this.validate(value, {
      availablePlatforms: Array.from(new Set([...selectable, ...current])),
      defaultPlatforms: current
    });
  }

  reconcilePromptPlatforms(promptPlatforms, projectPlatforms) {
    const allowedPlatforms = normalize(projectPlatforms);
    const allowed = new Set(allowedPlatforms);
    const retained = normalize(promptPlatforms).filter((platform) => allowed.has(platform));
    return retained.length ? retained : allowedPlatforms;
  }
}

module.exports = new PlatformSelectionService();
module.exports.normalizePlatformCodes = normalize;
module.exports.hasValidCodeFormat = hasValidCodeFormat;

const DEFAULT_PROJECT_SETTING_KEY = 'market_default_project_id';

const ERROR_DEFINITIONS = {
  DEFAULT_PROJECT_NOT_CONFIGURED: {
    status: 409,
    message: '尚未配置默认监控项目，请联系管理员完成设置'
  },
  DEFAULT_PROJECT_UNAVAILABLE: {
    status: 409,
    message: '默认监控项目不存在或已归档，请联系管理员重新设置'
  },
  DEFAULT_PROJECT_FORBIDDEN: {
    status: 403,
    message: '无权访问默认监控项目'
  },
  DEFAULT_PROJECT_READ_FAILED: {
    status: 503,
    message: '默认监控项目暂时无法读取，请稍后重试'
  },
  INVALID_DEFAULT_PROJECT_ID: {
    status: 400,
    message: '默认监控项目标识无效'
  },
  DEFAULT_PROJECT_REQUEST_INVALID: {
    status: 400,
    message: '默认监控项目请求无效'
  },
  PROJECT_NOT_FOUND: {
    status: 404,
    message: '品牌项目不存在'
  },
  DEFAULT_PROJECT_ARCHIVED: {
    status: 409,
    message: '归档项目不能设为默认监控项目'
  },
  ADMIN_REQUIRED: {
    status: 403,
    message: '仅管理员可以设置默认监控项目'
  }
};

class DefaultProjectContextError extends Error {
  constructor(code) {
    const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.DEFAULT_PROJECT_READ_FAILED;
    super(definition.message);
    this.name = 'DefaultProjectContextError';
    this.code = code;
    this.status = definition.status;
  }
}

function normalizeProjectId(value, errorCode = 'INVALID_DEFAULT_PROJECT_ID') {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new DefaultProjectContextError(errorCode);
  }
  return normalized;
}

function serializeProject(project) {
  const value = project?.toJSON ? project.toJSON() : project;
  return {
    id: String(value.id),
    name: value.name,
    status: value.status,
    website: value.website || null,
    platforms: Array.isArray(value.platforms) ? value.platforms : [],
    aliases: Array.isArray(value.aliases) ? value.aliases : [],
    primary_keywords: Array.isArray(value.primary_keywords) ? value.primary_keywords : []
  };
}

class DefaultProjectContextService {
  constructor({ Setting, BrandProject }) {
    this.Setting = Setting;
    this.BrandProject = BrandProject;
  }

  async getForUser(user) {
    try {
      const setting = await this.Setting.findOne({
        where: { key: DEFAULT_PROJECT_SETTING_KEY }
      });
      if (!setting?.value) {
        throw new DefaultProjectContextError('DEFAULT_PROJECT_NOT_CONFIGURED');
      }
      return await this.resolveForUser(user, setting.value);
    } catch (error) {
      if (error instanceof DefaultProjectContextError) throw error;
      throw new DefaultProjectContextError('DEFAULT_PROJECT_READ_FAILED');
    }
  }

  async setForUser(user, projectId) {
    if (user?.role !== 'admin') {
      throw new DefaultProjectContextError('ADMIN_REQUIRED');
    }
    const normalizedProjectId = normalizeProjectId(
      projectId,
      'DEFAULT_PROJECT_REQUEST_INVALID'
    );
    let context;
    try {
      const project = await this.BrandProject.findByPk(normalizedProjectId);
      if (!project) {
        throw new DefaultProjectContextError('PROJECT_NOT_FOUND');
      }
      if (project.status !== 'active') {
        throw new DefaultProjectContextError('DEFAULT_PROJECT_ARCHIVED');
      }
      context = {
        project: serializeProject(project),
        source: 'SYSTEM_DEFAULT'
      };
      await this.Setting.upsert({
        key: DEFAULT_PROJECT_SETTING_KEY,
        value: normalizedProjectId
      });
    } catch (error) {
      if (error instanceof DefaultProjectContextError) throw error;
      throw new DefaultProjectContextError('DEFAULT_PROJECT_READ_FAILED');
    }
    return context;
  }

  async resolveForUser(user, projectId) {
    const normalizedProjectId = normalizeProjectId(projectId);
    const project = await this.BrandProject.findByPk(normalizedProjectId);
    if (!project || project.status !== 'active') {
      throw new DefaultProjectContextError('DEFAULT_PROJECT_UNAVAILABLE');
    }
    if (user?.role !== 'admin' && String(project.user_id) !== String(user?.id)) {
      throw new DefaultProjectContextError('DEFAULT_PROJECT_FORBIDDEN');
    }
    return {
      project: serializeProject(project),
      source: 'SYSTEM_DEFAULT'
    };
  }
}

module.exports = {
  DEFAULT_PROJECT_SETTING_KEY,
  DefaultProjectContextError,
  DefaultProjectContextService
};

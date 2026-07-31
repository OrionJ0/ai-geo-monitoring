const { Setting } = require('../models');
const {
  DEFAULT_PROJECT_SETTING_KEY
} = require('./DefaultProjectContextService');

const PROTECTED_RESULT = Object.freeze({
  ok: false,
  status: 409,
  code: 'default_project_lifecycle_protected',
  message: '默认品牌不能归档或删除'
});

class DefaultProjectLifecyclePolicyService {
  async validate(project, repositories = {}) {
    if (!project) {
      return { ok: false, status: 404, message: '品牌项目不存在' };
    }
    const SettingRepository = repositories.Setting || Setting;

    const setting = await SettingRepository.findOne({
      where: { key: DEFAULT_PROJECT_SETTING_KEY }
    });
    if (setting?.value != null && String(setting.value) === String(project.id)) {
      return { ...PROTECTED_RESULT };
    }
    return { ok: true };
  }
}

module.exports = new DefaultProjectLifecyclePolicyService();

const ADMIN_REQUIRED_RESULT = Object.freeze({
  ok: false,
  status: 403,
  code: 'admin_required',
  message: '仅管理员可以修改品牌配置'
});

class ProjectAdministrationPolicyService {
  authorize(user) {
    return user?.role === 'admin'
      ? { ok: true }
      : { ...ADMIN_REQUIRED_RESULT };
  }
}

module.exports = new ProjectAdministrationPolicyService();

---
title: "完整验收发布并对齐 main"
status: open
type: release
blocked_by:
  - "004-use-manifest-report-endpoint.md"
---

# 完整验收发布并对齐 main

## 验收标准

- [ ] 后端、营销、前端、部署测试全通过；
- [ ] lint、TypeScript、OpenAPI 生成漂移和生产构建通过；
- [ ] 正式 Chrome 验收正式营销页面及 Network revision 钉扎；
- [ ] 秘密、旧路径、fallback、旧文档和 Flash 无关修改扫描通过；
- [ ] 基础及风险专项对抗审查的 P0/P1/P2 清零；
- [ ] 发布前确认 0805-002 不在发布/硬切/生产观察；
- [ ] 正式 Git Bundle、systemd、迁移 audit、公开健康和登录态入口验收通过；
- [ ] 本地 `main`、`origin/main`、服务器 `HEAD`、公开前后端 revision 完全一致。

const jwt = require('jsonwebtoken');
const User = require('../models/User');

function extractHeaderToken(req) {
  const authHeader = req.headers?.['authorization'] || '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

async function loadActiveUser(payload, res) {
  let user;
  try {
    user = await User.findByPk(payload.userId, {
      attributes: [
        'id',
        'username',
        'role',
        'status',
        'membership_level',
        'membership_expires_at'
      ]
    });
  } catch (error) {
    console.error('验证账户状态失败:', error?.message || error);
    res.status(503).json({ success: false, message: '暂时无法验证账户状态' });
    return null;
  }
  if (!user || user.status !== 'active') {
    res.status(401).json({ success: false, message: '账户已停用，请联系管理员' });
    return null;
  }
  return user;
}

function assignRequestUser(req, user) {
  req.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    level: user.membership_level || 'free',
    membershipExpiresAt: user.membership_expires_at || null,
  };
}

function createAuthRequired(tokenExtractor) {
  return async (req, res, next) => {
    try {
      const token = tokenExtractor(req);
      if (!token) {
        return res.status(401).json({ success: false, message: '未授权：缺少令牌' });
      }
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error('JWT_SECRET not configured');
        return res.status(500).json({ success: false, message: '服务器配置错误' });
      }
      const payload = jwt.verify(token, secret);
      const user = await loadActiveUser(payload, res);
      if (!user) return;
      assignRequestUser(req, user);
      return next();
    } catch (error) {
      return res.status(401).json({ success: false, message: '未授权：令牌无效或已过期' });
    }
  };
}

const authRequired = createAuthRequired(extractHeaderToken);
const authHeaderRequired = createAuthRequired(extractHeaderToken);
const authSseRequired = createAuthRequired(extractHeaderToken);

module.exports = {
  // 普通鉴权：要求有效 JWT
  authRequired,

  // 咨询详情等敏感读取只能使用 Authorization Header，拒绝 URL/Cookie 凭据。
  authHeaderRequired,

  // SSE 也只接受 Authorization Header；禁止把完整 JWT 写入 URL。
  authSseRequired,

  // 管理员鉴权：要求 role === 'admin'
  adminRequired: async (req, res, next) => {
    try {
      const token = extractHeaderToken(req);
      if (!token) {
        return res.status(401).json({ success: false, message: '未授权：缺少令牌' });
      }
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error('JWT_SECRET not configured');
        return res.status(500).json({ success: false, message: '服务器配置错误' });
      }
      const payload = jwt.verify(token, secret);
      const user = await loadActiveUser(payload, res);
      if (!user) return;
      assignRequestUser(req, user);
      if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '禁止访问：需要管理员权限' });
      }
      return next();
    } catch (error) {
      return res.status(401).json({ success: false, message: '未授权：令牌无效或已过期' });
    }
  }
};

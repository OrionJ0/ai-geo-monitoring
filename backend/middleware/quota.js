const { MembershipPlan, UsageCounter, User } = require('../models');
const { Op, literal } = require('sequelize');

// 内存缓存 MembershipPlan（极少变动），避免每次请求都查 DB
const planCache = new Map(); // key: level, value: { plan, ts }
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

function startOfPeriod(date, period) {
  const d = new Date(date);
  if (period === 'daily') {
    d.setHours(0, 0, 0, 0);
  } else if (period === 'monthly') {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

async function getPlanForLevel(level) {
  const cached = planCache.get(level);
  if (cached && Date.now() - cached.ts < PLAN_CACHE_TTL_MS) {
    return cached.plan;
  }
  const plan = await MembershipPlan.findOne({ where: { level } });
  planCache.set(level, { plan, ts: Date.now() });
  return plan;
}

// 从 JWT 的 level 获取配额上限（不查 User 表，auth 中间件已从 token 解析 level）
function getLimitFromUser(req, feature) {
  const level = (req.user && req.user.level) || 'free';
  // 检查 token 中的 membershipExpiresAt 是否已过期
  const expiresAt = req.user && req.user.membershipExpiresAt;
  const effectiveLevel = (level !== 'free' && expiresAt && new Date(expiresAt) < new Date()) ? 'free' : level;
  return getLimitForLevel(effectiveLevel, feature);
}

async function getLimitForLevel(level, feature) {
  const plan = await getPlanForLevel(level);
  if (!plan) return 0;
  if (feature === 'detection') return plan.detection_daily_limit;
  return 0;
}

// 需要查 User 表的降级路径（用于 bulkConsumeQuota/consumeQuotaDirect 等非请求场景）
async function getLimitForUser(userId, feature) {
  const user = await User.findByPk(userId);
  let level = user?.membership_level || 'free';

  if (level !== 'free' && user?.membership_expires_at) {
    if (new Date(user.membership_expires_at) < new Date()) {
      level = 'free';
    }
  }

  return getLimitForLevel(level, feature);
}

function getPeriodForFeature(feature) {
  if (feature === 'detection') return 'daily';
  return 'daily';
}

// 检查并消耗配额（常规请求路径：使用 JWT 中的 level，不查 User 表）
function checkQuota(feature) {
  return async function (req, res, next) {
    try {
      const userId = (req.user && req.user.id) || req.userId;
      if (!userId) return res.status(401).json({ success: false, message: '未登录' });
      const period = getPeriodForFeature(feature);
      const limit = await getLimitFromUser(req, feature);
      if (!limit || limit <= 0) {
        return res.status(403).json({ success: false, message: '当前会员等级不允许使用该功能' });
      }

      let counter = await UsageCounter.findOne({ where: { user_id: userId, feature, period } });
      const now = new Date();
      const shouldStart = startOfPeriod(now, period);

      if (!counter) {
        try {
          counter = await UsageCounter.create({ user_id: userId, feature, period, used_count: 0, period_start: shouldStart });
        } catch (e) {
          const isUnique = String(e?.name || '').toLowerCase().includes('unique');
          if (isUnique) {
            counter = await UsageCounter.findOne({ where: { user_id: userId, feature, period } });
          } else {
            throw e;
          }
        }
      } else {
        const currentPeriodStart = startOfPeriod(counter.period_start, period);
        if (currentPeriodStart.getTime() !== shouldStart.getTime()) {
          await counter.update({ used_count: 0, period_start: shouldStart });
        }
      }

      if (counter.used_count >= limit) {
        const msgMap = {
          detection: '今日可用检测次数已用完'
        };
        return res.status(403).json({ success: false, message: msgMap[feature] || '配额已用完' });
      }

      await counter.increment('used_count', { by: 1 });
      next();
    } catch (error) {
      console.error('配额检查失败:', error);
      res.status(500).json({ success: false, message: '配额检查失败', error: error.message });
    }
  };
}

module.exports = { checkQuota };

function resolveQuotaUserId(req, opts = {}) {
  return opts.userId || (req.user && req.user.id) || req.userId;
}

// 批量消耗配额（在路由内部按需调用）
async function bulkConsumeQuota(req, res, feature, amount, opts = {}) {
  try {
    const userId = resolveQuotaUserId(req, opts);
    if (!userId) {
      if (opts.sse) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          if (typeof res.flushHeaders === 'function') { try { res.flushHeaders(); } catch (_) {} }
        }
        res.write(`data: ${JSON.stringify({ event: 'error', message: '未登录' })}\n\n`);
        try { res.end(); } catch (_) {}
      } else {
        res.status(401).json({ success: false, message: '未登录' });
      }
      return false;
    }
    const period = getPeriodForFeature(feature);

    // 优先使用 req.user.level（JWT 路径），降级到查 DB
    const limit = req.user?.level
      ? await getLimitFromUser(req, feature)
      : await getLimitForUser(userId, feature);

    if (!limit || limit <= 0) {
      if (opts.sse) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          if (typeof res.flushHeaders === 'function') { try { res.flushHeaders(); } catch (_) {} }
        }
        res.write(`data: ${JSON.stringify({ event: 'error', message: '当前会员等级不允许使用该功能' })}\n\n`);
        try { res.end(); } catch (_) {}
      } else {
        res.status(403).json({ success: false, message: '当前会员等级不允许使用该功能' });
      }
      return false;
    }

    let counter = await UsageCounter.findOne({ where: { user_id: userId, feature, period } });
    const now = new Date();
    const shouldStart = startOfPeriod(now, period);

    if (!counter) {
      try {
        counter = await UsageCounter.create({ user_id: userId, feature, period, used_count: 0, period_start: shouldStart });
      } catch (e) {
        const isUnique = String(e?.name || '').toLowerCase().includes('unique');
        if (isUnique) {
          counter = await UsageCounter.findOne({ where: { user_id: userId, feature, period } });
        } else {
          throw e;
        }
      }
    } else {
      const currentPeriodStart = startOfPeriod(counter.period_start, period);
      if (currentPeriodStart.getTime() !== shouldStart.getTime()) {
        await counter.update({ used_count: 0, period_start: shouldStart });
      }
    }

    const nextCount = (counter.used_count || 0) + Number(amount || 0);
    if (nextCount > limit) {
      const msgMap = {
        detection: '今日可用检测次数不足'
      };
      if (opts.sse) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          if (typeof res.flushHeaders === 'function') { try { res.flushHeaders(); } catch (_) {} }
        }
        res.write(`data: ${JSON.stringify({ event: 'error', message: msgMap[feature] || '配额不足', data: { used: counter.used_count, limit, need: Number(amount || 0) } })}\n\n`);
        try { res.end(); } catch (_) {}
      } else {
        res.status(403).json({ success: false, message: msgMap[feature] || '配额不足', data: { used: counter.used_count, limit, need: Number(amount || 0) } });
      }
      return false;
    }

    await counter.increment('used_count', { by: Number(amount || 0) });
    return true;
  } catch (error) {
    console.error('批量配额消耗失败:', error);
    if (opts.sse) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        if (typeof res.flushHeaders === 'function') { try { res.flushHeaders(); } catch (_) {} }
      }
      res.write(`data: ${JSON.stringify({ event: 'error', message: '配额检查失败', error: error.message })}\n\n`);
      try { res.end(); } catch (_) {}
    } else {
      res.status(500).json({ success: false, message: '配额检查失败', error: error.message });
    }
    return false;
  }
}

module.exports.bulkConsumeQuota = bulkConsumeQuota;
module.exports.resolveQuotaUserId = resolveQuotaUserId;

// 非路由场景下的直接配额消耗（供定时任务使用）
async function consumeQuotaDirect(userId, feature, amount, options = {}) {
  try {
    const requestedAmount = Number(amount);
    if (!Number.isInteger(requestedAmount) || requestedAmount < 0) {
      return { ok: false, used: 0, limit: 0, reason: 'invalid_amount' };
    }
    const period = getPeriodForFeature(feature);
    const limit = await getLimitForUser(userId, feature);
    if (!limit || limit <= 0) {
      return { ok: false, used: 0, limit, reason: 'not_allowed' };
    }

    const transaction = options.transaction;
    const queryOptions = transaction ? { transaction } : {};
    let counter = await UsageCounter.findOne({
      where: { user_id: userId, feature, period },
      ...queryOptions
    });
    const now = new Date();
    const shouldStart = startOfPeriod(now, period);

    if (!counter) {
      try {
        counter = await UsageCounter.create(
          { user_id: userId, feature, period, used_count: 0, period_start: shouldStart },
          queryOptions
        );
      } catch (e) {
        const isUnique = String(e?.name || '').toLowerCase().includes('unique');
        if (isUnique) {
          counter = await UsageCounter.findOne({
            where: { user_id: userId, feature, period },
            ...queryOptions
          });
        } else {
          throw e;
        }
      }
    } else {
      const currentPeriodStart = startOfPeriod(counter.period_start, period);
      if (currentPeriodStart.getTime() !== shouldStart.getTime()) {
        await UsageCounter.update(
          { used_count: 0, period_start: shouldStart },
          {
            where: {
              id: counter.id,
              period_start: { [Op.lt]: shouldStart }
            },
            ...queryOptions
          }
        );
      }
    }

    if (requestedAmount === 0) {
      const current = await UsageCounter.findByPk(counter.id, queryOptions);
      return { ok: true, used: current?.used_count || 0, limit };
    }
    const [updatedRows] = await UsageCounter.update(
      { used_count: literal(`used_count + ${requestedAmount}`) },
      {
        where: {
          id: counter.id,
          used_count: { [Op.lte]: limit - requestedAmount }
        },
        ...queryOptions
      }
    );
    const current = await UsageCounter.findByPk(counter.id, queryOptions);
    if (updatedRows !== 1) {
      return { ok: false, used: current?.used_count || 0, limit, reason: 'exceeded' };
    }
    return { ok: true, used: current?.used_count || 0, limit };
  } catch (error) {
    console.error('consumeQuotaDirect 失败:', error);
    return { ok: false, used: 0, limit: 0, reason: 'error' };
  }
}

module.exports.consumeQuotaDirect = consumeQuotaDirect;

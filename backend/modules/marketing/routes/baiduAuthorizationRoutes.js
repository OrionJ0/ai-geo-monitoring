const express = require('express');
const {
  adminRequired: defaultAdminRequired
} = require('../../../middleware/auth');

const LAUNCH_COOKIE = 'marketing_launch';
const RESULT_COOKIE = 'marketing_result';
const LAUNCH_PATH = '/api/admin/marketing/baidu/authorization/launch';
const RESULT_API_PATH =
  '/api/admin/marketing/baidu/authorization-results/current';
const RESULT_PAGE_PATH = '/admin/settings/marketing/baidu/result';

function cookieHeader(name, value, {
  path,
  sameSite,
  maxAgeSeconds = 600
}) {
  return [
    `${name}=${value}`,
    `Max-Age=${maxAgeSeconds}`,
    `Path=${path}`,
    'HttpOnly',
    'Secure',
    `SameSite=${sameSite}`
  ].join('; ');
}

function readCookie(req, name) {
  return String(req.headers?.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .map((part) => part.split('='))
    .find(([key]) => key === name)?.slice(1).join('=') || '';
}

function callbackParameters(req) {
  const url = new URL(req.originalUrl || req.url, 'https://local.invalid');
  const allowedKeys = new Set([
    'appId',
    'authCode',
    'state',
    'userId',
    'timestamp',
    'signature'
  ]);
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) {
    return null;
  }
  const parameters = {};
  for (const key of allowedKeys) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1 || !values[0]) return null;
    parameters[key] = values[0];
  }
  if (
    parameters.appId.length > 512
    || parameters.authCode.length > 4096
    || parameters.state.length > 512
    || !/^\d{1,64}$/u.test(parameters.userId)
    || !/^\d{10,16}$/u.test(parameters.timestamp)
    || parameters.signature.length > 4096
  ) return null;
  return parameters;
}

function sendError(res, error) {
  return res.status(error?.status || 500).json({
    error: {
      code: error?.code || 'MARKETING_AUTHORIZATION_FAILED',
      message: error?.status && error.status < 500
        ? error.message
        : '营销授权暂时不可用'
    }
  });
}

function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
}

function createBaiduAuthorizationRouter({
  service,
  adminRequired = defaultAdminRequired
}) {
  const router = express.Router();

  router.post(
    '/authorization-attempts',
    adminRequired,
    async (req, res) => {
      try {
        const attempt = await service.createAttempt({
          adminId: req.user.id,
          operation: req.body?.operation,
          targetConnectionId: req.body?.targetConnectionId || null
        });
        noStore(res);
        res.set(
          'Set-Cookie',
          cookieHeader(LAUNCH_COOKIE, attempt.launchTicket, {
            path: LAUNCH_PATH,
            sameSite: 'Strict'
          })
        );
        return res.status(201).json({
          launchUrl: LAUNCH_PATH,
          expiresAt: attempt.expiresAt
        });
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  router.get('/authorization/launch', async (req, res) => {
    noStore(res);
    res.set(
      'Set-Cookie',
      cookieHeader(LAUNCH_COOKIE, '', {
        path: LAUNCH_PATH,
        sameSite: 'Strict',
        maxAgeSeconds: 0
      })
    );
    try {
      const launchTicket = readCookie(req, LAUNCH_COOKIE);
      const result = await service.consumeLaunch({ launchTicket });
      noStore(res);
      res.set('Location', result.authorizationUrl);
      return res.status(303).end();
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/oauth/callback', async (req, res) => {
    noStore(res);
    const parameters = callbackParameters(req);
    if (!parameters) {
      return res.status(400).json({
        error: {
          code: 'OAUTH_CALLBACK_INVALID',
          message: '授权回调参数无效'
        }
      });
    }
    try {
      const result = await service.completeCallback(parameters);
      noStore(res);
      res.set(
        'Set-Cookie',
        cookieHeader(RESULT_COOKIE, result.resultTicket, {
          path: RESULT_API_PATH,
          sameSite: 'Lax'
        })
      );
      res.set('Location', RESULT_PAGE_PATH);
      return res.status(303).end();
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get(
    '/authorization-results/current',
    adminRequired,
    async (req, res) => {
      try {
        noStore(res);
        const result = await service.consumeResult({
          resultTicket: readCookie(req, RESULT_COOKIE),
          adminId: req.user.id
        });
        res.set(
          'Set-Cookie',
          cookieHeader(RESULT_COOKIE, '', {
            path: RESULT_API_PATH,
            sameSite: 'Lax',
            maxAgeSeconds: 0
          })
        );
        return res.json(result);
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  router.get('/connections', adminRequired, async (_req, res) => {
    try {
      noStore(res);
      return res.json(await service.listConnections());
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post(
    '/connections/:connectionId/disconnect',
    adminRequired,
    async (req, res) => {
      try {
        return res.json(await service.disconnect({
          connectionId: req.params.connectionId
        }));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  return router;
}

module.exports = {
  createBaiduAuthorizationRouter
};

const express = require('express');

function createMarketingStatusRouter({ getStatus }) {
  const router = express.Router();

  router.get('/status', async (req, res) => {
    const status = await getStatus({
      includeAdminDetails: req.user?.role === 'admin'
    });
    res.set('Cache-Control', 'private, no-store');
    return res.json(status);
  });

  return router;
}

module.exports = {
  createMarketingStatusRouter
};

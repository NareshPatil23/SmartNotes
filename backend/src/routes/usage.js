const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { PLANS, getPlan } = require('../config/plans');
const { getUserUsage } = require('../services/usageService');

const router = express.Router();

/**
 * GET /api/usage
 * Get current month's usage for the authenticated user
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
    const planId = userRes.rows[0]?.plan || 'free';
    const usage = await getUserUsage(req.user.id, planId);

    return res.json({
      success: true,
      usage,
      plan: getPlan(planId)
    });
  } catch (error) {
    console.error('[Usage] Fetch usage failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/plans
 * Public endpoint to list all available subscription plans
 */
router.get('/plans', (req, res) => {
  return res.json({
    success: true,
    plans: Object.values(PLANS)
  });
});

/**
 * POST /api/subscription/upgrade
 * Direct self-upgrade is forbidden. Subscriptions must be activated via verified billing webhooks.
 */
router.post('/upgrade', requireAuth, async (req, res) => {
  return res.status(403).json({
    error: 'Direct plan self-upgrade is disabled. Subscriptions must be activated through verified payment checkout.'
  });
});

module.exports = router;

const { query } = require('../config/db');
const { getPlan } = require('../config/plans');

function getCurrentPeriod() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get or initialize current usage record for a user
 */
async function getUserUsage(userId, planId = 'free') {
  const period = getCurrentPeriod();
  const plan = getPlan(planId);

  let usageResult = await query(
    'SELECT * FROM usage WHERE user_id = $1 AND period = $2',
    [userId, period]
  );

  let record = usageResult.rows[0];

  if (!record) {
    const id = `usage_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await query(
      'INSERT INTO usage (id, user_id, period, generations_used, tokens_used, storage_used_bytes) VALUES ($1, $2, $3, 0, 0, 0)',
      [id, userId, period]
    );
    record = {
      id,
      user_id: userId,
      period,
      generations_used: 0,
      tokens_used: 0,
      storage_used_bytes: 0
    };
  }

  const generationsLeft = Math.max(0, plan.limits.generationsPerMonth - record.generations_used);

  return {
    period,
    generationsUsed: record.generations_used,
    generationsLimit: plan.limits.generationsPerMonth,
    generationsLeft,
    tokensUsed: record.tokens_used,
    storageUsedBytes: record.storage_used_bytes,
    storageLimitBytes: plan.limits.storageLimitBytes,
    plan: plan.id,
    planName: plan.name,
    canGenerate: generationsLeft > 0
  };
}

/**
 * Enforce generation quota. Throws error if quota reached unless BYOK is active.
 */
async function checkCanGenerate(userId, planId, isByok = false) {
  // BYOK users bypass platform generation quotas
  if (isByok) {
    return { allowed: true, isByok: true };
  }

  const usage = await getUserUsage(userId, planId);
  if (!usage.canGenerate) {
    const err = new Error(`Monthly generation limit reached (${usage.generationsUsed}/${usage.generationsLimit}). Please upgrade your plan or switch to Bring Your Own Key (BYOK) in AI Settings.`);
    err.status = 403;
    err.code = 'QUOTA_EXCEEDED';
    throw err;
  }

  return { allowed: true, usage };
}

/**
 * Increment generation counter after successful AI call
 */
async function recordGeneration(userId, { documentId = null, model, generationType, tokensUsed = 0, durationMs = 0, isByok = false }) {
  const period = getCurrentPeriod();
  
  // Record in generations log table
  const genId = `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await query(
    'INSERT INTO generations (id, user_id, document_id, model, generation_type, status, tokens_used, duration_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [genId, userId, documentId, model, generationType, 'success', tokensUsed, durationMs]
  );

  // If not BYOK, increment monthly usage tally
  if (!isByok) {
    await query(
      'UPDATE usage SET generations_used = generations_used + 1, tokens_used = tokens_used + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 AND period = $3',
      [tokensUsed, userId, period]
    );
  }
}

module.exports = {
  getCurrentPeriod,
  getUserUsage,
  checkCanGenerate,
  recordGeneration
};

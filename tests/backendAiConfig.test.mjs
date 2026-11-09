import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DEFAULT_GEMINI_MODEL, GEMINI_FALLBACK_MODELS, getModelsToTry } = require('../backend/src/config/aiConfig.js');
const { PLANS, getPlan } = require('../backend/src/config/plans.js');

describe('Backend AI Configuration & Model Resolution', () => {
  test('Backend default model is gemini-3.6-flash', () => {
    assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.6-flash');
    assert.deepEqual(GEMINI_FALLBACK_MODELS, [
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash'
    ]);
  });

  test('getModelsToTry prioritizes requested/preferred model and appends fallback chain', () => {
    const list = getModelsToTry('gemini-3.5-flash-lite');
    assert.deepEqual(list, [
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash'
    ]);

    const defaultList = getModelsToTry(null);
    assert.deepEqual(defaultList, [
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash'
    ]);
  });

  test('Plans reference GEMINI_FALLBACK_MODELS without hardcoded obsolete models', () => {
    const freePlan = getPlan('free');
    assert.ok(freePlan.features.models.includes('gemini-3.6-flash'));
    assert.ok(freePlan.features.models.includes('gemini-3.5-flash-lite'));
    assert.equal(freePlan.features.models.includes('gemini-3.8-flash'), false);

    const studentPlan = getPlan('student');
    assert.ok(studentPlan.features.models.includes('gemini-3.6-flash'));
    assert.equal(studentPlan.features.models.includes('gemini-3.8-flash'), false);

    const proPlan = getPlan('pro');
    assert.ok(proPlan.features.models.includes('gemini-3.6-flash'));
    assert.ok(proPlan.features.models.includes('gpt-4o'));
  });
});

/**
 * Central Backend AI Configuration
 * Single source of truth for backend Gemini model defaults and fallback chains.
 *
 * Valid model IDs as of 2026-11: gemini-3.6-flash, gemini-3.7-flash,
 *   gemini-3.5-flash-lite, gemini-3.1-flash-lite, gemini-2.5-flash
 * gemini-3.8-* does NOT exist.
 */

const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

const GEMINI_FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash'
];

function getModelsToTry(preferredModel) {
  const models = [];
  if (preferredModel && typeof preferredModel === 'string' && preferredModel.trim()) {
    models.push(preferredModel.trim());
  }
  for (const m of GEMINI_FALLBACK_MODELS) {
    if (!models.includes(m)) {
      models.push(m);
    }
  }
  return models;
}

module.exports = {
  DEFAULT_GEMINI_MODEL,
  GEMINI_FALLBACK_MODELS,
  getModelsToTry
};

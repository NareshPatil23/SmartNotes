/**
 * Central Backend AI Configuration
 * Single source of truth for backend Gemini model defaults and fallback chains.
 */

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

const GEMINI_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-lite',
  'gemini-3.1-flash-lite'
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

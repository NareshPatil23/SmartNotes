/**
 * Central Gemini Model Configuration
 * Single source of truth for default model, fallback hierarchy, and model resolution.
 *
 * Valid model IDs as of 2026-11 (source: ai.google.dev/gemini-api/docs/deprecations):
 *   gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash-lite,
 *   gemini-3.1-flash-lite, gemini-2.5-flash
 * gemini-3.8-* does NOT exist and must not be used.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

export const GEMINI_FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash'
];

export const KNOWN_GEMINI_MODELS = [
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    description: 'Latest, most capable flash model'
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash (Recommended)',
    description: 'Fast, highly capable default model for academic formatting and Q&A'
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    description: 'Ultra-fast lightweight model, lowest latency'
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    description: 'High-availability light model fallback'
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Stable legacy fallback'
  }
];

/**
 * Resolves a model against available models for the user's key.
 * If the saved model is unavailable or retired, safely falls back to the default.
 */
export function resolvePreferredModel(savedModel, availableModels = null) {
  if (Array.isArray(availableModels) && availableModels.length > 0) {
    const modelIds = availableModels.map(m => typeof m === 'string' ? m : m.id);
    if (savedModel && modelIds.includes(savedModel)) {
      return savedModel;
    }
    if (modelIds.includes(DEFAULT_GEMINI_MODEL)) {
      return DEFAULT_GEMINI_MODEL;
    }
    // Fall back to first available fallback model that exists in available list
    const fallbackMatch = GEMINI_FALLBACK_MODELS.find(m => modelIds.includes(m));
    if (fallbackMatch) return fallbackMatch;

    return modelIds[0];
  }

  // If availableModels is not yet loaded, ensure saved model is not an obsolete/retired model
  const obsoleteModels = [
    'gemini-3.8-flash',
    'gemini-3.8-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ];
  if (savedModel && !obsoleteModels.includes(savedModel)) {
    return savedModel;
  }

  return DEFAULT_GEMINI_MODEL;
}

/**
 * Returns the next model in the fallback chain.
 */
export function getNextFallbackModel(currentModel, availableModels = null) {
  const modelIds = Array.isArray(availableModels) && availableModels.length > 0
    ? availableModels.map(m => typeof m === 'string' ? m : m.id)
    : null;

  const candidateList = modelIds && modelIds.length > 0
    ? GEMINI_FALLBACK_MODELS.filter(m => modelIds.includes(m))
    : GEMINI_FALLBACK_MODELS;

  const currentIdx = candidateList.indexOf(currentModel);
  if (currentIdx !== -1 && currentIdx + 1 < candidateList.length) {
    return candidateList[currentIdx + 1];
  }

  for (const model of candidateList) {
    if (model !== currentModel) {
      return model;
    }
  }

  return null;
}

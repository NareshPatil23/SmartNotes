/**
 * Client-Side Direct Gemini API Service
 * 
 * Secure Browser-to-Google Gemini integration:
 * - API keys are stored only in localStorage/sessionStorage.
 * - Keys are NEVER sent to local or third-party servers.
 * - Keys are NEVER placed in query strings or logged.
 * - All requests are authenticated via the 'x-goog-api-key' request header.
 * - Uses Google Gemini generateContent REST API.
 */

import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_FALLBACK_MODELS,
  KNOWN_GEMINI_MODELS,
  resolvePreferredModel,
  getNextFallbackModel
} from '../config/geminiConfig.js';

const STORAGE_KEY = 'smartnotes_gemini_api_key';
const REMEMBER_KEY = 'smartnotes_gemini_remember';
const PREFERRED_MODEL_KEY = 'smartnotes_gemini_preferred_model';
const AVAILABLE_MODELS_KEY = 'smartnotes_gemini_available_models';

export const DEFAULT_MODEL = DEFAULT_GEMINI_MODEL;

/**
 * Retrieve the active Gemini API key from browser storage
 */
export function getStoredApiKey() {
  if (typeof window === 'undefined') return null;
  const sessionKey = sessionStorage.getItem(STORAGE_KEY);
  if (sessionKey && sessionKey.trim()) return sessionKey.trim();

  const localKey = localStorage.getItem(STORAGE_KEY);
  if (localKey && localKey.trim()) return localKey.trim();

  return null;
}

/**
 * Check if the user chose to remember the key on this device
 */
export function isRemembered() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(REMEMBER_KEY) === 'true';
}

/**
 * Store the Gemini API key in browser storage
 */
export function saveApiKey(key, remember = false) {
  if (typeof window === 'undefined') return;
  const cleanKey = (key || '').trim();
  if (!cleanKey) {
    removeApiKey();
    return;
  }

  if (remember) {
    localStorage.setItem(STORAGE_KEY, cleanKey);
    localStorage.setItem(REMEMBER_KEY, 'true');
    sessionStorage.removeItem(STORAGE_KEY);
  } else {
    sessionStorage.setItem(STORAGE_KEY, cleanKey);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REMEMBER_KEY);
  }
}

/**
 * Delete the key and cached model info from all browser storage
 */
export function removeApiKey() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(REMEMBER_KEY);
  localStorage.removeItem(AVAILABLE_MODELS_KEY);
}

/**
 * Clear non-remembered key upon user logout
 */
export function handleLogoutKeyCleanup() {
  if (typeof window === 'undefined') return;
  if (!isRemembered()) {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REMEMBER_KEY);
    localStorage.removeItem(AVAILABLE_MODELS_KEY);
  }
}

/**
 * Return a masked version of the key (e.g. AIza••••••••dlb0)
 */
export function getMaskedApiKey() {
  const key = getStoredApiKey();
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

/**
 * Retrieve cached available models for the user's key
 */
export function getAvailableModels() {
  if (typeof window === 'undefined') return KNOWN_GEMINI_MODELS;
  try {
    const raw = localStorage.getItem(AVAILABLE_MODELS_KEY);
    if (!raw) return KNOWN_GEMINI_MODELS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : KNOWN_GEMINI_MODELS;
  } catch (e) {
    return KNOWN_GEMINI_MODELS;
  }
}

/**
 * Save available models to storage
 */
export function saveAvailableModels(models) {
  if (typeof window === 'undefined' || !Array.isArray(models)) return;
  localStorage.setItem(AVAILABLE_MODELS_KEY, JSON.stringify(models));
}

/**
 * Retrieve user's preferred model, safely resolved against available models
 */
export function getPreferredModel() {
  if (typeof window === 'undefined') return DEFAULT_GEMINI_MODEL;
  const saved = localStorage.getItem(PREFERRED_MODEL_KEY);
  const available = getAvailableModels();
  return resolvePreferredModel(saved, available);
}

/**
 * Persist user's preferred model selection
 */
export function setPreferredModel(model) {
  if (typeof window === 'undefined' || !model) return;
  localStorage.setItem(PREFERRED_MODEL_KEY, model.trim());
}

/**
 * Friendly error parser for Gemini REST responses
 */
function parseGeminiError(status, errorObj) {
  const message = errorObj?.error?.message || '';
  const statusText = errorObj?.error?.status || '';

  if (status === 400 || message.includes('API_KEY_INVALID') || message.includes('API key not valid')) {
    return 'Invalid API key. Please check your key from Google AI Studio and try again.';
  }
  if (status === 401) {
    return 'Invalid or unauthorized API key. Please verify your Gemini API key.';
  }
  if (status === 403 || statusText === 'PERMISSION_DENIED' || message.includes('permission') || message.includes('not enabled')) {
    return 'Key without access. Ensure the Generative Language API is enabled for this Google Cloud project.';
  }
  if (status === 429 || statusText === 'RESOURCE_EXHAUSTED' || message.includes('quota') || message.includes('Quota')) {
    return 'Quota exceeded (429). Your Google Gemini API rate limit or project quota has been reached.';
  }
  if (status === 404 || statusText === 'NOT_FOUND' || message.includes('is not found') || message.includes('no longer available') || message.includes('not available')) {
    return 'This model is no longer available for your key. Choose another model in Settings.';
  }
  if (status === 503 || statusText === 'UNAVAILABLE' || message.includes('high demand') || message.includes('spikes in demand')) {
    return 'Google Gemini is currently experiencing temporary high demand (503). Automatic fallback was attempted. Please try again in a moment or choose another model in Settings.';
  }
  if (message) {
    return `Gemini API error (${status}): ${message}`;
  }
  return `Google Gemini API returned error HTTP ${status}. Please verify your key.`;
}

/**
 * Checks whether an error indicates a retired or unavailable model (404)
 */
function isModelUnavailableError(status, errorObj) {
  if (status === 404) return true;
  const msg = (errorObj?.error?.message || '').toLowerCase();
  const st = (errorObj?.error?.status || '').toUpperCase();
  return (
    st === 'NOT_FOUND' ||
    msg.includes('no longer available') ||
    msg.includes('not available') ||
    msg.includes('is not found') ||
    msg.includes('was not found')
  );
}

/**
 * Checks whether an error indicates temporary high demand or server overload (503/502/504/500)
 */
function isHighDemandOrOverloadError(status, errorObj) {
  if (status === 503 || status === 502 || status === 504 || status === 500) return true;
  const msg = (errorObj?.error?.message || '').toLowerCase();
  const st = (errorObj?.error?.status || '').toUpperCase();
  return (
    st === 'UNAVAILABLE' ||
    msg.includes('high demand') ||
    msg.includes('spikes in demand') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily unavailable')
  );
}

/**
 * Universal generation config sanitizer
 * Ensures only standard options supported across all models (flash & flash-lite) are sent.
 * Explicitly blocks unsupported reasoning/thinking configurations.
 */
export function sanitizeGenerationConfig(config = {}) {
  const safe = {};
  if (typeof config.temperature === 'number') safe.temperature = config.temperature;
  if (typeof config.maxOutputTokens === 'number') safe.maxOutputTokens = config.maxOutputTokens;
  if (typeof config.topP === 'number') safe.topP = config.topP;
  if (typeof config.topK === 'number') safe.topK = config.topK;
  if (Array.isArray(config.stopSequences)) safe.stopSequences = config.stopSequences;
  if (typeof config.responseMimeType === 'string') safe.responseMimeType = config.responseMimeType;
  return safe;
}

/**
 * Validate an API key with the GET models list endpoint
 * Zero generation quota used.
 * Extracts models supporting generateContent for this key.
 */
export async function validateGeminiApiKey(apiKey) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    return { valid: false, error: 'Please enter a Gemini API key.' };
  }

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models';

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanKey
      }
    });

    if (res.status === 429) {
      // Requirement 8: Allow saving the key even on quota limit with a clear message
      return {
        valid: true,
        warning: 'Key validated, but project quota is currently reached (429). The key has been saved.',
        quotaExceeded: true,
        availableModels: KNOWN_GEMINI_MODELS,
        models: KNOWN_GEMINI_MODELS
      };
    }

    if (!res.ok) {
      const errorJson = await res.json().catch(() => null);
      const friendlyMsg = parseGeminiError(res.status, errorJson);
      return { valid: false, error: friendlyMsg, status: res.status };
    }

    const data = await res.json().catch(() => ({}));
    const rawList = Array.isArray(data?.models) ? data.models : [];

    // Filter models supporting generateContent and map to structured objects
    const generateModels = rawList
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => {
        const id = (m.name || '').replace(/^models\//, '');
        const known = KNOWN_GEMINI_MODELS.find(k => k.id === id);
        return {
          id,
          name: known?.name || m.displayName || id,
          description: known?.description || m.description || ''
        };
      })
      .filter(m => Boolean(m.id));

    const availableModels = generateModels.length > 0 ? generateModels : KNOWN_GEMINI_MODELS;
    saveAvailableModels(availableModels);

    return {
      valid: true,
      availableModels,
      models: availableModels
    };
  } catch (err) {
    return {
      valid: false,
      error: 'Network failure: Unable to connect to Google Gemini API. Please check your internet connection.'
    };
  }
}

/**
 * Central Gemini REST Execution Gateway
 * Encapsulates all generateContent calls behind one resilient gateway.
 * Implements:
 * - Automatic single-retry fallback on 404 / retired models
 * - Setting sanitized configuration
 * - Remembering working fallback model
 * - User notification via window event 'gemini:model-fallback'
 */
export async function callGeminiGenerateContent({
  model = null,
  prompt = '',
  systemInstruction = '',
  parts = null,
  generationConfig = {},
  apiKey = null,
  onFallback = null
}) {
  const keyToUse = apiKey || getStoredApiKey();
  if (!keyToUse) {
    const err = new Error('No Gemini API key found. Please add your API key in Settings.');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const availableModels = getAvailableModels();
  let requestedModel = model ? resolvePreferredModel(model, availableModels) : getPreferredModel();

  const requestParts = Array.isArray(parts) && parts.length > 0
    ? parts
    : [{ text: prompt }];

  const cleanConfig = sanitizeGenerationConfig(generationConfig);

  const requestBody = {
    contents: [{ parts: requestParts }],
    generationConfig: cleanConfig
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  // Attempt generation with requested model, fallback once if 404 (retired) or 503 (high demand)
  let currentModel = requestedModel;
  let hasRetried = false;
  let fallbackReason = 'retired';

  while (true) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent`;

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': keyToUse
        },
        body: JSON.stringify(requestBody)
      });
    } catch (netErr) {
      throw new Error('Unable to connect to Google Gemini API. Please check your internet connection.');
    }

    if (response.ok) {
      // If we fell back and succeeded, remember working model and notify
      if (hasRetried) {
        setPreferredModel(currentModel);
        if (typeof onFallback === 'function') {
          onFallback(currentModel, requestedModel, fallbackReason);
        }
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          const reasonMsg = fallbackReason === 'retired'
            ? `Notice: Switched to ${currentModel} as ${requestedModel} is no longer available.`
            : `Notice: Switched to ${currentModel} as ${requestedModel} is currently experiencing temporary high demand (503).`;
          window.dispatchEvent(new CustomEvent('gemini:model-fallback', {
            detail: {
              activeModel: currentModel,
              previousModel: requestedModel,
              toModel: currentModel,
              fromModel: requestedModel,
              reason: fallbackReason,
              message: reasonMsg
            }
          }));
        }
      }
      const data = await response.json();
      return data;
    }

    const errorJson = await response.json().catch(() => null);

    // 1. Check if error is 404 / model retired
    if (isModelUnavailableError(response.status, errorJson) && !hasRetried) {
      const fallbackModel = getNextFallbackModel(currentModel, availableModels);
      if (fallbackModel && fallbackModel !== currentModel) {
        hasRetried = true;
        fallbackReason = 'retired';
        currentModel = fallbackModel;
        continue;
      }
    }

    // 2. Check if error is 503 / high demand / temporary overload
    if (isHighDemandOrOverloadError(response.status, errorJson) && !hasRetried) {
      const fallbackModel = getNextFallbackModel(currentModel, availableModels);
      if (fallbackModel && fallbackModel !== currentModel) {
        hasRetried = true;
        fallbackReason = 'high_demand';
        currentModel = fallbackModel;
        continue;
      }
    }

    // If fallback was already attempted or no fallback model is available:
    if (isModelUnavailableError(response.status, errorJson)) {
      const err = new Error('This model is no longer available for your key. Choose another model in Settings.');
      err.status = 404;
      err.details = errorJson;
      throw err;
    }

    const friendlyMsg = parseGeminiError(response.status, errorJson);
    const err = new Error(friendlyMsg);
    err.status = response.status;
    err.details = errorJson;
    throw err;
  }
}

/**
 * Direct browser call to generate text content with Gemini
 */
export async function generateGeminiContent({
  prompt,
  systemInstruction = '',
  model = null,
  apiKey = null,
  generationConfig = {}
}) {
  const data = await callGeminiGenerateContent({
    prompt,
    systemInstruction,
    model,
    apiKey,
    generationConfig: {
      temperature: 0.2,
      ...generationConfig
    }
  });

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Format academic study notes directly in the browser
 */
export async function formatNotesDirect({ text, isHandwritten = false, model = null, apiKey = null }) {
  if (!text || !text.trim()) {
    throw new Error('No text provided to format.');
  }

  const systemInstruction = `You are a Professional Academic Note Formatter. Transform the input into a structured educational note using clean semantic HTML and standard LaTeX math ($ for inline, $$ for block).

${isHandwritten ? `HANDWRITTEN MODE:
- Start questions with <h2 class="qa-question">Q1. ...</h2>
- Use <h2> and <h3> section headings.
- Use <strong> for terms, <mark> for vital definitions, and <ul>/<li> for lists.
- Do NOT output <style> tags or inline styles.` : `MODERN MODE:
- Use clean layout with <h1> titles, <h2> sections, <blockquote> definitions.
- Convert formulas into $$...$$ or $...$.
- Wrap code blocks in <pre><code class="language-[lang]">[code]</code></pre>.
- Wrap tables in standard <table>, <thead>, <tbody>, <th>, <td>.
- Wrap text/ASCII diagrams in <div class="mermaid">...</div>.`}

STRICT WORD FIDELITY:
- Retain all core academic content and wording accurately, adding semantic formatting and LaTeX math.`;

  const rawOutput = await generateGeminiContent({
    prompt: `Transform this academic study text into clean formatted HTML with LaTeX:\n\n${text}`,
    systemInstruction,
    model,
    apiKey
  });

  let cleanHtml = rawOutput.trim();
  if (cleanHtml.startsWith('```html')) {
    cleanHtml = cleanHtml.slice(7);
  } else if (cleanHtml.startsWith('```')) {
    cleanHtml = cleanHtml.slice(3);
  }
  if (cleanHtml.endsWith('```')) {
    cleanHtml = cleanHtml.slice(0, -3);
  }
  return cleanHtml.trim();
}

/**
 * Ask PDF conversational chat directly via browser
 */
export async function askPdfChatDirect({ messages, pdfText, constraints = [], model = null, apiKey = null }) {
  const constraintList = constraints && constraints.length > 0
    ? constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : 'No strict formatting constraints.';

  const systemInstruction = `You are an expert academic AI study tutor.
TEXTBOOK CONTENT CONTEXT:
"""
${pdfText || 'No PDF content provided.'}
"""

STRICT ANSWER CONSTRAINTS:
${constraintList}

INSTRUCTIONS:
1. Answer the user's question accurately based strictly on the textbook context when relevant.
2. Follow all formatting constraints exactly.
3. Be structured, concise, and encourage deep conceptual understanding.`;

  const conversationTranscript = messages.map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`).join('\n\n');
  const lastQuestion = messages[messages.length - 1]?.content || '';

  const prompt = `Conversation History:\n${conversationTranscript}\n\nStudent's latest question: ${lastQuestion}\n\nProvide your tutoring response adhering to all constraints:`;

  return await generateGeminiContent({
    prompt,
    systemInstruction,
    model,
    apiKey
  });
}

/**
 * Extract Q&A study notes directly in the browser
 */
export async function extractNotesDirect({ text, inlineData = null, model = null, apiKey = null }) {
  const systemInstruction = `You are an expert academic text-to-HTML study note generation tool.
Extract comprehensive Question and Answer study pairs from the material.
For the "answer" field, return beautifully formatted semantic HTML (<p>, <strong>, <ul>, <li>, <mark>, <table>, <pre><code>).
Use $$...$$ for block math and $...$ for inline math.

CRITICAL OUTPUT FORMAT:
Output ONLY a raw valid JSON array:
[
  {
    "question": "Question text here",
    "answer": "<p>Detailed structured HTML answer</p>",
    "marks": "5"
  }
]`;

  const promptText = `Analyze this material and generate comprehensive educational study Q&A pairs:\n\n${text || 'Extract all key questions and answers from the attached document.'}`;

  const parts = [{ text: promptText }];
  if (inlineData) {
    parts.unshift({ inlineData });
  }

  const data = await callGeminiGenerateContent({
    parts,
    systemInstruction,
    model,
    apiKey,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  });

  const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  
  let cleaned = rawJson.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);

  try {
    return JSON.parse(cleaned.trim());
  } catch (err) {
    const qaList = [];
    const re = /\{\s*"question"\s*:\s*"([\s\S]*?)"\s*,\s*"answer"\s*:\s*"([\s\S]*?)"(?:\s*,\s*"marks"\s*:\s*"([\s\S]*?)")?\s*\}/gi;
    let match;
    while ((match = re.exec(cleaned)) !== null) {
      qaList.push({
        question: match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        answer: match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        marks: match[3] || '5'
      });
    }
    if (qaList.length > 0) return qaList;
    throw new Error('AI returned an unexpected format. Please try again.');
  }
}

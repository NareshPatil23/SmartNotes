import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Set up mock browser environment for geminiClient
const createMockStorage = () => {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    _dump: () => store
  };
};

const mockLocalStorage = createMockStorage();
const mockSessionStorage = createMockStorage();
const eventListeners = {};

global.window = {
  localStorage: mockLocalStorage,
  sessionStorage: mockSessionStorage,
  addEventListener: (event, handler) => {
    if (!eventListeners[event]) eventListeners[event] = [];
    eventListeners[event].push(handler);
  },
  removeEventListener: (event, handler) => {
    if (eventListeners[event]) {
      eventListeners[event] = eventListeners[event].filter(h => h !== handler);
    }
  },
  dispatchEvent: (event) => {
    const list = eventListeners[event.type] || [];
    for (const h of list) h(event);
    return true;
  }
};
global.localStorage = mockLocalStorage;
global.sessionStorage = mockSessionStorage;
global.CustomEvent = class CustomEvent {
  constructor(type, eventInitDict = {}) {
    this.type = type;
    this.detail = eventInitDict.detail;
  }
};

// Import client and config modules
const {
  validateGeminiApiKey,
  callGeminiGenerateContent,
  generateGeminiContent,
  formatNotesDirect,
  extractNotesDirect,
  getPreferredModel,
  setPreferredModel,
  getAvailableModels,
  saveApiKey,
  getStoredApiKey,
  removeApiKey,
  sanitizeGenerationConfig
} = await import('../frontend/src/services/geminiClient.js');

const {
  DEFAULT_GEMINI_MODEL,
  GEMINI_FALLBACK_MODELS,
  KNOWN_GEMINI_MODELS,
  resolvePreferredModel,
  getNextFallbackModel
} = await import('../frontend/src/config/geminiConfig.js');

describe('Gemini Model Configuration & Central Architecture', () => {
  test('Central configuration defaults to gemini-3.8-flash and ordered fallbacks', () => {
    assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
    assert.deepEqual(GEMINI_FALLBACK_MODELS, [
      'gemini-3.8-flash',
      'gemini-3.8-flash-lite',
      'gemini-3.1-flash-lite'
    ]);
  });

  test('resolvePreferredModel safely handles legacy or retired models by falling back to default', () => {
    // Legacy models that no longer exist for new projects
    assert.equal(resolvePreferredModel('gemini-2.5-flash'), 'gemini-3.8-flash');
    assert.equal(resolvePreferredModel('gemini-1.5-flash'), 'gemini-3.8-flash');
    assert.equal(resolvePreferredModel('gemini-2.0-flash'), 'gemini-3.8-flash');
    assert.equal(resolvePreferredModel(null), 'gemini-3.8-flash');

    // Valid modern model
    assert.equal(resolvePreferredModel('gemini-3.8-flash'), 'gemini-3.8-flash');
    assert.equal(resolvePreferredModel('gemini-3.8-flash-lite'), 'gemini-3.8-flash-lite');

    // Filter against available models list
    const available = [{ id: 'gemini-3.8-flash-lite', name: 'Lite' }];
    assert.equal(resolvePreferredModel('gemini-2.5-flash', available), 'gemini-3.8-flash-lite');
  });

  test('getNextFallbackModel walks the fallback chain in order', () => {
    assert.equal(getNextFallbackModel('gemini-3.8-flash'), 'gemini-3.8-flash-lite');
    assert.equal(getNextFallbackModel('gemini-3.8-flash-lite'), 'gemini-3.1-flash-lite');
    // If on retired model not in list, returns first fallback
    assert.equal(getNextFallbackModel('gemini-2.5-flash'), 'gemini-3.8-flash');
  });

  test('sanitizeGenerationConfig strips model-specific reasoning/thinking options', () => {
    const dirtyConfig = {
      temperature: 0.3,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingBudget: 100 },
      reasoning_effort: 'high',
      responseMimeType: 'application/json'
    };
    const clean = sanitizeGenerationConfig(dirtyConfig);
    assert.equal(clean.temperature, 0.3);
    assert.equal(clean.maxOutputTokens, 2048);
    assert.equal(clean.responseMimeType, 'application/json');
    assert.equal(clean.thinkingConfig, undefined);
    assert.equal(clean.reasoning_effort, undefined);
  });
});

describe('Gemini Key Validation & Models List Endpoint', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    mockSessionStorage.clear();
  });

  test('Test 1: Valid key validation via GET /v1beta/models (zero token quota used)', async () => {
    let capturedUrl = '';
    let capturedHeaders = {};

    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              name: 'models/gemini-3.8-flash',
              displayName: 'Gemini 3.8 Flash',
              description: 'Fast versatile model',
              supportedGenerationMethods: ['generateContent', 'countTokens']
            },
            {
              name: 'models/gemini-3.8-flash-lite',
              displayName: 'Gemini 3.8 Flash Lite',
              description: 'Lightweight model',
              supportedGenerationMethods: ['generateContent']
            },
            {
              name: 'models/embedding-001',
              displayName: 'Embeddings Only',
              description: 'Embedding model',
              supportedGenerationMethods: ['embedContent'] // Should be excluded!
            }
          ]
        })
      };
    };

    const res = await validateGeminiApiKey('AIzaSyTestValidKey123');
    assert.equal(res.valid, true);
    assert.equal(res.models.length, 2);
    assert.equal(res.models[0].id, 'gemini-3.8-flash');
    assert.equal(res.models[1].id, 'gemini-3.8-flash-lite');

    // Confirm it used the GET /v1beta/models endpoint without query param key
    assert.equal(capturedUrl, 'https://generativelanguage.googleapis.com/v1beta/models');
    assert.equal(capturedHeaders['x-goog-api-key'], 'AIzaSyTestValidKey123');
    assert.equal(capturedUrl.includes('key='), false, 'API key must not be present in URL query');

    // Confirm available models saved to browser storage
    const stored = getAvailableModels();
    assert.equal(stored.length, 2);
    assert.equal(stored[0].id, 'gemini-3.8-flash');
  });

  test('Test 2: Invalid key (400 / 401) produces friendly error', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 400,
          message: 'API_KEY_INVALID',
          status: 'INVALID_ARGUMENT'
        }
      })
    });

    const res = await validateGeminiApiKey('invalid-key-xyz');
    assert.equal(res.valid, false);
    assert.match(res.error, /Invalid API key/i);
  });

  test('Test 3: 429 Quota Exceeded allows saving the key with clear warning', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          code: 429,
          message: 'Resource has been exhausted (e.g. check quota).',
          status: 'RESOURCE_EXHAUSTED'
        }
      })
    });

    const res = await validateGeminiApiKey('AIzaSyExhaustedQuotaKey');
    assert.equal(res.valid, true);
    assert.equal(res.quotaExceeded, true);
    assert.match(res.warning, /quota.*429/i);
    assert.ok(res.models && res.models.length > 0);
  });

  test('Test 4: 403 Permission Denied shows permission guidance', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: 403,
          message: 'Generative Language API has not been used in project 12345 before or it is disabled.',
          status: 'PERMISSION_DENIED'
        }
      })
    });

    const res = await validateGeminiApiKey('AIzaSyForbiddenProjectKey');
    assert.equal(res.valid, false);
    assert.match(res.error, /Key without access.*Generative Language API/i);
  });

  test('Test 5: Retired-model 404 automatically retries once with fallback and remembers working model', async () => {
    const attemptedModels = [];
    let fallbackNotified = null;

    window.addEventListener('gemini:model-fallback', (e) => {
      fallbackNotified = e.detail;
    });

    global.fetch = async (url, options) => {
      const match = url.match(/models\/([^:]+):generateContent/);
      const model = match ? match[1] : '';
      attemptedModels.push(model);

      if (model === 'gemini-3.8-flash') {
        return {
          ok: false,
          status: 404,
          json: async () => ({
            error: {
              code: 404,
              message: 'This model models/gemini-3.8-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash-lite.',
              status: 'NOT_FOUND'
            }
          })
        };
      }

      // Fallback model succeeds
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: 'Generated notes from fallback model.' }]
              }
            }
          ]
        })
      };
    };

    saveApiKey('AIzaSyWorkingFallbackKey', true);
    setPreferredModel('gemini-3.8-flash');

    const result = await generateGeminiContent({
      prompt: 'Format this lecture',
      model: 'gemini-3.8-flash'
    });

    assert.equal(result, 'Generated notes from fallback model.');
    assert.deepEqual(attemptedModels, ['gemini-3.8-flash', 'gemini-3.8-flash-lite']);

    // Check that working model was remembered
    assert.equal(getPreferredModel(), 'gemini-3.8-flash-lite');

    // Check fallback event notification
    assert.ok(fallbackNotified);
    assert.equal(fallbackNotified.fromModel, 'gemini-3.8-flash');
    assert.equal(fallbackNotified.toModel, 'gemini-3.8-flash-lite');
  });

  test('Test 6: Retired-model 404 where all fallbacks fail shows friendly message', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({
        error: {
          code: 404,
          message: 'Model is not found',
          status: 'NOT_FOUND'
        }
      })
    });

    saveApiKey('AIzaSyTestKey', true);

    await assert.rejects(
      async () => {
        await generateGeminiContent({
          prompt: 'Format lecture',
          model: 'gemini-3.1-flash-lite'
        });
      },
      (err) => {
        assert.match(err.message, /This model is no longer available for your key\. Choose another model in Settings\./i);
        return true;
      }
    );
  });

  test('Test 7: Network failure throws clean connection error', async () => {
    global.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };

    saveApiKey('AIzaSyTestKey', true);

    await assert.rejects(
      async () => {
        await generateGeminiContent({
          prompt: 'Format lecture',
          model: 'gemini-3.8-flash'
        });
      },
      (err) => {
        assert.match(err.message, /Unable to connect to Google Gemini API\. Please check your internet connection\./i);
        return true;
      }
    );
  });

  test('Test 8: Note generation with gemini-3.8-flash succeeds', async () => {
    let capturedUrl = '';
    let capturedHeaders = {};

    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '<h1>TCP Handshake</h1><p>Three-way SYN, SYN-ACK, ACK sequence.</p>'
                  }
                ]
              }
            }
          ]
        })
      };
    };

    saveApiKey('AIzaSyValidKey', true);
    const result = await formatNotesDirect({
      text: 'Explain 3-way handshake in TCP',
      model: 'gemini-3.8-flash'
    });

    assert.ok(result);
    assert.match(result, /TCP Handshake/);
    assert.match(capturedUrl, /gemini-3\.8-flash:generateContent/);
    assert.equal(capturedHeaders['x-goog-api-key'], 'AIzaSyValidKey');
  });

  test('Test 9: Chat import with gemini-3.8-flash extracts structured Q&A', async () => {
    global.fetch = async (url, options) => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    {
                      question: 'What is a distributed lock?',
                      answer: '<p>A mechanism to ensure mutual exclusion across multiple nodes.</p>'
                    },
                    {
                      question: 'What is the Raft consensus algorithm?',
                      answer: '<p>A consensus protocol designed to be understandable and fault-tolerant.</p>'
                    }
                  ])
                }
              ]
            }
          }
        ]
      })
    });

    saveApiKey('AIzaSyValidKey', true);
    const qaItems = await extractNotesDirect({
      text: 'User: What is a distributed lock? Assistant: A mechanism to ensure mutual exclusion...',
      model: 'gemini-3.8-flash'
    });

    assert.equal(Array.isArray(qaItems), true);
    assert.equal(qaItems.length, 2);
    assert.equal(qaItems[0].question, 'What is a distributed lock?');
    assert.match(qaItems[0].answer, /mutual exclusion/);
  });
});

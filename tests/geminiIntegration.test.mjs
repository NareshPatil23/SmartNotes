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
  formatBlockWithRetry,
  isAlreadyFormatted,
  runWithConcurrency,
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

const {
  formatAnswerWithDiagrams,
  hasMermaidDiagram,
  isMermaidCode
} = await import('../frontend/src/utils/mermaidHelper.js');

describe('Gemini Model Configuration & Central Architecture', () => {
  test('Central configuration defaults to gemini-3.6-flash and ordered fallbacks', () => {
    assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.6-flash');
    assert.deepEqual(GEMINI_FALLBACK_MODELS, [
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash'
    ]);
  });

  test('resolvePreferredModel safely handles legacy or retired models by falling back to default', () => {
    // gemini-3.8-* does not exist — treat as obsolete
    assert.equal(resolvePreferredModel('gemini-3.8-flash'), 'gemini-3.6-flash');
    assert.equal(resolvePreferredModel('gemini-3.8-flash-lite'), 'gemini-3.6-flash');
    // Other retired models
    assert.equal(resolvePreferredModel('gemini-1.5-flash'), 'gemini-3.6-flash');
    assert.equal(resolvePreferredModel('gemini-2.0-flash'), 'gemini-3.6-flash');
    assert.equal(resolvePreferredModel(null), 'gemini-3.6-flash');

    // Valid modern models pass through
    assert.equal(resolvePreferredModel('gemini-3.6-flash'), 'gemini-3.6-flash');
    assert.equal(resolvePreferredModel('gemini-3.7-flash'), 'gemini-3.7-flash');
    assert.equal(resolvePreferredModel('gemini-3.5-flash-lite'), 'gemini-3.5-flash-lite');
    assert.equal(resolvePreferredModel('gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite');

    // Filter against available models list — falls to first match
    const available = [{ id: 'gemini-3.5-flash-lite', name: 'Lite' }];
    assert.equal(resolvePreferredModel('gemini-3.8-flash', available), 'gemini-3.5-flash-lite');
  });

  test('getNextFallbackModel walks the fallback chain in order', () => {
    assert.equal(getNextFallbackModel('gemini-3.6-flash'), 'gemini-3.7-flash');
    assert.equal(getNextFallbackModel('gemini-3.7-flash'), 'gemini-3.5-flash-lite');
    assert.equal(getNextFallbackModel('gemini-3.5-flash-lite'), 'gemini-3.1-flash-lite');
    // If on a model not in the list, returns first fallback
    assert.equal(getNextFallbackModel('gemini-3.8-flash'), 'gemini-3.6-flash');
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
              name: 'models/gemini-3.6-flash',
              displayName: 'Gemini 3.6 Flash',
              description: 'Fast versatile model',
              supportedGenerationMethods: ['generateContent', 'countTokens']
            },
            {
              name: 'models/gemini-3.5-flash-lite',
              displayName: 'Gemini 3.5 Flash Lite',
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
    assert.equal(res.models[0].id, 'gemini-3.6-flash');
    assert.equal(res.models[1].id, 'gemini-3.5-flash-lite');

    // Confirm it used the GET /v1beta/models endpoint without query param key
    assert.equal(capturedUrl, 'https://generativelanguage.googleapis.com/v1beta/models');
    assert.equal(capturedHeaders['x-goog-api-key'], 'AIzaSyTestValidKey123');
    assert.equal(capturedUrl.includes('key='), false, 'API key must not be present in URL query');

    // Confirm available models saved to browser storage
    const stored = getAvailableModels();
    assert.equal(stored.length, 2);
    assert.equal(stored[0].id, 'gemini-3.6-flash');
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

    // Simulate: gemini-3.6-flash returns 404 (retired for this key), gemini-3.7-flash succeeds
    global.fetch = async (url, options) => {
      const match = url.match(/models\/([^:]+):generateContent/);
      const model = match ? match[1] : '';
      attemptedModels.push(model);

      if (model === 'gemini-3.6-flash') {
        return {
          ok: false,
          status: 404,
          json: async () => ({
            error: {
              code: 404,
              message: 'This model models/gemini-3.6-flash is no longer available to new users. Please update your code to use models/gemini-3.7-flash.',
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
    setPreferredModel('gemini-3.6-flash');

    const result = await generateGeminiContent({
      prompt: 'Format this lecture',
      model: 'gemini-3.6-flash'
    });

    assert.equal(result, 'Generated notes from fallback model.');
    assert.deepEqual(attemptedModels, ['gemini-3.6-flash', 'gemini-3.7-flash']);

    // Check that working model was remembered
    assert.equal(getPreferredModel(), 'gemini-3.7-flash');

    // Check fallback event notification
    assert.ok(fallbackNotified);
    assert.equal(fallbackNotified.fromModel, 'gemini-3.6-flash');
    assert.equal(fallbackNotified.toModel, 'gemini-3.7-flash');
  });

  test('Test 5b: 503 High demand automatically retries once with fallback and remembers working model', async () => {
    const attemptedModels = [];
    let fallbackNotified = null;

    window.addEventListener('gemini:model-fallback', (e) => {
      fallbackNotified = e.detail;
    });

    global.fetch = async (url, options) => {
      const match = url.match(/models\/([^:]+):generateContent/);
      const model = match ? match[1] : '';
      attemptedModels.push(model);

      if (model === 'gemini-3.6-flash') {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            error: {
              code: 503,
              message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
              status: 'UNAVAILABLE'
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
                parts: [{ text: 'Formatted notes generated via fallback model.' }]
              }
            }
          ]
        })
      };
    };

    saveApiKey('AIzaSyWorking503FallbackKey', true);
    setPreferredModel('gemini-3.6-flash');

    const result = await generateGeminiContent({
      prompt: 'Format this note',
      model: 'gemini-3.6-flash'
    });

    assert.equal(result, 'Formatted notes generated via fallback model.');
    assert.deepEqual(attemptedModels, ['gemini-3.6-flash', 'gemini-3.7-flash']);

    // Working model is remembered
    assert.equal(getPreferredModel(), 'gemini-3.7-flash');

    // Check fallback notification
    assert.ok(fallbackNotified);
    assert.equal(fallbackNotified.fromModel, 'gemini-3.6-flash');
    assert.equal(fallbackNotified.toModel, 'gemini-3.7-flash');
    assert.equal(fallbackNotified.reason, 'high_demand');
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
          model: 'gemini-3.6-flash'
        });
      },
      (err) => {
        assert.match(err.message, /Unable to connect to Google Gemini API\. Please check your internet connection\./i);
        return true;
      }
    );
  });

  test('Test 8: Note generation with gemini-3.6-flash succeeds', async () => {
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
      model: 'gemini-3.6-flash'
    });

    assert.ok(result);
    assert.match(result, /TCP Handshake/);
    assert.match(capturedUrl, /gemini-3\.6-flash:generateContent/);
    assert.equal(capturedHeaders['x-goog-api-key'], 'AIzaSyValidKey');
  });

  test('Test 9: Chat import with gemini-3.6-flash extracts structured Q&A', async () => {
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
      model: 'gemini-3.6-flash'
    });

    assert.equal(Array.isArray(qaItems), true);
    assert.equal(qaItems.length, 2);
    assert.equal(qaItems[0].question, 'What is a distributed lock?');
    assert.match(qaItems[0].answer, /mutual exclusion/);
  });
});

describe('Diagram Recognition & Hydration for GPT Paste', () => {
  test('isMermaidCode identifies various diagram types without code fences', () => {
    assert.equal(isMermaidCode('flowchart TD\n  A --> B'), true);
    assert.equal(isMermaidCode('graph TD\n  Start[Start] --> End[End]'), true);
    assert.equal(isMermaidCode('sequenceDiagram\n  Alice->>Bob: Hello'), true);
    assert.equal(isMermaidCode('classDiagram\n  class BankAccount'), true);
    assert.equal(isMermaidCode('stateDiagram-v2\n  [*] --> Still'), true);
    assert.equal(isMermaidCode('erDiagram\n  CUSTOMER ||--o{ ORDER : places'), true);
    assert.equal(isMermaidCode('mindmap\n  root((mindmap))\n    Origins'), true);
    assert.equal(isMermaidCode('Just regular text about biology'), false);
  });

  test('formatAnswerWithDiagrams converts ```mermaid blocks from GPT into hydrated containers', () => {
    const gptText = 'Here is the architecture diagram:\n\n```mermaid\nflowchart TD\n  Client --> Server\n  Server --> Database\n```\n\nHope this helps!';
    const formatted = formatAnswerWithDiagrams(gptText);
    assert.match(formatted, /class="mermaid-diagram-container"/);
    assert.match(formatted, /data-mermaid-code="flowchart%20TD/);
  });

  test('formatAnswerWithDiagrams converts raw flowchart pasted from GPT without backticks', () => {
    const rawGptDiagram = 'flowchart TD\n  A[Input Data] --> B[Process]\n  B --> C[Output Result]';
    const formatted = formatAnswerWithDiagrams(rawGptDiagram);
    assert.match(formatted, /class="mermaid-diagram-container"/);
    assert.match(formatted, /data-mermaid-code="flowchart%20TD/);
  });

  test('formatAnswerWithDiagrams converts HTML pre code blocks pasted from ChatGPT web', () => {
    const chatGptWebHtml = '<p>Diagram below:</p><pre><code class="language-mermaid">graph TD\n  A --> B\n  B --> C</code></pre>';
    const formatted = formatAnswerWithDiagrams(chatGptWebHtml);
    assert.match(formatted, /class="mermaid-diagram-container"/);
    assert.match(formatted, /data-mermaid-code="graph%20TD/);
  });

  test('formatAnswerWithDiagrams converts <div class="mermaid"> blocks produced by Gemini format', () => {
    const geminiHtml = '<h1>Photosynthesis</h1><div class="mermaid">graph LR\n  Light --> Chlorophyll\n  Chlorophyll --> ATP</div>';
    const formatted = formatAnswerWithDiagrams(geminiHtml);
    assert.match(formatted, /class="mermaid-diagram-container"/);
    assert.match(formatted, /data-mermaid-code="graph%20LR/);
  });
});

describe('Format All: Block Detection, Concurrency, and 429 Exponential Backoff', () => {
  test('isAlreadyFormatted relies on explicit formattedByAI flag, not content shape', () => {
    // Null/undefined/empty
    assert.equal(isAlreadyFormatted(null), false);
    assert.equal(isAlreadyFormatted(undefined), false);
    assert.equal(isAlreadyFormatted(''), false);

    // Block with headings and bullets pasted from GPT or written manually WITHOUT formattedByAI flag
    const pastedGptBlock = {
      question: 'What is TCP?',
      answer: '<h2>Transmission Control Protocol</h2><ul><li>Reliable byte stream</li><li>Three-way handshake</li></ul>'
    };
    assert.equal(
      isAlreadyFormatted(pastedGptBlock),
      false,
      'Blocks with headings and bullets but no formattedByAI flag must NOT be considered already formatted'
    );

    // Block formatted by Gemini with explicit formattedByAI: true flag
    const aiFormattedBlock = {
      question: 'What is TCP?',
      answer: '<h2>Transmission Control Protocol</h2><ul><li>Reliable byte stream</li><li>Three-way handshake</li></ul>',
      formattedByAI: true,
      formattedModel: 'gemini-3.6-flash',
      formattedAt: Date.now()
    };
    assert.equal(isAlreadyFormatted(aiFormattedBlock), true);
  });

  test('A block with headings and bullets but no formattedByAI flag must be sent to Gemini', async () => {
    saveApiKey('AIzaSyValidKey', true);
    let capturedPrompt = '';

    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      capturedPrompt = body.contents[0].parts[0].text;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '<h2>Formatted by Gemini</h2><ul><li>Enhanced point</li></ul>' }]
              }
            }
          ]
        })
      };
    };

    // A block with headings and bullets, e.g. pasted from ChatGPT or external source
    const rawPastedBlock = {
      question: 'Distributed Consensus',
      answer: '<h2>Raft Protocol</h2><ul><li>Leader election</li><li>Log replication</li></ul>'
      // Notice: NO formattedByAI flag!
    };

    // Should NOT be skipped
    assert.equal(isAlreadyFormatted(rawPastedBlock), false);

    // Filter logic as used in Workspace
    const shouldFormat = !isAlreadyFormatted(rawPastedBlock) && Boolean(rawPastedBlock.answer.trim());
    assert.equal(shouldFormat, true, 'Block must be selected for formatting');

    // Simulate formatting
    const formattedHtml = await formatBlockWithRetry({
      text: rawPastedBlock.answer,
      model: 'gemini-3.6-flash'
    });

    const now = Date.now();
    const updatedBlock = {
      ...rawPastedBlock,
      answer: formattedHtml,
      formattedByAI: true,
      formattedModel: 'gemini-3.6-flash',
      formattedAt: now
    };

    assert.ok(capturedPrompt.includes('Raft Protocol'), 'Raw text must have been sent to Gemini');
    assert.match(updatedBlock.answer, /<h2>Formatted by Gemini<\/h2>/);
    assert.equal(updatedBlock.formattedByAI, true);
    assert.equal(updatedBlock.formattedModel, 'gemini-3.6-flash');
    assert.equal(typeof updatedBlock.formattedAt, 'number');

    // Second check without force reformat: now it IS recognized as already formatted
    assert.equal(isAlreadyFormatted(updatedBlock), true, 'Now that formattedByAI is true, it is recognized as already formatted');
  });

  test('runWithConcurrency runs at most 3 tasks at a time', async () => {
    let activeTasks = 0;
    let maxConcurrency = 0;
    const completedTasks = [];

    const tasks = Array.from({ length: 9 }, (_, i) => async () => {
      activeTasks++;
      if (activeTasks > maxConcurrency) maxConcurrency = activeTasks;
      await new Promise(r => setTimeout(r, 20));
      activeTasks--;
      return `Result ${i}`;
    });

    const results = await runWithConcurrency(tasks, 3, (res, idx) => {
      completedTasks.push({ res, idx });
    });

    assert.equal(results.length, 9);
    assert.equal(completedTasks.length, 9);
    assert.ok(maxConcurrency <= 3, `Max concurrency should not exceed 3, but was ${maxConcurrency}`);
    assert.ok(maxConcurrency >= 2, `Concurrency should be parallel (at least 2, was ${maxConcurrency})`);
  });

  test('formatBlockWithRetry retries on 429 with exponential backoff and succeeds', async () => {
    saveApiKey('AIzaSyValidKey', true);
    let attempts = 0;

    global.fetch = async () => {
      attempts++;
      if (attempts < 3) {
        // Return 429 on first 2 attempts
        return {
          ok: false,
          status: 429,
          json: async () => ({
            error: {
              code: 429,
              message: 'Resource exhausted / quota rate limit reached',
              status: 'RESOURCE_EXHAUSTED'
            }
          })
        };
      }
      // Succeeds on 3rd attempt
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '<h2>Formatted Note</h2><ul><li>Point A</li></ul>' }]
              }
            }
          ]
        })
      };
    };

    const result = await formatBlockWithRetry({
      text: 'Unformatted text for retry test',
      model: 'gemini-3.6-flash'
    });

    assert.match(result, /<h2>Formatted Note<\/h2>/);
    assert.equal(attempts, 3, 'Should have retried twice and succeeded on 3rd attempt');
  });

  test('Format All simulation: real counts with skipped (already formatted), skipped (empty), and failed', async () => {
    saveApiKey('AIzaSyValidKey', true);

    // Setup 11 questions
    // Q0: Empty
    // Q1: Already formatted (has formattedByAI: true)
    // Q2: Pasted from GPT with headings & bullets (NO flag -> MUST be formatted!)
    // Q3..Q9: Unformatted raw draft answers
    // Q10: Simulated persistent 429 failure
    const rawQuestions = [
      { question: 'Q0', answer: '<p><br></p>' },
      {
        question: 'Q1',
        answer: '<h2>Existing</h2><ul><li>Already formatted</li></ul>',
        formattedByAI: true,
        formattedModel: 'gemini-3.6-flash',
        formattedAt: Date.now() - 60000
      },
      {
        question: 'Q2',
        answer: '<h2>Pasted from ChatGPT</h2><ul><li>Key bullet point</li></ul>'
        // No formattedByAI flag -> should be formatted!
      },
      ...Array.from({ length: 7 }, (_, i) => ({
        question: `Question ${i + 3}`,
        answer: `<p>Unformatted raw draft answer ${i + 3}</p>`
      })),
      { question: 'Q10', answer: '<p>Unformatted text that hits persistent 429</p>' }
    ];

    assert.equal(rawQuestions.length, 11);

    // Filter targets exactly as Workspace handleFormatAll does
    const targets = [];
    let skippedEmptyCount = 0;
    let skippedAlreadyCount = 0;

    rawQuestions.forEach((block, idx) => {
      const ans = block.answer || '';
      const textOnly = ans.replace(/<[^>]*>/g, '').trim();
      if (!textOnly) {
        skippedEmptyCount++;
        return;
      }
      if (isAlreadyFormatted(block)) {
        skippedAlreadyCount++;
        return;
      }
      targets.push({ index: idx, text: ans });
    });

    // Should skip Q0 (empty = 1) and Q1 (already formatted = 1)
    // Q2 MUST be included because it has no formattedByAI flag!
    assert.equal(skippedEmptyCount, 1, 'Q0 should be counted as skipped empty');
    assert.equal(skippedAlreadyCount, 1, 'Q1 should be counted as skipped already formatted');
    assert.equal(targets.length, 9);
    assert.equal(targets.some(t => t.index === 2), true, 'Q2 (pasted with headings/bullets) MUST be queued for Gemini');

    // Mock fetch for targets
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      const text = body.contents[0].parts[0].text;

      if (text.includes('persistent 429')) {
        return {
          ok: false,
          status: 429,
          json: async () => ({
            error: {
              code: 429,
              message: 'Rate limit exceeded',
              status: 'RESOURCE_EXHAUSTED'
            }
          })
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: `<h2>Formatted Answer</h2><ul><li>Structured point</li></ul>` }]
              }
            }
          ]
        })
      };
    };

    // Execute runWithConcurrency
    const workingQuestions = [...rawQuestions];
    const failedTargets = [];
    let completedCount = 0;

    const tasks = targets.map((target) => async () => {
      try {
        const clean = await formatBlockWithRetry({
          text: target.text,
          model: 'gemini-3.6-flash'
        });
        return { success: true, target, clean };
      } catch (err) {
        return { success: false, target, error: err };
      }
    });

    await runWithConcurrency(tasks, 3, (taskResult) => {
      completedCount++;
      if (taskResult.status === 'fulfilled' && taskResult.value.success) {
        const { target, clean } = taskResult.value;
        workingQuestions[target.index] = {
          ...workingQuestions[target.index],
          answer: clean,
          formattedByAI: true,
          formattedModel: 'gemini-3.6-flash',
          formattedAt: Date.now()
        };
      } else {
        const item = taskResult.status === 'fulfilled' ? taskResult.value.target : null;
        if (item) failedTargets.push(item);
      }
    });

    assert.equal(completedCount, 9);
    assert.equal(failedTargets.length, 1);
    assert.equal(failedTargets[0].index, 10);

    // Q0 untouched
    assert.equal(workingQuestions[0].answer, '<p><br></p>');
    // Q1 untouched
    assert.equal(workingQuestions[1].answer, '<h2>Existing</h2><ul><li>Already formatted</li></ul>');
    // Q2 formatted and flag added
    assert.match(workingQuestions[2].answer, /<h2>Formatted Answer<\/h2>/);
    assert.equal(workingQuestions[2].formattedByAI, true);
    // Q10 original text untouched on failure
    assert.equal(workingQuestions[10].answer, '<p>Unformatted text that hits persistent 429</p>');

    // Real count summary message test:
    const successCount = targets.length - failedTargets.length;
    const failedCount = failedTargets.length;
    const parts = [];
    parts.push(`${successCount} formatted`);
    if (skippedAlreadyCount > 0) parts.push(`${skippedAlreadyCount} skipped (already formatted)`);
    if (skippedEmptyCount > 0) parts.push(`${skippedEmptyCount} skipped (empty)`);
    if (failedCount > 0) parts.push(`${failedCount} failed`);

    const toastMsg = parts.join(', ');
    assert.equal(toastMsg, '8 formatted, 1 skipped (already formatted), 1 skipped (empty), 1 failed');
  });
});

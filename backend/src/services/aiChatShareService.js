const { validateUrlSafe, fetchSafePage } = require('./linkExtractorService');
const sanitizeHtml = require('sanitize-html');

/**
 * Custom error class for known, controlled client-facing messages.
 * Prevents unexpected internal error messages, URLs, or stack traces from leaking.
 */
class ControlledAiShareError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ControlledAiShareError';
    this.isControlled = true;
  }
}

// Strict exact-match allowlist of authorized AI share hostnames
const ALLOWED_AI_HOSTNAMES = new Set(['chatgpt.com', 'chat.openai.com', 'claude.ai']);

const ALLOWED_AI_PROVIDERS = [
  {
    provider: 'chatgpt',
    name: 'ChatGPT',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    pathPrefixes: ['/share/', '/backend-api/share/'],
    extractShareId: (parsedUrl) => {
      // Handles /share/<id>, /share/e/<id>, and /backend-api/share/<id>
      const cleanPath = parsedUrl.pathname.replace(/\/+$/, '');
      const segments = cleanPath.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (!last || last === 'share' || last === 'e' || segments.length <= 1) return null;
      return last;
    }
  },
  {
    provider: 'claude',
    name: 'Claude',
    hosts: ['claude.ai'],
    pathPrefixes: ['/share/'],
    extractShareId: (parsedUrl) => {
      const cleanPath = parsedUrl.pathname.replace(/\/+$/, '');
      const segments = cleanPath.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (!last || last === 'share' || segments.length <= 1) return null;
      return last;
    }
  }
];

/**
 * Validates an AI chat share link:
 * - Only HTTPS protocol
 * - Only port 443 permitted (port 8443 or any other port strictly rejected)
 * - Zero embedded credentials allowed (rejects user:pass@host)
 * - Exact hostname match against ALLOWED_AI_HOSTNAMES
 * - Valid path prefix and valid share identifier
 */
function validateAiShareUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (_) {
    throw new ControlledAiShareError('Invalid URL link format. Please provide a valid HTTPS AI share link.');
  }

  // 1. HTTPS only
  if (parsed.protocol !== 'https:') {
    throw new ControlledAiShareError('Only secure HTTPS share links are supported for AI chats.');
  }

  // 2. Reject embedded credentials (e.g. chatgpt.com@evil.com)
  if (parsed.username || parsed.password) {
    throw new ControlledAiShareError('URLs containing embedded credentials are not allowed for security reasons.');
  }

  // 3. Allow port 443 only (rejects 8443, 8080, etc.)
  if (parsed.port !== '' && parsed.port !== '443') {
    throw new ControlledAiShareError(`Only standard HTTPS port 443 is permitted. Port ${parsed.port} is blocked.`);
  }

  // 4. Exact hostname comparison against allowlist
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_AI_HOSTNAMES.has(hostname)) {
    const allowedList = Array.from(ALLOWED_AI_HOSTNAMES).join(', ');
    throw new ControlledAiShareError(`Unsupported AI chat provider. Allowed share domains are: ${allowedList}`);
  }

  const matchedProvider = ALLOWED_AI_PROVIDERS.find(p => p.hosts.includes(hostname));
  if (!matchedProvider) {
    throw new ControlledAiShareError('Unsupported AI chat provider configuration.');
  }

  const hasValidPath = matchedProvider.pathPrefixes.some(prefix => parsed.pathname.startsWith(prefix));
  if (!hasValidPath) {
    throw new ControlledAiShareError(`Invalid share link path. Expected format: https://${hostname}/share/<id>`);
  }

  const shareId = matchedProvider.extractShareId(parsed);
  if (!shareId || shareId.length < 5) {
    throw new ControlledAiShareError('Invalid or missing share ID in URL.');
  }

  return {
    provider: matchedProvider.provider,
    providerName: matchedProvider.name,
    shareId,
    parsedUrl: parsed
  };
}

/**
 * Extracts turns from a list of author/content messages.
 */
function pairMessagesIntoTurns(messages) {
  const turns = [];
  let currentQuestion = null;
  let currentAnswers = [];

  for (const msg of messages) {
    if (!msg || !msg.author || !msg.content) continue;
    const role = (msg.author.role || '').toLowerCase();
    if (role === 'system') continue;

    let rawText = '';
    if (typeof msg.content === 'string') {
      rawText = msg.content;
    } else if (Array.isArray(msg.content.parts)) {
      rawText = msg.content.parts
        .map(p => {
          if (typeof p === 'string') return p;
          if (p && typeof p === 'object' && p.text) return p.text;
          return '';
        })
        .join('\n');
    } else if (msg.content.text) {
      rawText = msg.content.text;
    }

    rawText = (rawText || '').trim();
    if (!rawText) continue;

    if (role === 'user') {
      if (currentQuestion) {
        turns.push({
          index: turns.length + 1,
          question: sanitizeHtml(currentQuestion, { allowedTags: [], allowedAttributes: {} }),
          answer: sanitizeTextAndMarkdown(currentAnswers.join('\n\n').trim() || '(No response recorded)')
        });
        currentAnswers = [];
      }
      currentQuestion = rawText;
    } else if (role === 'assistant') {
      if (currentQuestion) {
        currentAnswers.push(rawText);
      } else {
        turns.push({
          index: turns.length + 1,
          question: 'AI Assistant Overview',
          answer: sanitizeTextAndMarkdown(rawText)
        });
      }
    }
  }

  if (currentQuestion) {
    turns.push({
      index: turns.length + 1,
      question: sanitizeHtml(currentQuestion, { allowedTags: [], allowedAttributes: {} }),
      answer: sanitizeTextAndMarkdown(currentAnswers.join('\n\n').trim() || '(No response recorded)')
    });
  }

  return turns;
}

/**
 * Extracts turns from a ChatGPT conversation mapping tree.
 */
function extractTurnsFromMapping(mapping, currentNodeId) {
  if (!mapping || typeof mapping !== 'object') return [];

  const messageList = [];
  if (currentNodeId && mapping[currentNodeId]) {
    let curr = mapping[currentNodeId];
    while (curr) {
      if (curr.message) {
        messageList.unshift(curr.message);
      }
      curr = curr.parent ? mapping[curr.parent] : null;
    }
  } else {
    const nodes = Object.values(mapping)
      .filter(n => n && n.message && n.message.author)
      .sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));
    for (const node of nodes) {
      messageList.push(node.message);
    }
  }

  return pairMessagesIntoTurns(messageList);
}

/**
 * Sanitizes markdown and text answers.
 * Strictly blocks script, svg, img with onerror, and javascript: links.
 */
function sanitizeTextAndMarkdown(text) {
  if (!text) return '';
  return sanitizeHtml(text, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote',
      'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody',
      'tr', 'th', 'td', 'mark', 'hr', 'a'
    ],
    allowedAttributes: {
      'code': ['class'],
      'th': ['style', 'align'],
      'td': ['style', 'align'],
      'a': ['href', 'target', 'rel']
    },
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: {
      'a': ['http', 'https']
    },
    transformTags: {
      'a': sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
    }
  });
}

/**
 * Parses raw pasted chat text into question-answer turns.
 */
function parsePastedChatText(rawText) {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return [];
  }

  const MAX_PASTED_BYTES = 5 * 1024 * 1024; // 5 MB limit
  if (rawText.length > MAX_PASTED_BYTES) {
    throw new ControlledAiShareError('Pasted chat text exceeds the 5 MB limit. Please paste a shorter excerpt.');
  }

  const lines = rawText.split(/\r?\n/);
  const turns = [];

  // Common role delimiter regex patterns
  const userMarkerRegex = /^(?:you said|user|human|prompt|question|q):\s*/i;
  const assistantMarkerRegex = /^(?:chatgpt said|chatgpt|assistant|claude|ai|answer|response|a):\s*/i;

  let currentRole = null;
  let currentQBuffer = [];
  let currentABuffer = [];

  const flushTurn = () => {
    const q = currentQBuffer.join('\n').trim();
    const a = currentABuffer.join('\n').trim();
    if (q) {
      turns.push({
        index: turns.length + 1,
        question: sanitizeHtml(q, { allowedTags: [], allowedAttributes: {} }),
        answer: sanitizeTextAndMarkdown(a || '(No response recorded)')
      });
    }
    currentQBuffer = [];
    currentABuffer = [];
  };

  for (const line of lines) {
    if (userMarkerRegex.test(line)) {
      if (currentRole === 'assistant' || (currentRole === 'user' && currentABuffer.length > 0)) {
        flushTurn();
      }
      currentRole = 'user';
      currentQBuffer.push(line.replace(userMarkerRegex, '').trim());
    } else if (assistantMarkerRegex.test(line)) {
      currentRole = 'assistant';
      currentABuffer.push(line.replace(assistantMarkerRegex, '').trim());
    } else {
      if (currentRole === 'assistant') {
        currentABuffer.push(line);
      } else {
        currentQBuffer.push(line);
      }
    }
  }

  flushTurn();

  // Fallback: If no markers matched at all, treat paragraphs as a single turn
  if (turns.length === 0 && rawText.trim().length > 0) {
    const doubleNewlineIdx = rawText.indexOf('\n\n');
    if (doubleNewlineIdx > 0) {
      turns.push({
        index: 1,
        question: sanitizeHtml(rawText.substring(0, doubleNewlineIdx).trim(), { allowedTags: [], allowedAttributes: {} }),
        answer: sanitizeTextAndMarkdown(rawText.substring(doubleNewlineIdx).trim())
      });
    } else {
      turns.push({
        index: 1,
        question: 'Imported Chat Note',
        answer: sanitizeTextAndMarkdown(rawText.trim())
      });
    }
  }

  return turns;
}

/**
 * Safely fetches an AI share page, enforcing:
 * - validateAiShareUrl (HTTPS, Port 443 only, No credentials, Exact allowed host)
 * - validateUrlSafe (SSRF, Loopback, Private, and Cloud Metadata subnets)
 * - Redirect destination validation (every hop must stay within allowed AI hosts)
 * - 10-second timeout
 * - 2 MB size cap
 */
async function fetchSafeAiPage(initialUrl) {
  let currentUrl = initialUrl;
  let redirectCount = 0;
  const MAX_REDIRECTS = 4;

  while (redirectCount <= MAX_REDIRECTS) {
    // 1. Strict AI provider allowlist check
    validateAiShareUrl(currentUrl);

    // 2. Strict SSRF / IP subnet check
    await validateUrlSafe(currentUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json,text/html;q=0.9,*/*;q=0.8'
        },
        redirect: 'manual',
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        throw new ControlledAiShareError('The AI chat server took too long to respond (10 second timeout exceeded). Please use "Paste chat text" instead.');
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
    }

    // Handle redirects manually to enforce validation on destination
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new ControlledAiShareError('Redirect without location header.');
      const nextUrl = new URL(location, currentUrl).toString();

      // Destination MUST pass the exact AI host allowlist & port 443!
      validateAiShareUrl(nextUrl);

      currentUrl = nextUrl;
      redirectCount++;
      continue;
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new ControlledAiShareError('This shared AI conversation could not be found or has expired.');
      }
      throw new ControlledAiShareError(`The AI chat server responded with status HTTP ${response.status}.`);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;
    const MAX_PAGE_BYTES = 2 * 1024 * 1024;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.length;
      if (receivedBytes > MAX_PAGE_BYTES) {
        try { await reader.cancel(); } catch (_) {}
        throw new ControlledAiShareError('The requested AI conversation exceeds the 2 MB limit.');
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  }
  throw new ControlledAiShareError('Exceeded maximum allowed redirects.');
}

/**
 * Attempts to safely fetch and parse a public AI chat share link.
 */
async function fetchAndParseAiShareLink(urlString) {
  const { provider, shareId } = validateAiShareUrl(urlString);

  if (provider === 'chatgpt') {
    // 1. Try ChatGPT's public backend share endpoint
    const backendShareUrl = `https://chatgpt.com/backend-api/share/${shareId}`;
    try {
      const buffer = await fetchSafeAiPage(backendShareUrl);
      const rawText = buffer.toString('utf8');
      const json = JSON.parse(rawText);

      if (json.detail) {
        if (json.detail.code === 'shared_conversation_deleted' || json.detail.reason === 'not_found') {
          throw new Error('This shared ChatGPT conversation has expired or was deleted by its author.');
        }
        throw new Error(json.detail.message || 'Unable to retrieve this shared ChatGPT conversation.');
      }

      const title = json.title || 'ChatGPT Shared Conversation';
      let turns = [];

      if (json.linear_conversation && Array.isArray(json.linear_conversation)) {
        const messages = json.linear_conversation.map(c => c.message).filter(Boolean);
        turns = pairMessagesIntoTurns(messages);
      } else if (json.mapping) {
        turns = extractTurnsFromMapping(json.mapping, json.current_node);
      }

      if (turns.length > 0) {
        return {
          title,
          provider: 'chatgpt',
          turns
        };
      }
    } catch (apiErr) {
      if (apiErr.message.includes('expired') || apiErr.message.includes('deleted')) {
        throw apiErr;
      }
    }

    // 2. Try HTML scraping with script parsing
    try {
      const buffer = await fetchSafeAiPage(urlString);
      const htmlText = buffer.toString('utf8');

      // Check for legacy __NEXT_DATA__
      const nextMatch = htmlText.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextMatch) {
        const nextJson = JSON.parse(nextMatch[1]);
        const serverData = nextJson.props?.pageProps?.serverResponse?.data;
        if (serverData) {
          const title = serverData.title || 'ChatGPT Shared Conversation';
          let turns = [];
          if (serverData.linear_conversation) {
            const messages = serverData.linear_conversation.map(c => c.message).filter(Boolean);
            turns = pairMessagesIntoTurns(messages);
          } else if (serverData.mapping) {
            turns = extractTurnsFromMapping(serverData.mapping, serverData.current_node);
          }
          if (turns.length > 0) {
            return { title, provider: 'chatgpt', turns };
          }
        }
      }
    } catch (_) {}

    // When direct fetch yields no parsable JSON (due to Cloudflare or client-side rendering)
    throw new ControlledAiShareError(
      'ChatGPT requires client-side JavaScript to render this share link, or the share has expired. Please use "Paste chat text" or "Upload export file" below to import your conversation directly.'
    );
  }

  if (provider === 'claude') {
    // Claude share link probe:
    // Claude.ai shares require client-side session authentication / JS rendering
    try {
      const buffer = await fetchSafeAiPage(urlString);
      const htmlText = buffer.toString('utf8');
      const match = htmlText.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (match) {
        const data = JSON.parse(match[1]);
      }
    } catch (_) {}
    throw new ControlledAiShareError(
      'Claude share links require client-side JavaScript and session authentication. Please use "Paste chat text" below to import your Claude dialogue turns.'
    );
  }

  throw new ControlledAiShareError(`Direct fetching for provider "${provider}" is not supported. Please use "Paste chat text" to import.`);
}

module.exports = {
  ControlledAiShareError,
  ALLOWED_AI_PROVIDERS,
  ALLOWED_AI_HOSTNAMES,
  validateAiShareUrl,
  pairMessagesIntoTurns,
  extractTurnsFromMapping,
  parsePastedChatText,
  fetchAndParseAiShareLink
};

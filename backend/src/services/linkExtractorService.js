const dns = require('dns').promises;
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const pdf = require('pdf-parse');
const sanitizeHtml = require('sanitize-html');

const MAX_PAGE_BYTES = 2 * 1024 * 1024; // 2 MB
const REQUEST_TIMEOUT_MS = 10000; // 10 seconds
const MAX_REDIRECTS = 4;
const ALLOWED_PORTS = new Set(['80', '443', '8080', '8443', '']);

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Checks whether an IP address belongs to private, loopback, link-local, or cloud metadata ranges.
 */
function isRestrictedIp(ip) {
  if (!ip) return true;
  const normalized = ip.trim().toLowerCase();

  // IPv6 loopback and unspecified
  if (normalized === '::1' || normalized === '::') return true;

  // IPv6-mapped IPv4 (::ffff:192.168.1.1)
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.substring(7);
    return isRestrictedIp(v4Part);
  }

  // IPv6 Unique Local (fc00::/7) and Link-Local (fe80::/10)
  if (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }

  // IPv4 checks
  const parts = normalized.split('.').map(Number);
  if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (parts[0] === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata e.g. 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private network)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentation / TEST-NET)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // 240.0.0.0/4 (Reserved)
    if (parts[0] >= 240) return true;
  }

  return false;
}

/**
 * Validates a target URL against SSRF, credential embedding, protocol, and port restrictions.
 */
async function validateUrlSafe(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (_) {
    throw new Error('Invalid link format. Please provide a valid HTTP or HTTPS URL.');
  }

  // Only allow HTTP and HTTPS
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS links are allowed. File and local schemes are blocked.');
  }

  // Block credentials in URLs (e.g. http://user:pass@host)
  if (parsed.username || parsed.password) {
    throw new Error('URLs containing embedded credentials are not allowed for security reasons.');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Known local hostnames & IP checks
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '169.254.169.254' ||
    isRestrictedIp(hostname)
  ) {
    throw new Error('Access to internal, loopback, or private network addresses is prohibited.');
  }

  // Block unusual ports
  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new Error(`Connection to non-standard port (${parsed.port}) is blocked for security reasons.`);
  }

  // Resolve DNS to verify all IP addresses
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new Error('The domain could not be found. Please check that the URL is spelled correctly.');
    }
    for (const record of addresses) {
      if (isRestrictedIp(record.address)) {
        throw new Error('Access to private or local network addresses is prohibited.');
      }
    }
  } catch (dnsErr) {
    if (dnsErr.message.includes('prohibited')) throw dnsErr;
    throw new Error('The domain could not be found. Please check that the URL is spelled correctly and the website is accessible.');
  }

  return parsed;
}

/**
 * Checks whether a URL points to YouTube
 */
function isYouTubeUrl(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase();
  return (
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtu.be'
  );
}

/**
 * Fetches the URL safely following redirects, validating each hop against SSRF,
 * and enforcing timeout (10s) and payload size limit (2 MB).
 */
async function fetchSafePage(initialUrl) {
  let currentUrl = initialUrl;
  let redirectCount = 0;

  while (redirectCount <= MAX_REDIRECTS) {
    const parsed = await validateUrlSafe(currentUrl);

    // Special case: YouTube links
    if (isYouTubeUrl(parsed)) {
      throw new Error(
        'YouTube video links require transcript processing, which is not yet enabled. Would you like transcript support added? In the meantime, you can copy the transcript from YouTube and paste the text instead.'
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        },
        redirect: 'manual', // Manual redirect control to validate each hop
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        throw new Error('The website took too long to respond (10 second timeout exceeded). Please check the link or paste the text instead.');
      }
      throw new Error(`Failed to connect to ${parsed.hostname}: ${fetchErr.message}. Please check your link or paste the text instead.`);
    } finally {
      clearTimeout(timeoutId);
    }

    // Handle redirects manually
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Server returned a redirect response without a target location.');
      }
      redirectCount++;
      if (redirectCount > MAX_REDIRECTS) {
        throw new Error('The website redirected too many times. Please paste the text instead.');
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    // Handle HTTP status errors
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `This page requires a login or restricted access (HTTP ${response.status}). Please copy the text from the page and paste it into the editor instead.`
      );
    }

    if (response.status === 429) {
      throw new Error(
        'This website is currently rate limiting or blocking automated requests (HTTP 429). Please copy the text and paste it into the editor instead.'
      );
    }

    if (!response.ok) {
      throw new Error(
        `The website responded with an error (HTTP ${response.status}: ${response.statusText}). Please check the link or paste the text instead.`
      );
    }

    // Check Content-Length header if present
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PAGE_BYTES) {
      throw new Error('The requested webpage is too large (exceeds the 2 MB limit). Please copy and paste the relevant section into the editor instead.');
    }

    // Stream response body and enforce 2 MB hard cap
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isPdf = contentType.includes('application/pdf') || parsed.pathname.toLowerCase().endsWith('.pdf');

    const reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.length;
      if (receivedBytes > MAX_PAGE_BYTES) {
        try { await reader.cancel(); } catch (_) {}
        throw new Error('The requested webpage is too large (exceeds the 2 MB limit). Please copy and paste the relevant section into the editor instead.');
      }
      chunks.push(value);
    }

    const fullBuffer = Buffer.concat(chunks);
    return {
      finalUrl: currentUrl,
      isPdf,
      contentType,
      buffer: fullBuffer
    };
  }

  throw new Error('Exceeded maximum allowed redirects.');
}

/**
 * Extracts readable article content from raw HTML using Readability with DOM fallback
 */
function extractFromHtml(rawHtml, pageUrl) {
  // Check for anti-bot / Cloudflare challenge signatures
  const lowerHtml = rawHtml.toLowerCase();
  if (
    lowerHtml.includes('attention required! | cloudflare') ||
    lowerHtml.includes('just a moment...') ||
    lowerHtml.includes('challenge-platform') ||
    lowerHtml.includes('cf-browser-verification') ||
    lowerHtml.includes('enable javascript and cookies to continue') ||
    lowerHtml.includes('please verify you are a human')
  ) {
    throw new Error(
      'This website blocked automated access (anti-bot protection or Cloudflare challenge). Please copy the text from the page and paste it into the editor instead.'
    );
  }

  // Create DOM without executing scripts
  const dom = new JSDOM(rawHtml, {
    url: pageUrl,
    runScripts: 'outside-only'
  });

  const doc = dom.window.document;

  // Try Mozilla Readability first
  let article = null;
  try {
    const reader = new Readability(doc, {
      charThreshold: 80,
      keepClasses: false
    });
    article = reader.parse();
  } catch (readErr) {
    console.warn('[Backend] Readability parse warning:', readErr.message);
  }

  let title = '';
  let extractedText = '';

  if (article && article.textContent && article.textContent.trim().length > 100) {
    title = (article.title || '').trim();
    extractedText = article.textContent.trim();
  } else {
    // Fallback DOM extraction: remove non-content elements
    const removals = doc.querySelectorAll('script, style, noscript, iframe, nav, header, footer, svg, form');
    removals.forEach(el => el.remove());

    const mainContainer = doc.querySelector('article') || doc.querySelector('main') || doc.body;
    if (mainContainer) {
      extractedText = (mainContainer.textContent || '').replace(/\s+/g, ' ').trim();
    }
    const titleEl = doc.querySelector('title') || doc.querySelector('h1');
    if (titleEl) title = titleEl.textContent.trim();
  }

  if (!extractedText || extractedText.length < 50) {
    throw new Error(
      'Could not extract readable article text from this page (it may rely heavily on client-side JavaScript or require a login). Please copy the text and paste it into the editor instead.'
    );
  }

  // Sanitize extracted text to prevent script injection
  const cleanTitle = sanitizeHtml(title, { allowedTags: [], allowedAttributes: {} });
  const cleanText = sanitizeHtml(extractedText, { allowedTags: [], allowedAttributes: {} });

  return {
    title: cleanTitle,
    text: cleanTitle ? `${cleanTitle}\n\n${cleanText}` : cleanText
  };
}

/**
 * Main public extractor function: handles validation, redirects, PDFs, HTML and Readability
 */
async function extractLinkContent(urlString) {
  const { finalUrl, isPdf, buffer } = await fetchSafePage(urlString);

  // 1. PDF Link Handling
  if (isPdf) {
    let pdfText = '';
    try {
      const parsedPdf = await pdf(buffer);
      pdfText = (parsedPdf.text || '').trim();
    } catch (pdfErr) {
      throw new Error(`Failed to parse PDF: ${pdfErr.message}. Please paste the text instead.`);
    }

    if (!pdfText || pdfText.length < 20) {
      throw new Error(
        'This PDF appears to be password-protected or contains scanned images without extractable text. Please paste the text directly into the editor instead.'
      );
    }

    const cleanPdfText = sanitizeHtml(pdfText, { allowedTags: [], allowedAttributes: {} });
    return {
      title: 'Imported PDF Document',
      text: cleanPdfText,
      url: finalUrl
    };
  }

  // 2. HTML Webpage Handling
  const rawHtml = buffer.toString('utf8');
  const { title, text } = extractFromHtml(rawHtml, finalUrl);

  return {
    title,
    text,
    url: finalUrl
  };
}

module.exports = {
  validateUrlSafe,
  isRestrictedIp,
  fetchSafePage,
  extractLinkContent
};

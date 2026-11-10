import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Helper to get DOMPurify instance across browser and test/SSR environments
const getPurify = () => {
  if (DOMPurify && typeof DOMPurify.sanitize === 'function') return DOMPurify;
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined' && typeof DOMPurify === 'function') {
    try {
      const p = DOMPurify(window);
      if (p && typeof p.sanitize === 'function') return p;
    } catch (_) {}
  }
  return {
    sanitize: (val) => val
  };
};

let mermaidInstance = null;
let mermaidLoadingPromise = null;
let diagramCounter = 0;

/**
 * Checks if a string is a raw Mermaid diagram code definition
 */
export function isMermaidCode(code) {
  if (!code || typeof code !== 'string') return false;
  // Strip leading comments (%%) and whitespace
  const stripped = code.replace(/^\s*%%[^\n]*\n?/gm, '').trim();
  if (!stripped) return false;

  const diagramKeywords = [
    'graph ', 'graph\n', 'graph\r\n',
    'flowchart ', 'flowchart\n', 'flowchart\r\n',
    'sequencediagram', 'classdiagram', 'statediagram',
    'erdiagram', 'gantt', 'pie', 'mindmap', 'timeline',
    'gitgraph', 'quadrantchart', 'sankey', 'xychart',
    'block-beta', 'c4context', 'c4container', 'c4component', 'c4dynamic', 'c4deployment',
    'zenuml', 'packet-beta', 'kanban', 'architecture'
  ];
  const lower = stripped.toLowerCase();
  return diagramKeywords.some(kw => lower.startsWith(kw) || lower.includes('\n' + kw) || lower.includes('\r\n' + kw));
}

/**
 * Checks if a string contains any Mermaid diagram blocks or classes
 */
export function hasMermaidDiagram(text) {
  if (!text || typeof text !== 'string') return false;
  return (
    text.includes('```mermaid') ||
    text.includes('class="mermaid"') ||
    text.includes("class='mermaid'") ||
    text.includes('mermaid-diagram-container') ||
    text.includes('language-mermaid') ||
    isMermaidCode(text)
  );
}

/**
 * Checks if a string contains ASCII-style diagram art or code blocks
 */
export function hasAsciiArt(text) {
  if (!text || typeof text !== 'string') return false;
  return (
    text.includes('+---') ||
    text.includes('|   ') ||
    text.includes('+===') ||
    text.includes('-->') ||
    text.includes('┌─') ||
    text.includes('└─') ||
    text.includes('├──')
  );
}

/**
 * Lazy loads Mermaid library via dynamic import() as an npm dependency chunk.
 * Zero third-party CDN scripts used.
 */
export async function loadMermaidLibrary() {
  if (mermaidInstance) return mermaidInstance;
  if (mermaidLoadingPromise) return mermaidLoadingPromise;

  mermaidLoadingPromise = (async () => {
    try {
      const mermaidModule = await import('mermaid');
      mermaidInstance = mermaidModule.default || mermaidModule;
      return mermaidInstance;
    } catch (err) {
      mermaidLoadingPromise = null;
      throw new Error(`Failed to dynamically load Mermaid module: ${err.message}`);
    }
  })();

  return mermaidLoadingPromise;
}

/**
 * Configures Mermaid with strict securityLevel and htmlLabels: false
 * so labels render as standard SVG <text> elements that survive sanitization and PDF rasterization.
 */
export function configureMermaid(mermaid, isDark = false) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict', // Strict CSP prevents arbitrary script execution
    theme: isDark ? 'dark' : 'default',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    suppressErrors: true,
    htmlLabels: false, // Emits pure SVG <text> elements; survives DOMPurify & renders on canvas/PDF
    flowchart: { htmlLabels: false, curve: 'basis' },
    state: { htmlLabels: false },
    class: { htmlLabels: false },
    sequence: { showSequenceNumbers: false, actorMargin: 50 },
    er: { useMaxWidth: true }
  });
}

/**
 * Renders a Mermaid diagram string to a sanitized SVG
 */
export async function renderMermaidSvg(rawCode, isDark = false) {
  try {
    const mermaid = await loadMermaidLibrary();
    if (!mermaid) {
      throw new Error('Mermaid library could not be loaded');
    }
    configureMermaid(mermaid, isDark);

    diagramCounter += 1;
    const renderId = `mermaid-svg-${Date.now()}-${diagramCounter}`;

    const cleanedCode = (rawCode || '').trim();
    if (!cleanedCode) {
      throw new Error('Diagram definition is empty');
    }

    const { svg } = await mermaid.render(renderId, cleanedCode);

    // Sanitize the SVG strictly with DOMPurify allowing only SVG elements
    const sanitizedSvg = getPurify().sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['foreignObject'],
      ADD_ATTR: ['dominant-baseline', 'text-anchor'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'javascript:']
    });

    // Remove any suspicious links or inline click handlers
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = sanitizedSvg;
    const links = tempDiv.querySelectorAll('a');
    links.forEach(a => {
      const href = a.getAttribute('href') || a.getAttribute('xlink:href') || '';
      if (href.toLowerCase().startsWith('javascript:') || href.toLowerCase().startsWith('data:')) {
        a.removeAttribute('href');
        a.removeAttribute('xlink:href');
      }
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      a.removeAttribute('onclick');
      a.style.pointerEvents = 'none'; // Block click handlers in diagram
    });

    return { svg: tempDiv.innerHTML, error: null };
  } catch (err) {
    return {
      svg: null,
      error: err.message || 'Syntax error in Mermaid diagram'
    };
  }
}

/**
 * Hydrates all Mermaid diagram elements within a DOM element.
 * Upgrades unrendered .mermaid divs, code.language-mermaid, and detected diagram code blocks.
 */
export async function hydrateMermaidContainers(containerEl, isDark = false) {
  if (!containerEl) return;

  // 1. Upgrade raw unhydrated <div class="mermaid"> elements
  const rawMermaids = containerEl.querySelectorAll('.mermaid:not(.mermaid-diagram-container):not(.mermaid-svg-wrapper)');
  rawMermaids.forEach(el => {
    const rawText = el.textContent || '';
    if (rawText.trim()) {
      el.classList.add('mermaid-diagram-container');
      el.setAttribute('data-mermaid-code', encodeURIComponent(rawText.trim()));
      el.innerHTML = '<div class="mermaid-loading-placeholder" style="padding: 1rem; text-align: center; color: #64748b; font-size: 0.85rem; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px;">⏳ Loading diagram...</div>';
    }
  });

  // 2. Upgrade <pre><code class="language-mermaid"> or <pre class="language-mermaid"> elements
  const codeMermaids = containerEl.querySelectorAll('code.language-mermaid, pre.language-mermaid, pre.mermaid');
  codeMermaids.forEach(el => {
    const rawText = el.textContent || '';
    if (rawText.trim()) {
      const parentPre = el.closest('pre') || el;
      if (parentPre && parentPre.parentNode) {
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid-diagram-container';
        wrapper.setAttribute('data-mermaid-code', encodeURIComponent(rawText.trim()));
        wrapper.innerHTML = '<div class="mermaid-loading-placeholder" style="padding: 1rem; text-align: center; color: #64748b; font-size: 0.85rem; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px;">⏳ Loading diagram...</div>';
        parentPre.parentNode.replaceChild(wrapper, parentPre);
      }
    }
  });

  // 3. Upgrade any <pre><code> whose text content matches Mermaid syntax
  const genericCodeBlocks = containerEl.querySelectorAll('pre > code:not(.language-mermaid)');
  genericCodeBlocks.forEach(el => {
    const rawText = el.textContent || '';
    if (isMermaidCode(rawText)) {
      const parentPre = el.closest('pre');
      if (parentPre && parentPre.parentNode) {
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid-diagram-container';
        wrapper.setAttribute('data-mermaid-code', encodeURIComponent(rawText.trim()));
        wrapper.innerHTML = '<div class="mermaid-loading-placeholder" style="padding: 1rem; text-align: center; color: #64748b; font-size: 0.85rem; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px;">⏳ Loading diagram...</div>';
        parentPre.parentNode.replaceChild(wrapper, parentPre);
      }
    }
  });

  // 4. Hydrate all .mermaid-diagram-container elements
  const containers = containerEl.querySelectorAll('.mermaid-diagram-container');
  if (containers.length === 0) return;

  const currentTheme = isDark ? 'dark' : 'light';

  for (const container of containers) {
    const alreadyRendered = container.getAttribute('data-rendered') === 'true';
    const renderedTheme = container.getAttribute('data-theme');

    if (alreadyRendered && renderedTheme === currentTheme) {
      continue;
    }

    const encodedCode = container.getAttribute('data-mermaid-code');
    let code = '';
    if (encodedCode) {
      try {
        code = decodeURIComponent(encodedCode);
      } catch (_) {
        code = encodedCode;
      }
    } else {
      code = container.textContent || '';
    }

    const result = await renderMermaidSvg(code, isDark);

    if (result.svg) {
      container.innerHTML = `<div class="mermaid-svg-wrapper">${result.svg}</div>`;
      container.setAttribute('data-rendered', 'true');
      container.setAttribute('data-theme', currentTheme);
    } else {
      // Syntax error fallback: Friendly message + original source in code block
      const escapedCode = (code || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const cleanErrMsg = getPurify().sanitize(result.error || 'Syntax error', { ALLOWED_TAGS: [] });

      container.innerHTML = `
        <div class="mermaid-error-banner" style="border: 1px solid #fca5a5; background: ${isDark ? '#450a0a' : '#fef2f2'}; border-radius: 8px; padding: 0.75rem 1rem; margin: 0.75rem 0; text-align: left;">
          <div style="color: ${isDark ? '#fca5a5' : '#b91c1c'}; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.4rem; display: flex; align-items: center; gap: 0.5rem;">
            <span>⚠️ Unable to render diagram</span>
            <span style="font-size: 0.75rem; color: ${isDark ? '#f87171' : '#dc2626'}; font-weight: normal;">(${cleanErrMsg})</span>
          </div>
          <pre class="ascii-block" style="margin: 0; padding: 0.6rem; background: ${isDark ? '#1e293b' : '#ffffff'}; border: 1px solid ${isDark ? '#334155' : '#fecaca'}; border-radius: 6px; font-size: 0.8rem; overflow-x: auto; white-space: pre !important; font-family: 'Fira Code', 'Courier New', Courier, monospace; color: ${isDark ? '#f1f5f9' : '#334155'};"><code>${escapedCode}</code></pre>
        </div>
      `;
      container.setAttribute('data-rendered', 'true');
      container.setAttribute('data-theme', currentTheme);
    }
  }
}

/**
 * Generates a neutral informational placeholder for non-imported chat images
 */
function createImagePlaceholderHtml(altText) {
  const label = altText && altText.trim() ? altText.trim() : 'Attached visual';
  const cleanLabel = getPurify().sanitize(label, { ALLOWED_TAGS: [] });
  return `<div class="chat-image-placeholder"><span class="chat-image-icon">🖼️</span><span class="chat-image-text"><strong>Image:</strong> ${cleanLabel} (not imported from AI chat)</span></div>`;
}

/**
 * Formats markdown or chat text into sanitized HTML, transforming Mermaid blocks into containers
 * and converting images into clean, neutral informational placeholders.
 */
export function formatAnswerWithDiagrams(rawText) {
  if (!rawText) return '';

  let text = String(rawText);

  // 1. Handle image placeholders: convert markdown/HTML images or text placeholders to neutral informational notes
  // (a) Markdown image syntax: ![alt text](url)
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, (match, alt) => {
    return `\n${createImagePlaceholderHtml(alt)}\n`;
  });

  // (b) Raw <img> tags
  text = text.replace(/<img\b([^>]*?)>/gi, (match, attrs) => {
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    const alt = altMatch ? altMatch[1] : '';
    return `\n${createImagePlaceholderHtml(alt)}\n`;
  });

  // (c) Plain text image pointers (e.g. from ChatGPT backend-api parts)
  text = text.replace(/\[Image:\s*([^\]]+)\]/gi, (match, label) => {
    return `\n${createImagePlaceholderHtml(label)}\n`;
  });

  // 2. Convert <pre><code class="language-mermaid">...</code></pre> into ```mermaid...```
  text = text.replace(/<pre><code(?:\s+class=["'](?:language-)?mermaid["'])?>([\s\S]*?)<\/code><\/pre>/gi, (match, code) => {
    return `\n\`\`\`mermaid\n${code.trim()}\n\`\`\`\n`;
  });

  // 3. Convert <div class="mermaid">...</div> into ```mermaid ... ```
  text = text.replace(/<div\s+class=["']mermaid["'][^>]*>([\s\S]*?)<\/div>/gi, (match, code) => {
    return `\n\`\`\`mermaid\n${code.trim()}\n\`\`\`\n`;
  });

  // 4. Extract ```mermaid, ```flowchart, ```sequenceDiagram, ```graph blocks and replace with safe container
  text = text.replace(/`{3,}(?:mermaid|flowchart|sequenceDiagram|graph)?\s*\r?\n([\s\S]*?)`{3,}/gi, (match, code) => {
    const cleaned = code.replace(/^`*(?:mermaid)?\s*\r?\n?/i, '').replace(/`*$/g, '').trim();
    if (isMermaidCode(cleaned) || match.toLowerCase().includes('mermaid')) {
      const encoded = encodeURIComponent(cleaned);
      return `\n<div class="mermaid-diagram-container" data-mermaid-code="${encoded}"><div class="mermaid-loading-placeholder" style="padding: 1rem; text-align: center; color: #64748b; font-size: 0.85rem; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px;">⏳ Loading diagram...</div></div>\n`;
    }
    return match;
  });

  // 5. If raw text without triple backticks is a whole diagram:
  if (!text.includes('```') && isMermaidCode(text.trim())) {
    const encoded = encodeURIComponent(text.trim());
    return `<div class="mermaid-diagram-container" data-mermaid-code="${encoded}"><div class="mermaid-loading-placeholder" style="padding: 1rem; text-align: center; color: #64748b; font-size: 0.85rem; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px;">⏳ Loading diagram...</div></div>`;
  }

  // 6. Parse Markdown
  let html = marked.parse(text, { breaks: true, gfm: true });

  // 7. Sanitize HTML
  const sanitizedHtml = getPurify().sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote',
      'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody',
      'tr', 'th', 'td', 'mark', 'hr', 'div', 'span', 'del',
      'svg', 'g', 'path', 'text', 'rect', 'circle', 'line', 'polygon', 'polyline', 'marker', 'defs', 'foreignObject'
    ],
    ALLOWED_ATTR: [
      'class', 'style', 'align', 'data-mermaid-code', 'data-rendered', 'data-theme',
      'viewBox', 'width', 'height', 'd', 'fill', 'stroke', 'stroke-width', 'transform', 'id', 'x', 'y', 'r', 'cx', 'cy',
      'x1', 'y1', 'x2', 'y2', 'points', 'marker-end', 'marker-start', 'text-anchor', 'dominant-baseline'
    ]
  });

  return sanitizedHtml;
}

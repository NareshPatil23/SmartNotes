import DOMPurify from 'dompurify';

export const CARD_COLORS = {
  blue: { bg: '#DBEAFE', text: '#0F172A', muted: '#475569', border: '#BFDBFE' },
  green: { bg: '#DCF3E1', text: '#0F172A', muted: '#475569', border: '#BBF7D0' },
  orange: { bg: '#FFE8D5', text: '#0F172A', muted: '#475569', border: '#FED7AA' },
  purple: { bg: '#F3E8FF', text: '#0F172A', muted: '#475569', border: '#E9D5FF' },
  pink: { bg: '#FCE7F3', text: '#0F172A', muted: '#475569', border: '#FBCFE8' },
  gray: { bg: '#F1F5F9', text: '#0F172A', muted: '#475569', border: '#E2E8F0' }
};

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Pure HTML generator for CardFlow spec.
 * Uses plain HTML/CSS with standard system fonts, zero foreignObjects.
 * All text is strictly escaped.
 */
export function renderCardFlowHtml(spec) {
  if (!spec || !Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    return '<div class="cardflow-container empty" style="background:#1e293b;border-radius:16px;padding:24px;text-align:center;color:#94a3b8;">No flow steps defined</div>';
  }

  const direction = spec.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const nodes = spec.nodes;

  const nodesHtml = nodes.map((node, idx) => {
    const colorKey = (node.color || 'blue').toLowerCase();
    const colorConfig = CARD_COLORS[colorKey] || CARD_COLORS.blue;
    const arrow = direction === 'horizontal' ? '→' : '↓';
    const arrowHtml = idx > 0
      ? `<div class="cardflow-connector" style="color:#94a3b8;font-size:18px;font-weight:bold;text-align:center;padding:${direction === 'horizontal' ? '0 6px' : '2px 0'};line-height:1;">${arrow}</div>`
      : '';

    const safeTitle = escapeHtml(node.title || 'Step');
    const safeSubtitle = node.subtitle ? `<div class="cardflow-card-subtitle" style="font-size:14px;color:${colorConfig.muted};margin-top:6px;line-height:1.4;">${escapeHtml(node.subtitle)}</div>` : '';

    let branchesHtml = '';
    if (Array.isArray(node.branches) && node.branches.length > 0) {
      const bItemsHtml = node.branches.map(bNode => {
        const bColor = CARD_COLORS[(bNode.color || 'gray').toLowerCase()] || CARD_COLORS.gray;
        const bSub = bNode.subtitle ? `<div style="font-size:13px;color:${bColor.muted};margin-top:4px;">${escapeHtml(bNode.subtitle)}</div>` : '';
        return `
          <div class="cardflow-card cardflow-branch-card" style="background:${bColor.bg};border-radius:10px;padding:12px 16px;flex:1 1 140px;max-width:240px;box-sizing:border-box;text-align:center;border:1px solid rgba(0,0,0,0.05);">
            <div style="font-size:15px;font-weight:600;color:${bColor.text};line-height:1.3;">${escapeHtml(bNode.title)}</div>
            ${bSub}
          </div>
        `;
      }).join('');

      branchesHtml = `
        <div class="cardflow-branches-container" style="width:100%;display:flex;flex-direction:column;align-items:center;margin-top:12px;">
          <div style="color:#94a3b8;font-size:16px;font-weight:bold;margin-bottom:8px;">↓</div>
          <div class="cardflow-branches-grid" style="display:flex;flex-direction:row;flex-wrap:wrap;justify-content:center;gap:12px;width:100%;">
            ${bItemsHtml}
          </div>
        </div>
      `;
    }

    const cardWidthStyle = direction === 'horizontal' ? 'width:180px;' : 'width:100%;max-width:520px;';

    return `
      ${arrowHtml}
      <div class="cardflow-node-wrapper" style="width:${direction === 'horizontal' ? 'auto' : '100%'};display:flex;flex-direction:column;align-items:center;">
        <div class="cardflow-card" style="background:${colorConfig.bg};border-radius:12px;padding:16px 20px;${cardWidthStyle}box-sizing:border-box;text-align:center;border:1px solid rgba(0,0,0,0.05);">
          <div class="cardflow-card-title" style="font-size:18px;font-weight:600;color:${colorConfig.text};line-height:1.3;margin:0;">${safeTitle}</div>
          ${safeSubtitle}
        </div>
        ${branchesHtml}
      </div>
    `;
  }).join('');

  const layoutStyle = direction === 'horizontal'
    ? 'display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:center;gap:16px;width:100%;'
    : 'display:flex;flex-direction:column;align-items:center;gap:16px;width:100%;';

  return `
    <div class="cardflow-container cardflow-dir-${direction}" style="background:#1e293b;border-radius:16px;padding:24px 20px;max-width:560px;width:100%;margin:1rem auto;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
      <div class="cardflow-flow-layout" style="${layoutStyle}">
        ${nodesHtml}
      </div>
    </div>
  `;
}

/**
 * Pure SVG generator for CardFlow spec (NO foreignObject, zero external fonts).
 * Can be rasterized directly onto a canvas at 2x scale for PDF export.
 */
export function renderCardFlowSvg(spec) {
  if (!spec || !Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    return `<svg width="560" height="80" viewBox="0 0 560 80" xmlns="http://www.w3.org/2000/svg">
      <rect width="560" height="80" rx="16" fill="#1e293b"/>
      <text x="280" y="46" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">No flow steps defined</text>
    </svg>`;
  }

  const direction = spec.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const nodes = spec.nodes;
  const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  if (direction === 'horizontal') {
    const cardWidth = 160;
    const arrowWidth = 32;
    const padX = 24;
    const padY = 24;
    const totalWidth = padX * 2 + (nodes.length * cardWidth) + ((nodes.length - 1) * arrowWidth);
    const cardHeight = 84;
    const totalHeight = padY * 2 + cardHeight;

    let elements = [];
    let curX = padX;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const colorConfig = CARD_COLORS[(node.color || 'blue').toLowerCase()] || CARD_COLORS.blue;

      if (i > 0) {
        elements.push(`
          <text x="${curX + arrowWidth / 2}" y="${padY + cardHeight / 2 + 5}" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#94a3b8" text-anchor="middle">→</text>
        `);
        curX += arrowWidth;
      }

      elements.push(`
        <rect x="${curX}" y="${padY}" width="${cardWidth}" height="${cardHeight}" rx="12" fill="${colorConfig.bg}" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>
        <text x="${curX + cardWidth / 2}" y="${padY + (node.subtitle ? 34 : 46)}" font-family="${FONT_FAMILY}" font-size="15" font-weight="600" fill="${colorConfig.text}" text-anchor="middle">${escapeHtml(node.title)}</text>
        ${node.subtitle ? `<text x="${curX + cardWidth / 2}" y="${padY + 56}" font-family="${FONT_FAMILY}" font-size="12" fill="${colorConfig.muted}" text-anchor="middle">${escapeHtml(node.subtitle)}</text>` : ''}
      `);
      curX += cardWidth;
    }

    return `<svg width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${totalWidth}" height="${totalHeight}" rx="16" fill="#1e293b"/>
      ${elements.join('')}
    </svg>`;
  }

  // Vertical layout (default)
  const containerWidth = 560;
  const padX = 24;
  const padY = 24;
  const cardWidth = containerWidth - (padX * 2);
  const arrowHeight = 28;

  let curY = padY;
  const elements = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const colorConfig = CARD_COLORS[(node.color || 'blue').toLowerCase()] || CARD_COLORS.blue;
    const hasBranches = Array.isArray(node.branches) && node.branches.length > 0;
    const cardHeight = node.subtitle ? 72 : 54;

    if (i > 0) {
      elements.push(`
        <text x="${containerWidth / 2}" y="${curY + arrowHeight / 2 + 5}" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#94a3b8" text-anchor="middle">↓</text>
      `);
      curY += arrowHeight;
    }

    // Main Card
    elements.push(`
      <rect x="${padX}" y="${curY}" width="${cardWidth}" height="${cardHeight}" rx="12" fill="${colorConfig.bg}" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>
      <text x="${containerWidth / 2}" y="${curY + (node.subtitle ? 32 : 33)}" font-family="${FONT_FAMILY}" font-size="18" font-weight="600" fill="${colorConfig.text}" text-anchor="middle">${escapeHtml(node.title)}</text>
      ${node.subtitle ? `<text x="${containerWidth / 2}" y="${curY + 54}" font-family="${FONT_FAMILY}" font-size="14" fill="${colorConfig.muted}" text-anchor="middle">${escapeHtml(node.subtitle)}</text>` : ''}
    `);
    curY += cardHeight;

    // Branches
    if (hasBranches) {
      const bArrowHeight = 20;
      elements.push(`
        <text x="${containerWidth / 2}" y="${curY + bArrowHeight / 2 + 5}" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="#94a3b8" text-anchor="middle">↓</text>
      `);
      curY += bArrowHeight;

      const numBranches = node.branches.length;
      const bGap = 12;
      const bWidth = (cardWidth - (numBranches - 1) * bGap) / numBranches;
      const bHeight = 58;

      for (let bIdx = 0; bIdx < numBranches; bIdx++) {
        const bNode = node.branches[bIdx];
        const bColor = CARD_COLORS[(bNode.color || 'gray').toLowerCase()] || CARD_COLORS.gray;
        const bX = padX + (bIdx * (bWidth + bGap));

        elements.push(`
          <rect x="${bX}" y="${curY}" width="${bWidth}" height="${bHeight}" rx="10" fill="${bColor.bg}" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>
          <text x="${bX + bWidth / 2}" y="${curY + (bNode.subtitle ? 26 : 33)}" font-family="${FONT_FAMILY}" font-size="14" font-weight="600" fill="${bColor.text}" text-anchor="middle">${escapeHtml(bNode.title)}</text>
          ${bNode.subtitle ? `<text x="${bX + bWidth / 2}" y="${curY + 44}" font-family="${FONT_FAMILY}" font-size="12" fill="${bColor.muted}" text-anchor="middle">${escapeHtml(bNode.subtitle)}</text>` : ''}
        `);
      }
      curY += bHeight;
    }
  }

  const totalHeight = curY + padY;

  return `<svg width="${containerWidth}" height="${totalHeight}" viewBox="0 0 ${containerWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${containerWidth}" height="${totalHeight}" rx="16" fill="#1e293b"/>
    ${elements.join('')}
  </svg>`;
}

const getPurify = () => {
  if (DOMPurify && typeof DOMPurify.sanitize === 'function') return DOMPurify;
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined' && typeof DOMPurify === 'function') {
    try {
      const p = DOMPurify(window);
      if (p && typeof p.sanitize === 'function') return p;
    } catch (_) {}
  }
  return { sanitize: (val) => val };
};

export const VALID_CARD_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'gray'];

export const CARDFLOW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['flow'] },
    direction: { type: 'string', enum: ['vertical', 'horizontal'] },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Stage title, max 4 words' },
          subtitle: { type: 'string', description: 'Short subtitle, max 8 words' },
          color: { type: 'string', enum: ['blue', 'green', 'orange', 'purple', 'pink', 'gray'] },
          branches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Branch title, max 4 words' },
                subtitle: { type: 'string', description: 'Branch subtitle, max 8 words' },
                color: { type: 'string', enum: ['blue', 'green', 'orange', 'purple', 'pink', 'gray'] }
              },
              required: ['title', 'color']
            }
          }
        },
        required: ['title', 'color']
      }
    }
  },
  required: ['type', 'nodes']
};

/**
 * Validates and normalizes a CardFlow JSON spec or string.
 * Returns { valid: boolean, error?: string, normalizedSpec?: object }
 */
export function validateCardFlowSpec(input) {
  if (!input) {
    return { valid: false, error: 'Empty CardFlow specification.' };
  }

  let obj = input;
  if (typeof input === 'string') {
    let cleaned = input.trim();
    // Strip markdown code fences if present
    cleaned = cleaned.replace(/^```(?:cardflow|json|flow)?\s*\r?\n?/i, '');
    cleaned = cleaned.replace(/\r?\n?```\s*$/i, '');
    try {
      obj = JSON.parse(cleaned.trim());
    } catch (parseErr) {
      return { valid: false, error: `Invalid JSON syntax: ${parseErr.message}` };
    }
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, error: 'CardFlow spec must be a JSON object.' };
  }

  if (obj.type && obj.type !== 'flow') {
    return { valid: false, error: `Invalid spec type "${obj.type}". Expected "flow".` };
  }

  if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) {
    return { valid: false, error: 'CardFlow spec must contain a non-empty "nodes" array.' };
  }

  const direction = obj.direction === 'horizontal' ? 'horizontal' : 'vertical';

  const normalizedNodes = [];
  for (let i = 0; i < obj.nodes.length; i++) {
    const node = obj.nodes[i];
    if (!node || typeof node !== 'object') {
      return { valid: false, error: `Node at index ${i} is not a valid object.` };
    }

    const title = typeof node.title === 'string' ? node.title.trim() : '';
    if (!title) {
      return { valid: false, error: `Node at index ${i} is missing a required "title".` };
    }

    let color = typeof node.color === 'string' ? node.color.toLowerCase().trim() : 'blue';
    if (!VALID_CARD_COLORS.includes(color)) {
      color = 'blue';
    }

    const normalizedNode = {
      title,
      color
    };

    if (node.subtitle && typeof node.subtitle === 'string' && node.subtitle.trim()) {
      normalizedNode.subtitle = node.subtitle.trim();
    }

    if (Array.isArray(node.branches) && node.branches.length > 0) {
      normalizedNode.branches = node.branches
        .filter(b => b && typeof b === 'object' && typeof b.title === 'string' && b.title.trim())
        .map(b => ({
          title: b.title.trim(),
          subtitle: typeof b.subtitle === 'string' ? b.subtitle.trim() : undefined,
          color: VALID_CARD_COLORS.includes((b.color || '').toLowerCase().trim()) ? b.color.toLowerCase().trim() : 'gray'
        }));
    }

    normalizedNodes.push(normalizedNode);
  }

  return {
    valid: true,
    error: null,
    normalizedSpec: {
      type: 'flow',
      direction,
      nodes: normalizedNodes
    }
  };
}

/**
 * Hydrates all .cardflow-diagram-container elements within containerEl.
 * Renders the plain HTML/CSS card flow view and attaches hover toolbar and resize handle.
 */
export function hydrateCardFlowContainers(containerEl, isDark = false) {
  if (!containerEl || typeof document === 'undefined') return;

  // 1. Upgrade unhydrated .cardflow elements
  const rawElements = containerEl.querySelectorAll('.cardflow:not(.cardflow-diagram-container):not(.cardflow-rendered-img)');
  rawElements.forEach(el => {
    const specAttr = el.getAttribute('data-cardflow-spec');
    if (specAttr) {
      el.classList.add('cardflow-diagram-container');
    } else {
      const text = el.textContent || '';
      const validated = validateCardFlowSpec(text);
      if (validated.valid) {
        el.classList.add('cardflow-diagram-container');
        el.setAttribute('data-cardflow-spec', encodeURIComponent(JSON.stringify(validated.normalizedSpec)));
      }
    }
  });

  const containers = containerEl.querySelectorAll('.cardflow-diagram-container');
  if (containers.length === 0) return;

  for (const container of containers) {
    const rawSpecEncoded = container.getAttribute('data-cardflow-spec');
    let spec = null;
    if (rawSpecEncoded) {
      try {
        const decoded = decodeURIComponent(rawSpecEncoded);
        const parsed = JSON.parse(decoded);
        const val = validateCardFlowSpec(parsed);
        if (val.valid) spec = val.normalizedSpec;
      } catch (_) {
        spec = null;
      }
    }

    if (!container.getAttribute('data-diagram-id')) {
      container.setAttribute('data-diagram-id', 'cf-' + Math.random().toString(36).substring(2, 9));
    }

    const widthPercent = container.getAttribute('data-width-percent') || '100';
    container.style.width = `${widthPercent}%`;
    container.style.maxWidth = `${widthPercent}%`;

    if (spec) {
      container.innerHTML = `<div class="cardflow-rendered-wrapper" style="width:100%;display:flex;justify-content:center;">${renderCardFlowHtml(spec)}</div>`;
      container.setAttribute('data-rendered', 'true');
    } else {
      container.innerHTML = `
        <div class="cardflow-error-banner" style="border: 1px solid #fca5a5; background: #fef2f2; border-radius: 8px; padding: 0.75rem 1rem; margin: 0.75rem 0; text-align: left; color: #b91c1c;">
          <strong>⚠️ Unable to render Card Flow:</strong> Invalid diagram specification.
        </div>
      `;
      container.setAttribute('data-rendered', 'true');
    }

    attachCardFlowControls(container);
  }
}

/**
 * Attaches hover toolbar and resize handle to a CardFlow diagram container.
 */
export function attachCardFlowControls(container) {
  if (!container || typeof document === 'undefined') return;
  // Remove existing controls
  container.querySelectorAll('[data-diagram-controls="true"]').forEach(el => el.remove());

  const widthPercent = parseInt(container.getAttribute('data-width-percent'), 10) || 100;
  const hasUndo = Boolean(container.getAttribute('data-previous-spec') || container.getAttribute('data-previous-width'));

  // 1. Hover Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'mermaid-hover-toolbar cardflow-hover-toolbar';
  toolbar.setAttribute('contenteditable', 'false');
  toolbar.setAttribute('data-diagram-controls', 'true');

  toolbar.innerHTML = `
    <div class="mermaid-tb-group" title="Resize diagram">
      <button type="button" class="mermaid-tb-btn mermaid-size-btn ${widthPercent === 40 ? 'active' : ''}" data-size="40" title="Small (40%)">S</button>
      <button type="button" class="mermaid-tb-btn mermaid-size-btn ${widthPercent === 70 ? 'active' : ''}" data-size="70" title="Medium (70%)">M</button>
      <button type="button" class="mermaid-tb-btn mermaid-size-btn ${widthPercent === 100 ? 'active' : ''}" data-size="100" title="Full (100%)">L</button>
    </div>
    <div class="mermaid-tb-divider"></div>
    <button type="button" class="mermaid-tb-btn" data-action="edit" title="Edit flow cards">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
      <span>Edit</span>
    </button>
    <button type="button" class="mermaid-tb-btn" data-action="edit-ai" title="Edit with AI">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
      <span>AI</span>
    </button>
    <button type="button" class="mermaid-tb-btn" data-action="copy" title="Copy JSON spec">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    </button>
    <button type="button" class="mermaid-tb-btn mermaid-undo-btn" data-action="undo" title="Undo change" style="display: ${hasUndo ? 'inline-flex' : 'none'};">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>
    </button>
    <button type="button" class="mermaid-tb-btn mermaid-delete-btn" data-action="delete" title="Delete diagram">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
    </button>
  `;

  toolbar.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const sizeBtn = e.target.closest('.mermaid-size-btn');
    if (sizeBtn) {
      const newSize = parseInt(sizeBtn.getAttribute('data-size'), 10) || 100;
      const prevSize = container.getAttribute('data-width-percent') || '100';
      if (String(newSize) !== prevSize) {
        container.setAttribute('data-previous-width', prevSize);
      }
      container.setAttribute('data-width-percent', String(newSize));
      container.style.width = `${newSize}%`;
      container.style.maxWidth = `${newSize}%`;

      toolbar.querySelectorAll('.mermaid-size-btn').forEach(b => b.classList.remove('active'));
      sizeBtn.classList.add('active');

      const undoBtn = toolbar.querySelector('.mermaid-undo-btn');
      if (undoBtn) undoBtn.style.display = 'inline-flex';

      container.dispatchEvent(new CustomEvent('mermaid-action', {
        bubbles: true,
        detail: { action: 'resize', container, widthPercent: newSize, diagramType: 'cardflow' }
      }));
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.getAttribute('data-action');

    const rawSpecEncoded = container.getAttribute('data-cardflow-spec') || '';
    let spec = null;
    try {
      spec = JSON.parse(decodeURIComponent(rawSpecEncoded));
    } catch (_) {
      spec = null;
    }

    if (action === 'copy') {
      if (navigator?.clipboard?.writeText && spec) {
        navigator.clipboard.writeText(JSON.stringify(spec, null, 2)).then(() => {
          const originalTitle = actionBtn.getAttribute('title');
          actionBtn.setAttribute('title', 'Copied!');
          actionBtn.classList.add('copied');
          setTimeout(() => {
            actionBtn.setAttribute('title', originalTitle);
            actionBtn.classList.remove('copied');
          }, 1500);
        });
      }
      return;
    }

    container.dispatchEvent(new CustomEvent('mermaid-action', {
      bubbles: true,
      detail: {
        action,
        container,
        diagramId: container.getAttribute('data-diagram-id'),
        diagramType: 'cardflow',
        spec,
        widthPercent: parseInt(container.getAttribute('data-width-percent'), 10) || 100
      }
    }));
  });

  // 2. Drag Resize Handle at Bottom-Right Corner
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'mermaid-resize-handle';
  resizeHandle.setAttribute('contenteditable', 'false');
  resizeHandle.setAttribute('data-diagram-controls', 'true');
  resizeHandle.setAttribute('title', 'Drag to resize diagram');
  resizeHandle.innerHTML = `
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="4" r="1.3" />
      <circle cx="4" cy="8" r="1.3" />
    </svg>
  `;

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = container.offsetWidth;
    const parent = container.parentElement || document.body;
    const parentWidth = parent.clientWidth || 800;
    const prevWidth = container.getAttribute('data-width-percent') || '100';

    let currentPercent = parseInt(prevWidth, 10) || 100;

    const onMouseMove = (moveEvent) => {
      moveEvent.preventDefault();
      const dx = moveEvent.clientX - startX;
      const newWidthPx = Math.max(160, startWidth + dx * 2);
      currentPercent = Math.min(100, Math.max(30, Math.round((newWidthPx / parentWidth) * 100)));
      container.style.width = `${currentPercent}%`;
      container.style.maxWidth = `${currentPercent}%`;
      container.setAttribute('data-width-percent', String(currentPercent));

      toolbar.querySelectorAll('.mermaid-size-btn').forEach(b => {
        const sz = parseInt(b.getAttribute('data-size'), 10);
        b.classList.toggle('active', Math.abs(sz - currentPercent) < 10);
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      if (String(currentPercent) !== prevWidth) {
        container.setAttribute('data-previous-width', prevWidth);
      }
      const undoBtn = toolbar.querySelector('.mermaid-undo-btn');
      if (undoBtn) undoBtn.style.display = 'inline-flex';

      container.dispatchEvent(new CustomEvent('mermaid-action', {
        bubbles: true,
        detail: { action: 'resize-end', container, widthPercent: currentPercent, diagramType: 'cardflow' }
      }));
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  container.appendChild(toolbar);
  container.appendChild(resizeHandle);
}

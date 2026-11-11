import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { hydrateMermaidContainers } from './mermaidHelper';

// In-memory cache for downloaded TTF font binary base64 strings
const fontCache = new Map();

/**
 * Maps font family names to font files in public/fonts
 */
const FONT_FILE_MAP = {
  'Kalam': { file: 'Kalam-Regular.ttf', boldFile: 'Kalam-Bold.ttf', isHandwritten: true },
  'Caveat': { file: 'Caveat-Regular.ttf', boldFile: 'Caveat-Regular.ttf', isHandwritten: true },
  'Inter': { file: 'Inter-Regular.ttf', boldFile: 'Inter-Regular.ttf', isHandwritten: false },
  'Roboto': { file: 'Inter-Regular.ttf', boldFile: 'Inter-Regular.ttf', isHandwritten: false },
  'Outfit': { file: 'Inter-Regular.ttf', boldFile: 'Inter-Regular.ttf', isHandwritten: false },
  'Lora': { file: 'Lora-Regular.ttf', boldFile: 'Lora-Regular.ttf', isHandwritten: false },
  'Playfair Display': { file: 'Lora-Regular.ttf', boldFile: 'Lora-Regular.ttf', isHandwritten: false },
  'Fira Code': { file: 'FiraCode-Regular.ttf', boldFile: 'FiraCode-Regular.ttf', isHandwritten: false }
};

/**
 * Pre-fetches a font into browser memory on demand
 */
export async function prefetchFont(fontFamily) {
  const fontMeta = FONT_FILE_MAP[fontFamily] || FONT_FILE_MAP['Inter'];
  if (!fontCache.has(fontMeta.file)) {
    try {
      const res = await fetch(`/fonts/${fontMeta.file}`);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        const b64 = arrayBufferToBase64(buffer);
        fontCache.set(fontMeta.file, b64);
      }
    } catch (e) {
      console.warn('Font prefetch warning:', e);
    }
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Helper to convert an SVG element to high-res PNG Data URL at 2x scale
 * Ensures explicit xmlns, width, and height so Image() renders reliably on canvas.
 */
async function svgElementToPngDataUrl(svgElement, scale = 2) {
  if (!svgElement) return null;
  return new Promise((resolve) => {
    try {
      const bbox = svgElement.getBoundingClientRect ? svgElement.getBoundingClientRect() : { width: 0, height: 0 };
      let width = bbox.width > 0 ? bbox.width : 0;
      let height = bbox.height > 0 ? bbox.height : 0;

      if (!width || !height) {
        const vb = svgElement.viewBox?.baseVal;
        if (vb && vb.width > 0 && vb.height > 0) {
          width = vb.width;
          height = vb.height;
        } else {
          const vbAttr = svgElement.getAttribute('viewBox');
          if (vbAttr) {
            const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
            if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
              width = parts[2];
              height = parts[3];
            }
          }
        }
      }

      if (!width || !height) {
        const wAttr = parseFloat(svgElement.getAttribute('width'));
        const hAttr = parseFloat(svgElement.getAttribute('height'));
        if (wAttr > 0 && hAttr > 0) {
          width = wAttr;
          height = hAttr;
        }
      }

      if (!width || width <= 0) width = 600;
      if (!height || height <= 0) height = 400;

      const svgClone = svgElement.cloneNode(true);
      svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      svgClone.setAttribute('width', String(width));
      svgClone.setAttribute('height', String(height));

      const xml = new XMLSerializer().serializeToString(svgClone);
      const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(10, Math.round(width * scale));
          canvas.height = Math.max(10, Math.round(height * scale));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            resolve({ dataUrl, width, height });
            return;
          }
          resolve(null);
        } catch (canvasErr) {
          console.warn('Canvas rasterization error:', canvasErr);
          resolve(null);
        }
      };
      img.onerror = (err) => {
        console.warn('SVG image load error in PDF export:', err);
        resolve(null);
      };
      img.src = svgDataUrl;
    } catch (e) {
      console.warn('SVG to PNG conversion exception:', e);
      resolve(null);
    }
  });
}

/**
 * Pre-processes all Mermaid diagrams in the cloned export DOM before PDF generation:
 * - Awaits document.fonts.ready to ensure diagram fonts (e.g. Inter) are loaded before canvas draw
 * - Hydrates any unhydrated diagram containers in the cloned DOM
 * - Converts each SVG to a 2x scale PNG data URL
 * - Replaces the SVG with an <img> (max-width: 100%, height: auto)
 * - Removes injected <style> text nodes left by Mermaid in the export DOM
 * - Awaits Promise.all on all image replacements before PDF rendering begins
 */
async function prepareExportMermaidDiagrams(exportDom) {
  if (!exportDom) return;

  // 1. Ensure fonts are ready before canvas draw
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (_) {}
  }

  // 2. Hydrate any unhydrated diagram containers in the export DOM
  try {
    await hydrateMermaidContainers(exportDom, false);
  } catch (err) {
    console.warn('Hydrating mermaid diagrams in export DOM warning:', err);
  }

  // 3. Find all SVG elements within Mermaid containers or direct SVGs
  const diagramContainers = Array.from(exportDom.querySelectorAll('.mermaid-diagram-container, .mermaid'));
  const conversionPromises = diagramContainers.map(async (container) => {
    // Skip if error banner is present
    if (container.classList.contains('mermaid-error-banner') || container.querySelector('.mermaid-error-banner')) {
      return;
    }

    // Strip any interactive editing controls from cloned export DOM
    container.querySelectorAll('[data-diagram-controls="true"], .mermaid-hover-toolbar, .mermaid-resize-handle').forEach(el => el.remove());

    const svg = container.querySelector('svg');
    if (!svg) return;

    try {
      const pngResult = await svgElementToPngDataUrl(svg, 2.0);
      if (pngResult && pngResult.dataUrl) {
        const img = document.createElement('img');
        img.src = pngResult.dataUrl;
        img.className = 'mermaid-rendered-img';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '0 auto';
        img.setAttribute('data-original-width', String(pngResult.width));
        img.setAttribute('data-original-height', String(pngResult.height));

        const widthPercentAttr = container.getAttribute('data-width-percent');
        if (widthPercentAttr) {
          img.setAttribute('data-width-percent', widthPercentAttr);
          img.style.maxWidth = `${widthPercentAttr}%`;
          img.style.width = `${widthPercentAttr}%`;
        }

        // Clean out internal SVG and <style> tags completely to avoid text leaks
        container.innerHTML = '';
        container.appendChild(img);
        container.classList.add('mermaid-img-ready');
        container.style.pageBreakInside = 'avoid';
        container.style.breakInside = 'avoid';
      }
    } catch (err) {
      console.warn('Diagram SVG to PNG conversion failed:', err);
    }
  });

  await Promise.all(conversionPromises);

  // 4. Remove any injected <style> text nodes left by Mermaid in the export DOM
  exportDom.querySelectorAll('style[id*="mermaid"], style.mermaid-style').forEach(st => st.remove());
}

/**
 * Helper to convert an HTML formula or diagram container to high-res image
 */
async function domElementToPngDataUrl(el, scale = 2) {
  if (!el) return null;
  // If element contains an SVG, use direct SVG rendering
  const svg = el.querySelector('svg');
  if (svg) {
    return await svgElementToPngDataUrl(svg, scale);
  }

  // Otherwise draw styled text representation or canvas
  return new Promise((resolve) => {
    try {
      const rect = el.getBoundingClientRect();
      const width = Math.max(80, rect.width || 300);
      const height = Math.max(30, rect.height || 50);

      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);

      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Render formula text
      ctx.fillStyle = '#0f172a';
      ctx.font = '16px "KaTeX_Main", "Times New Roman", serif';
      const text = el.innerText || el.textContent || '';
      ctx.fillText(text, 10, height / 2 + 5);

      resolve({ dataUrl: canvas.toDataURL('image/png'), width, height });
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Main Client-Side PDF Generation Function
 */
export async function generateClientPDF(options = {}) {
  const {
    docTitle = 'Untitled Note',
    questions = [],
    exportScope = 'all',
    selectedSections = [],
    autoNumbering = true,
    includeTOC = false,
    exportTheme = 'default',
    exportFontFamily = 'Inter',
    exportFontSize = '14px',
    exportLineSpacing = '1.6',
    exportMargins = 'normal',
    exportHeaderText = '',
    exportFooterText = '',
    exportWatermarkText = '',
    exportLogoUrl = '',
    includePageNumbers = true,
    exportMetadata = {},
    isHandwrittenMode = false,
    signal = null,
    onProgress = () => {}
  } = options;

  onProgress('preparing', 10);
  if (signal?.aborted) throw new Error('AbortError');

  // Initialize jsPDF document in A4 mm units
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297mm

  // Margin mapping
  const marginConfig = {
    narrow: { top: 15, bottom: 15, left: 12, right: 12 },
    normal: { top: 22, bottom: 22, left: 20, right: 20 },
    wide: { top: 30, bottom: 30, left: 28, right: 28 }
  }[exportMargins] || { top: 22, bottom: 22, left: 20, right: 20 };

  const isCursiveMode = isHandwrittenMode || exportTheme === 'kalam' || exportFontFamily === 'Kalam' || exportFontFamily === 'Caveat';
  const chosenFontKey = isCursiveMode ? (exportFontFamily === 'Caveat' ? 'Caveat' : 'Kalam') : exportFontFamily;
  const fontMeta = FONT_FILE_MAP[chosenFontKey] || FONT_FILE_MAP['Inter'];
  const codeFontMeta = FONT_FILE_MAP['Fira Code'];

  // Ensure primary font and monospace font are loaded in VFS
  onProgress('rendering', 25);
  await ensureFontLoaded(doc, fontMeta.file, chosenFontKey);
  await ensureFontLoaded(doc, codeFontMeta.file, 'FiraCode');

  // Register font in doc
  doc.setFont(chosenFontKey, 'normal');

  // Colors & Typography
  const primaryInkColor = isCursiveMode ? [0, 71, 171] : (exportTheme === 'dark' ? [248, 250, 252] : [15, 23, 42]);
  const secondaryColor = isCursiveMode ? [225, 29, 72] : [99, 102, 241];
  const paperLineColor = [226, 232, 240];
  const marginRedLineColor = [255, 107, 107];

  const contentWidth = pageWidth - marginConfig.left - marginConfig.right;
  let currentY = marginConfig.top;

  // Font sizing scale
  const fontScaleMap = { '12px': 9.5, '14px': 11, '16px': 12.5, '18px': 14 };
  const baseFontSize = fontScaleMap[exportFontSize] || 11;
  const lineSpacingMultiplier = parseFloat(exportLineSpacing) || 1.5;

  /**
   * Draws background ruled notebook paper lines or dark canvas
   */
  function drawPageBackground() {
    if (exportTheme === 'dark') {
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
      return;
    }

    if (isCursiveMode) {
      // Ruled blue horizontal lines every 9mm
      doc.setDrawColor(paperLineColor[0], paperLineColor[1], paperLineColor[2]);
      doc.setLineWidth(0.2);
      for (let y = 27; y <= pageHeight - 15; y += 9) {
        doc.line(marginConfig.left, y, pageWidth - marginConfig.right, y);
      }
      // Pink/red vertical margin line
      doc.setDrawColor(marginRedLineColor[0], marginRedLineColor[1], marginRedLineColor[2]);
      doc.setLineWidth(0.4);
      doc.line(marginConfig.left + 5, 10, marginConfig.left + 5, pageHeight - 10);
    }
  }

  /**
   * Adds a new page with proper background and resets Y cursor
   */
  function addNewPage() {
    doc.addPage();
    drawPageBackground();
    currentY = marginConfig.top + (isCursiveMode ? 9 : 0);
  }

  // Draw background for first page
  drawPageBackground();
  if (isCursiveMode) currentY = Math.max(currentY, 27);

  // 1. Optional Logo
  if (exportLogoUrl) {
    try {
      const logoImg = await loadImage(exportLogoUrl);
      if (logoImg) {
        const logoWidth = 35;
        const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
        doc.addImage(logoImg.src, 'PNG', pageWidth - marginConfig.right - logoWidth, currentY, logoWidth, logoHeight);
        currentY += logoHeight + 6;
      }
    } catch (_) {}
  }

  // 2. Document Title (Headings)
  doc.setFont(chosenFontKey, 'normal');
  doc.setFontSize(isCursiveMode ? 26 : 22);
  doc.setTextColor(primaryInkColor[0], primaryInkColor[1], primaryInkColor[2]);
  
  const titleLines = doc.splitTextToSize(docTitle, contentWidth);
  titleLines.forEach(line => {
    doc.text(line, pageWidth / 2, currentY, { align: 'center' });
    currentY += (isCursiveMode ? 10 : 8);
  });

  // Title divider line
  doc.setDrawColor(primaryInkColor[0], primaryInkColor[1], primaryInkColor[2]);
  doc.setLineWidth(0.4);
  const divWidth = Math.min(contentWidth * 0.6, 90);
  doc.line((pageWidth - divWidth) / 2, currentY, (pageWidth + divWidth) / 2, currentY);
  currentY += isCursiveMode ? 12 : 8;

  // Metadata block (Author, Institution, Subject)
  if (exportMetadata.subject || exportMetadata.author || exportMetadata.institutionName) {
    doc.setFontSize(baseFontSize - 1);
    doc.setTextColor(100, 116, 139);
    const metaParts = [
      exportMetadata.subject ? `Subject: ${exportMetadata.subject}` : '',
      exportMetadata.author ? `Author: ${exportMetadata.author}` : '',
      exportMetadata.institutionName ? `Institution: ${exportMetadata.institutionName}` : '',
      exportMetadata.academicYear ? `Year: ${exportMetadata.academicYear}` : ''
    ].filter(Boolean).join('  |  ');
    if (metaParts) {
      doc.text(metaParts, pageWidth / 2, currentY, { align: 'center' });
      currentY += 8;
    }
  }

  // Filter sections according to scope
  let filteredQuestions = [...questions];
  if (exportScope === 'selected' && selectedSections.length > 0) {
    filteredQuestions = filteredQuestions.filter((_, idx) => selectedSections.includes(idx));
  }

  // 3. Table of Contents
  if (includeTOC && filteredQuestions.length > 0) {
    if (currentY + 40 > pageHeight - marginConfig.bottom) addNewPage();
    
    doc.setFont(chosenFontKey, 'normal');
    doc.setFontSize(isCursiveMode ? 18 : 16);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text('Table of Contents', marginConfig.left, currentY);
    currentY += 8;

    doc.setFontSize(baseFontSize);
    doc.setTextColor(primaryInkColor[0], primaryInkColor[1], primaryInkColor[2]);

    filteredQuestions.forEach((q, idx) => {
      if (currentY + 8 > pageHeight - marginConfig.bottom) addNewPage();
      const numPrefix = autoNumbering ? `Q${idx + 1}. ` : '';
      const qTitle = (numPrefix + (q.question || `Question ${idx + 1}`)).slice(0, 60);
      doc.text(qTitle, marginConfig.left + 4, currentY);
      doc.text(`[${q.marks || 0} marks]`, pageWidth - marginConfig.right, currentY, { align: 'right' });
      currentY += isCursiveMode ? 9 : 6.5;
    });

    currentY += 10;
  }

  onProgress('generating', 45);

  // 4. Iterate over Questions and Render Content
  for (let i = 0; i < filteredQuestions.length; i++) {
    if (signal?.aborted) throw new Error('AbortError');
    onProgress('generating', 45 + Math.floor((i / filteredQuestions.length) * 40));

    const q = filteredQuestions[i];
    const qNum = autoNumbering ? `Q${i + 1}. ` : '';

    // Smart break: Avoid orphan question headers near page bottom
    if (currentY + 38 > pageHeight - marginConfig.bottom) {
      addNewPage();
    }

    // Question Header & Marks
    if (exportScope !== 'answers') {
      doc.setFont(chosenFontKey, 'normal');
      doc.setFontSize(isCursiveMode ? 18 : 15);
      doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);

      const questionText = `${qNum}${q.question || 'Untitled Question'}`;
      const qLines = doc.splitTextToSize(questionText, contentWidth - 25);
      
      qLines.forEach((line, lIdx) => {
        doc.text(line, marginConfig.left, currentY);
        if (lIdx === 0 && q.marks) {
          doc.setFontSize(isCursiveMode ? 14 : 11);
          doc.setTextColor(isCursiveMode ? primaryInkColor[0] : 99, isCursiveMode ? primaryInkColor[1] : 102, isCursiveMode ? primaryInkColor[2] : 241);
          doc.text(`[${q.marks} Marks]`, pageWidth - marginConfig.right, currentY, { align: 'right' });
          doc.setFontSize(isCursiveMode ? 18 : 15);
          doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
        }
        currentY += isCursiveMode ? 9 : 7;
      });

      currentY += 3;
    }

    // Answer Content
    if (exportScope !== 'questions' && q.answer) {
      doc.setFont(chosenFontKey, 'normal');
      doc.setFontSize(baseFontSize);
      doc.setTextColor(primaryInkColor[0], primaryInkColor[1], primaryInkColor[2]);

      // Parse HTML structure
      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'fixed';
      tempDiv.style.left = '-9999px';
      tempDiv.style.top = '0';
      tempDiv.style.width = '800px';
      tempDiv.innerHTML = q.answer;
      document.body.appendChild(tempDiv);

      // Pre-process all Mermaid diagrams in cloned DOM: rasterize to 2x PNG img, remove style leaks
      try {
        await prepareExportMermaidDiagrams(tempDiv);
      } catch (err) {
        console.warn('Pre-rendering mermaid diagrams in PDF export warning:', err);
      }

      // Hydrate KaTeX math formulas in export container
      try {
        if (!window.renderMathInElement) {
          const autoRender = await import('katex/dist/contrib/auto-render.mjs');
          await import('katex/dist/katex.min.css');
          window.renderMathInElement = autoRender.default || autoRender;
        }
        if (window.renderMathInElement) {
          window.renderMathInElement(tempDiv, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\(', right: '\\)', display: false },
              { left: '\\[', right: '\\]', display: true }
            ],
            throwOnError: false
          });
        }
      } catch (err) {
        console.warn('Hydrating math formulas in PDF export warning:', err);
      }

      // Render each child block sequentially
      const childNodes = Array.from(tempDiv.childNodes);
      if (childNodes.length === 0) {
        // Plain text fallback
        renderTextParagraph(doc, tempDiv.innerText || tempDiv.textContent, {
          chosenFontKey,
          baseFontSize,
          primaryInkColor,
          marginConfig,
          pageWidth,
          pageHeight,
          contentWidth,
          lineSpacingMultiplier,
          isCursiveMode,
          getY: () => currentY,
          setY: (y) => { currentY = y; },
          addNewPage
        });
      } else {
        for (const child of childNodes) {
          if (signal?.aborted) {
            tempDiv.remove();
            throw new Error('AbortError');
          }
          if (child.nodeType === 3) {
            // Text node
            const txt = (child.textContent || '').trim();
            if (txt) {
              renderTextParagraph(doc, txt, {
                chosenFontKey,
                baseFontSize,
                primaryInkColor,
                secondaryColor,
                marginConfig,
                pageWidth,
                pageHeight,
                contentWidth,
                lineSpacingMultiplier,
                isCursiveMode,
                exportTheme,
                getY: () => currentY,
                setY: (y) => { currentY = y; },
                addNewPage
              });
            }
          } else if (child.nodeType === 1) {
            // Element node
            await renderNodeBlock(doc, child, {
              chosenFontKey,
              baseFontSize,
              primaryInkColor,
              secondaryColor,
              marginConfig,
              pageWidth,
              pageHeight,
              contentWidth,
              lineSpacingMultiplier,
              isCursiveMode,
              exportTheme,
              getY: () => currentY,
              setY: (y) => { currentY = y; },
              addNewPage
            });
          }
        }
      }
      tempDiv.remove();

      currentY += isCursiveMode ? 9 : 8;
    }
  }

  onProgress('optimizing', 90);

  // 5. Running Headers, Footers, Page Numbers, Watermark
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    // Diagonal Watermark
    if (exportWatermarkText) {
      doc.setFont(chosenFontKey, 'normal');
      doc.setFontSize(48);
      doc.setTextColor(148, 163, 184);
      // Light opacity simulation via high lightness
      doc.text(exportWatermarkText, pageWidth / 2, pageHeight / 2, {
        align: 'center',
        angle: 45
      });
    }

    // Running Header
    if (exportHeaderText || exportMetadata.title || docTitle) {
      doc.setFont(chosenFontKey, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      const leftHeader = exportHeaderText || '';
      const rightHeader = exportMetadata.title || docTitle || '';
      if (leftHeader) doc.text(leftHeader, marginConfig.left, 10);
      if (rightHeader) doc.text(rightHeader, pageWidth - marginConfig.right, 10, { align: 'right' });
    }

    // Running Footer & Page Number
    if (exportFooterText || includePageNumbers) {
      doc.setFont(chosenFontKey, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      if (exportFooterText) doc.text(exportFooterText, marginConfig.left, pageHeight - 8);
      if (includePageNumbers) {
        doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginConfig.right, pageHeight - 8, { align: 'right' });
      }
    }
  }

  // Set PDF Metadata
  doc.setProperties({
    title: exportMetadata.title || docTitle,
    subject: exportMetadata.subject || 'SmartNotes Export',
    author: exportMetadata.author || 'SmartNotes AI',
    keywords: exportMetadata.keywords || 'notes, study, smartnotes',
    creator: 'SmartNotes AI Client Vector Engine'
  });

  onProgress('exporting', 98);
  if (signal?.aborted) throw new Error('AbortError');

  // Trigger browser download directly
  const safeFilename = (docTitle || 'notes').replace(/[^a-zA-Z0-9_\-\.]/g, '_') + '.pdf';
  doc.save(safeFilename);

  onProgress('done', 100);
  return { success: true, filename: safeFilename, pages: totalPages };
}

/**
 * Ensures a font file is loaded into jsPDF Virtual File System
 */
async function ensureFontLoaded(doc, fileName, fontName) {
  let b64 = fontCache.get(fileName);
  if (!b64) {
    const res = await fetch(`/fonts/${fileName}`);
    if (!res.ok) throw new Error(`Could not load font /fonts/${fileName}`);
    const buffer = await res.arrayBuffer();
    b64 = arrayBufferToBase64(buffer);
    fontCache.set(fileName, b64);
  }
  doc.addFileToVFS(fileName, b64);
  doc.addFont(fileName, fontName, 'normal');
  doc.addFont(fileName, fontName, 'bold');
}

/**
 * Loads an image from URL into an HTML Image object
 */
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Renders a plain text paragraph with wrapping and smart pagination
 */
function renderTextParagraph(doc, rawText, ctx) {
  if (!rawText || !rawText.trim()) return;
  const { chosenFontKey, baseFontSize, primaryInkColor, marginConfig, pageWidth, pageHeight, contentWidth, lineSpacingMultiplier, isCursiveMode, getY, setY, addNewPage } = ctx;

  doc.setFont(chosenFontKey, 'normal');
  doc.setFontSize(baseFontSize);
  doc.setTextColor(primaryInkColor[0], primaryInkColor[1], primaryInkColor[2]);

  const step = isCursiveMode ? 9 : (baseFontSize * 0.3528 * lineSpacingMultiplier);
  const lines = doc.splitTextToSize(rawText.trim(), contentWidth);

  for (const line of lines) {
    if (getY() + step > pageHeight - marginConfig.bottom) {
      addNewPage();
    }
    doc.text(line, marginConfig.left, getY());
    setY(getY() + step);
  }
  setY(getY() + (isCursiveMode ? 3 : 2));
}

/**
 * Detects whether a DOM node is a dedicated formula block (e.g. .katex-display)
 */
function isFormulaNode(node) {
  if (!node || node.nodeType !== 1) return false;
  const tagName = node.tagName ? node.tagName.toUpperCase() : '';
  const className = typeof node.className === 'string' ? node.className : '';

  if (className.includes('katex-display') || className.includes('formula-block')) return true;
  if (node.classList && (node.classList.contains('katex-display') || node.classList.contains('formula-block'))) return true;
  if ((tagName === 'P' || tagName === 'DIV') && node.children.length === 1) {
    const firstChild = node.children[0];
    const cName = typeof firstChild.className === 'string' ? firstChild.className : '';
    if (cName.includes('katex-display') || cName.includes('formula-block') || cName.includes('katex')) {
      return true;
    }
  }
  return false;
}

/**
 * Detects whether a DOM node is an actual code block or ASCII diagram,
 * and NOT a paragraph or list item that happens to contain inline <code>.
 */
function isCodeBlockNode(node) {
  if (!node || node.nodeType !== 1) return false;
  const tagName = node.tagName ? node.tagName.toUpperCase() : '';
  const className = typeof node.className === 'string' ? node.className : '';

  if (tagName === 'PRE') return true;
  if (className.includes('ascii-block') || className.includes('code-block')) return true;
  if (tagName === 'CODE' && (!node.parentElement || !['P', 'LI', 'SPAN', 'TD', 'TH', 'BLOCKQUOTE'].includes(node.parentElement.tagName))) {
    return true;
  }
  if (tagName === 'DIV' && node.children.length === 1 && node.children[0].tagName === 'PRE') {
    return true;
  }
  return false;
}

/**
 * Renders a mathematical formula block into jsPDF with centered callout box and clean typography
 */
async function renderFormulaBlock(doc, node, ctx) {
  const { chosenFontKey, baseFontSize, primaryInkColor, marginConfig, pageWidth, pageHeight, contentWidth, isCursiveMode, getY, setY, addNewPage } = ctx;

  let formulaText = '';
  const katexHtml = node.querySelector('.katex-html');
  const annotation = node.querySelector('annotation');

  if (katexHtml && (katexHtml.innerText || katexHtml.textContent)) {
    formulaText = (katexHtml.innerText || katexHtml.textContent).trim();
  } else if (annotation && annotation.textContent) {
    formulaText = annotation.textContent.trim();
  } else {
    formulaText = (node.innerText || node.textContent || '').trim();
  }

  // Clean formula display string
  formulaText = formulaText
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\mathrm\{([^}]+)\}/g, '$1')
    .replace(/\\mathbf\{([^}]+)\}/g, '$1')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // If node contains an SVG (e.g. square roots, arrows, complex symbols)
  if (node.querySelector('svg')) {
    const rendered = await domElementToPngDataUrl(node, 2.5);
    if (rendered && rendered.dataUrl) {
      const imgWidth = Math.min(contentWidth * 0.85, (rendered.width / 2.5) * 0.264);
      const imgHeight = (rendered.height / rendered.width) * imgWidth;
      const boxHeight = imgHeight + 8;

      if (getY() + boxHeight > pageHeight - marginConfig.bottom) addNewPage();

      const boxWidth = Math.min(contentWidth, Math.max(imgWidth + 16, 85));
      const boxX = marginConfig.left + (contentWidth - boxWidth) / 2;

      // Draw subtle formula callout box
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.roundedRect(boxX, getY(), boxWidth, boxHeight, 2.5, 2.5, 'FD');

      const imgX = boxX + (boxWidth - imgWidth) / 2;
      doc.addImage(rendered.dataUrl, 'PNG', imgX, getY() + 4, imgWidth, imgHeight);
      setY(getY() + boxHeight + 4);
      return;
    }
  }

  // Vector formula callout box
  doc.setFont(chosenFontKey, 'normal');
  doc.setFontSize(isCursiveMode ? baseFontSize + 2 : baseFontSize + 1.5);

  const textWidth = doc.getTextWidth(formulaText);
  const boxWidth = Math.min(contentWidth, Math.max(textWidth + 24, 75));
  const boxHeight = 14;

  if (getY() + boxHeight + 4 > pageHeight - marginConfig.bottom) addNewPage();

  const boxX = marginConfig.left + (contentWidth - boxWidth) / 2;

  // Background and border matching preview
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(boxX, getY(), boxWidth, boxHeight, 2.5, 2.5, 'FD');

  // Centered formula text
  doc.setTextColor(30, 41, 59); // #1e293b dark slate
  doc.text(formulaText, boxX + boxWidth / 2, getY() + (boxHeight / 2) + 1.5, { align: 'center' });

  setY(getY() + boxHeight + 4);
  doc.setFontSize(baseFontSize);
  doc.setTextColor(primaryInkColor[0], primaryInkColor[1], primaryInkColor[2]);
}

/**
 * Renders a list item paragraph with hanging indent and proper prefix
 */
function renderListItemText(doc, prefix, rawText, ctx) {
  if (!rawText || !rawText.trim()) return;
  const { chosenFontKey, baseFontSize, primaryInkColor, marginConfig, pageHeight, contentWidth, lineSpacingMultiplier, isCursiveMode, getY, setY, addNewPage } = ctx;

  doc.setFont(chosenFontKey, 'normal');
  doc.setFontSize(baseFontSize);
  doc.setTextColor(primaryInkColor[0], primaryInkColor[1], primaryInkColor[2]);

  const step = isCursiveMode ? 9 : (baseFontSize * 0.3528 * lineSpacingMultiplier);
  const itemIndent = isCursiveMode ? 4 : 3;
  const prefixWidth = Math.max(doc.getTextWidth(prefix) + 1.5, 6);
  const textWidth = contentWidth - itemIndent - prefixWidth;

  // Strip leading prefix if it was already included in rawText to avoid "1. 1. "
  let cleanText = rawText.trim();
  const escapedPrefix = prefix.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  cleanText = cleanText.replace(new RegExp('^' + escapedPrefix + '\\s*'), '');

  const lines = doc.splitTextToSize(cleanText, textWidth);

  for (let i = 0; i < lines.length; i++) {
    if (getY() + step > pageHeight - marginConfig.bottom) {
      addNewPage();
    }
    if (i === 0) {
      doc.text(prefix, marginConfig.left + itemIndent, getY());
    }
    doc.text(lines[i], marginConfig.left + itemIndent + prefixWidth, getY());
    setY(getY() + step);
  }
}

/**
 * Renders a specific DOM node block into the jsPDF canvas
 */
async function renderNodeBlock(doc, node, ctx) {
  if (!node) return;
  const tagName = node.tagName ? node.tagName.toUpperCase() : '';
  const className = typeof node.className === 'string' ? node.className : '';
  const { chosenFontKey, baseFontSize, primaryInkColor, secondaryColor, marginConfig, pageWidth, pageHeight, contentWidth, lineSpacingMultiplier, isCursiveMode, exportTheme, getY, setY, addNewPage } = ctx;

  // 1. Headings (H1 to H6)
  if (/^H[1-6]$/.test(tagName)) {
    const level = parseInt(tagName.charAt(1), 10);
    const headingSizes = { 1: 18, 2: 15, 3: 13, 4: 12, 5: 11, 6: 10 };
    const hSize = headingSizes[level] || 14;
    let breakThreshold = (level <= 2) ? 22 : 16;

    // Keep heading with its diagram so heading is never left alone at bottom of page
    const nextEl = node.nextElementSibling;
    if (nextEl && (
      nextEl.classList?.contains('mermaid-diagram-container') ||
      nextEl.classList?.contains('mermaid') ||
      nextEl.querySelector?.('.mermaid, svg, img.mermaid-rendered-img')
    )) {
      const diagImg = nextEl.querySelector('img.mermaid-rendered-img, img');
      let diagHeight = 60; // sensible estimated diagram height in mm
      if (diagImg) {
        const oW = parseFloat(diagImg.getAttribute('data-original-width')) || 600;
        const oH = parseFloat(diagImg.getAttribute('data-original-height')) || 400;
        const dispW = Math.min(contentWidth, 160);
        diagHeight = Math.min((oH / oW) * dispW, pageHeight - marginConfig.top - marginConfig.bottom - 25);
      }
      breakThreshold = Math.max(breakThreshold, (hSize * 0.45) + diagHeight + 10);
    }

    if (getY() + breakThreshold > pageHeight - marginConfig.bottom) addNewPage();

    doc.setFont(chosenFontKey, 'normal');
    doc.setFontSize(isCursiveMode ? hSize + 3 : hSize);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);

    const lines = doc.splitTextToSize(node.innerText.trim(), contentWidth);
    lines.forEach(line => {
      doc.text(line, marginConfig.left, getY());
      setY(getY() + (isCursiveMode ? 9 : hSize * 0.45));
    });
    setY(getY() + 3);
    return;
  }

  // 2. Diagrams (Mermaid SVG & containers)
  if (
    (className.includes('mermaid') || tagName === 'SVG' || className.includes('mermaid-diagram-container') || node.querySelector('.mermaid, svg, .mermaid-diagram-container, img.mermaid-rendered-img')) &&
    !className.includes('mermaid-error-banner') &&
    !node.querySelector('.mermaid-error-banner')
  ) {
    let dataUrl = null;
    let width = 0;
    let height = 0;

    const imgEl = node.tagName === 'IMG' ? node : node.querySelector('img.mermaid-rendered-img, img');
    if (imgEl && imgEl.src && imgEl.src.startsWith('data:image/')) {
      dataUrl = imgEl.src;
      width = parseFloat(imgEl.getAttribute('data-original-width')) || imgEl.naturalWidth || 600;
      height = parseFloat(imgEl.getAttribute('data-original-height')) || imgEl.naturalHeight || 400;
    } else {
      const targetElement = tagName === 'SVG' ? node : (node.querySelector('svg') || node);
      const rendered = await svgElementToPngDataUrl(targetElement, 2.0);
      if (rendered && rendered.dataUrl) {
        dataUrl = rendered.dataUrl;
        width = rendered.width;
        height = rendered.height;
      }
    }

    if (dataUrl && width > 0 && height > 0) {
      const maxPdfHeight = pageHeight - marginConfig.top - marginConfig.bottom - 15;
      let baseWidth = Math.min(contentWidth, 160);

      // Check saved width percent (e.g. S=40%, M=70%, L=100% or custom drag percent)
      const containerEl = (node.classList && (node.classList.contains('mermaid-diagram-container') || node.classList.contains('mermaid')))
        ? node
        : (node.closest ? node.closest('.mermaid-diagram-container, .mermaid') : null);
      const widthPercentVal = containerEl?.getAttribute?.('data-width-percent') ||
        node.getAttribute?.('data-width-percent') ||
        imgEl?.getAttribute?.('data-width-percent');
      const widthPercent = parseFloat(widthPercentVal);
      if (!isNaN(widthPercent) && widthPercent > 0 && widthPercent <= 100) {
        baseWidth = baseWidth * (widthPercent / 100);
      }

      let imgWidth = baseWidth;
      let imgHeight = (height / width) * imgWidth;

      // Prevent cut-off: if diagram height exceeds full page printable area, scale proportionally
      if (imgHeight > maxPdfHeight) {
        imgHeight = maxPdfHeight;
        imgWidth = (width / height) * imgHeight;
      }

      // Check if page break needed
      if (getY() + imgHeight > pageHeight - marginConfig.bottom) {
        addNewPage();
      }

      const posX = (pageWidth - imgWidth) / 2;
      doc.addImage(dataUrl, 'PNG', posX, getY(), imgWidth, imgHeight);
      setY(getY() + imgHeight + 6);
      return;
    }

    // Never fall through to print raw CSS or style text
    return;
  }

  // 3. Mathematical Formulas (KaTeX display or formula block)
  if (isFormulaNode(node)) {
    await renderFormulaBlock(doc, node, ctx);
    return;
  }

  // 4. Tables (Vector table via jspdf-autotable)
  if (tagName === 'TABLE') {
    const head = [];
    const body = [];

    const ths = Array.from(node.querySelectorAll('thead th, tr:first-child th'));
    if (ths.length > 0) {
      head.push(ths.map(th => th.innerText.trim()));
    }

    const trs = Array.from(node.querySelectorAll('tbody tr, tr')).filter(tr => !tr.querySelector('th'));
    trs.forEach(tr => {
      const row = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      if (row.length > 0) body.push(row);
    });

    if (head.length > 0 || body.length > 0) {
      if (getY() + 30 > pageHeight - marginConfig.bottom) addNewPage();

      const tableOptions = {
        startY: getY(),
        margin: { left: marginConfig.left, right: marginConfig.right },
        head: head.length > 0 ? head : undefined,
        body: body,
        theme: isCursiveMode ? 'plain' : 'striped',
        styles: {
          font: chosenFontKey,
          fontSize: isCursiveMode ? baseFontSize : baseFontSize - 1,
          textColor: primaryInkColor,
          cellPadding: isCursiveMode ? 2.5 : 3,
          lineColor: [203, 213, 225],
          lineWidth: 0.2
        },
        headStyles: {
          fillColor: isCursiveMode ? undefined : [99, 102, 241],
          textColor: isCursiveMode ? secondaryColor : [255, 255, 255],
          fontStyle: 'normal'
        },
        didDrawPage: () => {
          if (isCursiveMode) drawPageBackground();
        }
      };

      if (typeof doc.autoTable === 'function') {
        doc.autoTable(tableOptions);
      } else {
        autoTable(doc, tableOptions);
      }

      const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : (getY() + 30);
      setY(finalY + 6);
      return;
    }
  }

  // 5. Lists (UL, OL) - Checked BEFORE code blocks to prevent lists from being swallowed
  if (tagName === 'UL' || tagName === 'OL') {
    const isOrdered = tagName === 'OL';
    const startAttr = parseInt(node.getAttribute('start'), 10);
    const startNum = (!isNaN(startAttr) && startAttr > 0) ? startAttr : 1;

    // Direct children li only to avoid duplicating nested items
    const items = Array.from(node.children).filter(el => el.tagName === 'LI');

    for (let idx = 0; idx < items.length; idx++) {
      const li = items[idx];
      const prefix = isOrdered ? `${startNum + idx}. ` : '• ';

      // Check for block-level children inside this li
      const blockChildren = Array.from(li.children).filter(child => {
        const cTag = child.tagName;
        return cTag === 'P' || cTag === 'DIV' || cTag === 'BLOCKQUOTE' || cTag === 'PRE' ||
               cTag === 'TABLE' || cTag === 'UL' || cTag === 'OL' || isFormulaNode(child);
      });

      if (blockChildren.length === 0) {
        renderListItemText(doc, prefix, li.innerText || li.textContent || '', ctx);
      } else {
        let isFirstBlock = true;
        for (const child of blockChildren) {
          if (isFormulaNode(child)) {
            await renderFormulaBlock(doc, child, ctx);
          } else if (child.tagName === 'UL' || child.tagName === 'OL') {
            await renderNodeBlock(doc, child, {
              ...ctx,
              marginConfig: { ...marginConfig, left: marginConfig.left + 8 },
              contentWidth: contentWidth - 8
            });
          } else if (child.tagName === 'P') {
            const pText = (child.innerText || child.textContent || '').trim();
            if (pText) {
              if (isFirstBlock) {
                renderListItemText(doc, prefix, pText, ctx);
                isFirstBlock = false;
              } else {
                renderTextParagraph(doc, pText, {
                  ...ctx,
                  marginConfig: { ...marginConfig, left: marginConfig.left + 6 },
                  contentWidth: contentWidth - 6
                });
              }
            }
          } else {
            await renderNodeBlock(doc, child, {
              ...ctx,
              marginConfig: { ...marginConfig, left: marginConfig.left + 6 },
              contentWidth: contentWidth - 6
            });
          }
        }
      }
      setY(getY() + (isCursiveMode ? 2 : 1.5));
    }
    setY(getY() + 2);
    return;
  }

  // 6. Code Blocks & ASCII Diagrams (PRE, standalone CODE, .ascii-block)
  if (isCodeBlockNode(node)) {
    const codeText = node.innerText || node.textContent || '';
    const rawLines = codeText.trimEnd().split('\n');
    const maxLineLen = Math.max(...rawLines.map(l => l.length), 1);

    const maxAllowedWidth = contentWidth - 8;
    const charWidthPt = (baseFontSize - 1.5) * 0.22;
    let codeFontSize = baseFontSize - 1.5;
    if (maxLineLen * charWidthPt > maxAllowedWidth) {
      codeFontSize = Math.max(5.5, maxAllowedWidth / (maxLineLen * 0.22));
    }

    doc.setFont('FiraCode', 'normal');
    doc.setFontSize(codeFontSize);
    const lineHeight = codeFontSize * 0.44;

    // Wrap any line that exceeds maxAllowedWidth so text never runs off into margins
    const processedLines = [];
    for (const rawLine of rawLines) {
      if (doc.getTextWidth(rawLine) > maxAllowedWidth) {
        const wrapped = doc.splitTextToSize(rawLine, maxAllowedWidth);
        processedLines.push(...wrapped);
      } else {
        processedLines.push(rawLine);
      }
    }

    const blockHeight = processedLines.length * lineHeight + 6;

    if (getY() + blockHeight > pageHeight - marginConfig.bottom) addNewPage();

    // Background container
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(marginConfig.left, getY(), contentWidth, blockHeight, 2, 2, 'FD');

    doc.setTextColor(30, 41, 59);
    let lineY = getY() + (lineHeight * 0.9) + 2;
    for (const line of processedLines) {
      doc.text(line, marginConfig.left + 4, lineY);
      lineY += lineHeight;
    }

    setY(getY() + blockHeight + 5);
    doc.setFont(chosenFontKey, 'normal');
    return;
  }

  // 7. Callout Box & Blockquotes
  if (className.includes('callout-box') || tagName === 'BLOCKQUOTE') {
    const text = node.innerText.trim();
    doc.setFont(chosenFontKey, 'normal');
    doc.setFontSize(baseFontSize);
    const lines = doc.splitTextToSize(text, contentWidth - 10);
    const boxHeight = lines.length * 5 + 6;

    if (getY() + boxHeight > pageHeight - marginConfig.bottom) addNewPage();

    doc.setFillColor(241, 245, 249);
    doc.rect(marginConfig.left, getY(), contentWidth, boxHeight, 'F');

    // Accent line on left
    doc.setDrawColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.setLineWidth(1);
    doc.line(marginConfig.left, getY(), marginConfig.left, getY() + boxHeight);

    doc.setTextColor(primaryInkColor[0], primaryInkColor[1], primaryInkColor[2]);
    let tY = getY() + 4.5;
    lines.forEach(l => {
      doc.text(l, marginConfig.left + 5, tY);
      tY += 5;
    });

    setY(getY() + boxHeight + 4);
    return;
  }

  // 8. Neutral Chat Image Placeholder
  if (className.includes('chat-image-placeholder')) {
    const text = node.innerText.trim();
    doc.setFont(chosenFontKey, 'normal');
    doc.setFontSize(baseFontSize - 1.5);
    const lines = doc.splitTextToSize(text, contentWidth - 14);
    const boxHeight = lines.length * 4.5 + 6;

    if (getY() + boxHeight > pageHeight - marginConfig.bottom) addNewPage();

    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(marginConfig.left, getY(), contentWidth, boxHeight, 1.5, 1.5, 'FD');

    doc.setTextColor(71, 85, 105);
    let lineY = getY() + 4.5;
    for (const line of lines) {
      doc.text(line, marginConfig.left + 5, lineY);
      lineY += 4.5;
    }

    setY(getY() + boxHeight + 4);
    doc.setFont(chosenFontKey, 'normal');
    return;
  }

  // 9. Images (IMG)
  if (tagName === 'IMG') {
    const src = node.getAttribute('src');
    if (src) {
      try {
        const imgObj = await loadImage(src);
        if (imgObj) {
          const maxImgWidth = Math.min(contentWidth, 140);
          const maxImgHeight = (imgObj.height / imgObj.width) * maxImgWidth;

          if (getY() + maxImgHeight > pageHeight - marginConfig.bottom) addNewPage();

          const imgX = (pageWidth - maxImgWidth) / 2;
          doc.addImage(imgObj.src, 'JPEG', imgX, getY(), maxImgWidth, maxImgHeight);
          setY(getY() + maxImgHeight + 5);
          return;
        }
      } catch (_) {}
    }
  }

  // Default: Render as standard paragraph text
  renderTextParagraph(doc, node.innerText || node.textContent, ctx);
}

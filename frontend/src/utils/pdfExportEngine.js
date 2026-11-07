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
 * Helper to convert an SVG element to high-res PNG Data URL
 */
async function svgToPngDataUrl(svgElement, scale = 3) {
  return new Promise((resolve) => {
    try {
      const svgClone = svgElement.cloneNode(true);
      const bbox = svgElement.getBoundingClientRect();
      let width = bbox.width > 0 ? bbox.width : 0;
      let height = bbox.height > 0 ? bbox.height : 0;
      if (!width || !height) {
        if (svgElement.viewBox && svgElement.viewBox.baseVal && svgElement.viewBox.baseVal.width > 0) {
          width = svgElement.viewBox.baseVal.width;
          height = svgElement.viewBox.baseVal.height;
        } else {
          width = parseFloat(svgElement.getAttribute('width')) || 600;
          height = parseFloat(svgElement.getAttribute('height')) || 400;
        }
      }
      svgClone.setAttribute('width', width);
      svgClone.setAttribute('height', height);

      const xml = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const URL = window.URL || window.webkitURL || window;
      const blobURL = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(10, width * scale);
        canvas.height = Math.max(10, height * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');
          URL.revokeObjectURL(blobURL);
          resolve({ dataUrl, width, height });
          return;
        }
        URL.revokeObjectURL(blobURL);
        resolve(null);
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobURL);
        resolve(null);
      };
      img.src = blobURL;
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Helper to convert an HTML formula or diagram container to high-res image
 */
async function domElementToPngDataUrl(el, scale = 2) {
  // If element contains an SVG, use direct SVG rendering
  const svg = el.querySelector('svg');
  if (svg) {
    return await svgToPngDataUrl(svg, scale);
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

      try {
        await hydrateMermaidContainers(tempDiv, false);
      } catch (err) {
        console.warn('Hydrating mermaid diagrams in PDF export warning:', err);
      }

      // Render each child block sequentially
      const nodes = Array.from(tempDiv.children);
      if (nodes.length === 0) {
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
        for (const node of nodes) {
          if (signal?.aborted) {
            tempDiv.remove();
            throw new Error('AbortError');
          }
          await renderNodeBlock(doc, node, {
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
 * Renders a specific DOM node block into the jsPDF canvas
 */
async function renderNodeBlock(doc, node, ctx) {
  const tagName = node.tagName ? node.tagName.toUpperCase() : '';
  const className = node.className || '';
  const { chosenFontKey, baseFontSize, primaryInkColor, secondaryColor, marginConfig, pageWidth, pageHeight, contentWidth, lineSpacingMultiplier, isCursiveMode, getY, setY, addNewPage } = ctx;

  // 1. Headings (H1 to H6)
  if (/^H[1-6]$/.test(tagName)) {
    const level = parseInt(tagName.charAt(1), 10);
    const headingSizes = { 1: 18, 2: 15, 3: 13, 4: 12, 5: 11, 6: 10 };
    const hSize = headingSizes[level] || 14;

    if (getY() + 25 > pageHeight - marginConfig.bottom) addNewPage();

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
    (className.includes('mermaid') || tagName === 'SVG' || className.includes('mermaid-diagram-container') || node.querySelector('.mermaid, svg, .mermaid-diagram-container')) &&
    !className.includes('mermaid-error-banner') &&
    !node.querySelector('.mermaid-error-banner')
  ) {
    const targetElement = tagName === 'SVG' ? node : (node.querySelector('svg') || node);
    const rendered = await domElementToPngDataUrl(targetElement, 3.0);
    if (rendered && rendered.dataUrl) {
      const maxPdfHeight = pageHeight - marginConfig.top - marginConfig.bottom - 15;
      let imgWidth = Math.min(contentWidth, 160);
      let imgHeight = (rendered.height / rendered.width) * imgWidth;

      // Prevent cut-off: if diagram height exceeds full page printable area, scale proportionally
      if (imgHeight > maxPdfHeight) {
        imgHeight = maxPdfHeight;
        imgWidth = (rendered.width / rendered.height) * imgHeight;
      }

      // Check if page break needed
      if (getY() + imgHeight > pageHeight - marginConfig.bottom) {
        addNewPage();
      }

      const posX = (pageWidth - imgWidth) / 2;
      doc.addImage(rendered.dataUrl, 'PNG', posX, getY(), imgWidth, imgHeight);
      setY(getY() + imgHeight + 6);
      return;
    }
  }

  // 3. Mathematical Formulas (KaTeX display or formula block)
  if (className.includes('katex') || className.includes('formula-block') || node.querySelector('.katex')) {
    const rendered = await domElementToPngDataUrl(node, 2.5);
    if (rendered && rendered.dataUrl) {
      const imgWidth = Math.min(contentWidth * 0.8, (rendered.width / 2.5) * 0.264);
      const imgHeight = (rendered.height / rendered.width) * imgWidth;

      if (getY() + imgHeight > pageHeight - marginConfig.bottom) addNewPage();

      const posX = (pageWidth - imgWidth) / 2;
      doc.addImage(rendered.dataUrl, 'PNG', posX, getY(), imgWidth, imgHeight);
      setY(getY() + imgHeight + 4);
      return;
    }
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

  // 5. Code Blocks & ASCII Diagrams (PRE, CODE, .ascii-block)
  if (tagName === 'PRE' || tagName === 'CODE' || className.includes('ascii-block') || node.querySelector('code')) {
    const codeText = node.innerText || node.textContent || '';
    const rawLines = codeText.trimEnd().split('\n');
    const maxLineLen = Math.max(...rawLines.map(l => l.length), 1);

    // Keep ASCII diagrams and code blocks unwrapped to preserve exact geometry
    const maxAllowedWidth = contentWidth - 8;
    const charWidthPt = (baseFontSize - 1.5) * 0.22;
    let codeFontSize = baseFontSize - 1.5;
    if (maxLineLen * charWidthPt > maxAllowedWidth) {
      codeFontSize = Math.max(5.5, maxAllowedWidth / (maxLineLen * 0.22));
    }

    doc.setFont('FiraCode', 'normal');
    doc.setFontSize(codeFontSize);
    const lineHeight = codeFontSize * 0.44;
    const blockHeight = rawLines.length * lineHeight + 6;

    if (getY() + blockHeight > pageHeight - marginConfig.bottom) addNewPage();

    // Background container
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(marginConfig.left, getY(), contentWidth, blockHeight, 2, 2, 'FD');

    doc.setTextColor(30, 41, 59);
    let lineY = getY() + (lineHeight * 0.9) + 2;
    for (const line of rawLines) {
      doc.text(line, marginConfig.left + 4, lineY);
      lineY += lineHeight;
    }

    setY(getY() + blockHeight + 5);
    doc.setFont(chosenFontKey, 'normal');
    return;
  }

  // 6. Callout Box
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

  // 6b. Neutral Chat Image Placeholder (Option A)
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

  // 7. Lists (UL, OL, LI)
  if (tagName === 'UL' || tagName === 'OL') {
    const items = Array.from(node.querySelectorAll('li'));
    items.forEach((li, idx) => {
      const prefix = tagName === 'OL' ? `${idx + 1}. ` : '• ';
      const itemText = prefix + li.innerText.trim();
      renderTextParagraph(doc, itemText, {
        chosenFontKey,
        baseFontSize,
        primaryInkColor,
        marginConfig: { ...marginConfig, left: marginConfig.left + 4 },
        pageWidth,
        pageHeight,
        contentWidth: contentWidth - 4,
        lineSpacingMultiplier,
        isCursiveMode,
        getY,
        setY,
        addNewPage
      });
    });
    return;
  }

  // 8. Images (IMG)
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

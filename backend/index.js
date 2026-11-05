const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const dotenv = require('dotenv');

// Load environment variables (.env.local from project root takes top priority)
[
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '.env.local'),
  path.resolve(__dirname, '.env')
].forEach(envPath => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
});

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const mammoth = require('mammoth');
const puppeteer = require('puppeteer');
const pdf = require('pdf-parse');

const { initDatabase, query } = require('./src/config/db');
const { optionalAuth, requireAuth } = require('./src/middleware/auth');
const { apiLimiter, authLimiter, aiLimiter, heavyLimiter, validateSsrfUrl } = require('./src/middleware/security');
const { resolveAIClient } = require('./src/services/aiService');
const { checkCanGenerate, recordGeneration } = require('./src/services/usageService');
const sanitizeHtml = require('sanitize-html');

// Routers
const authRoutes = require('./src/routes/auth');
const settingsRoutes = require('./src/routes/settings');
const notesRoutes = require('./src/routes/notes');
const documentsRoutes = require('./src/routes/documents');
const usageRoutes = require('./src/routes/usage');

// Startup Environment Validation: fails fast if required production variables are absent
function validateStartupConfig() {
  if (process.env.NODE_ENV === 'production') {
    // Critical: refuse to start if mock authentication is enabled in production
    if (process.env.ALLOW_MOCK_AUTH === 'true' || process.env.ALLOW_MOCK_AUTH === true) {
      console.error('\n' + '='.repeat(60));
      console.error('❌ [FATAL SECURITY ERROR] Server cannot start: ALLOW_MOCK_AUTH cannot be true in production.');
      console.error('='.repeat(60) + '\n');
      process.exit(1);
    }

    const requiredEnvVars = [
      'DATABASE_URL',
      'JWT_SECRET',
      'ENCRYPTION_KEY',
      'GOOGLE_CLIENT_ID',
      'ALLOWED_ORIGIN'
    ];

    const missing = requiredEnvVars.filter(key => {
      const val = process.env[key];
      return !val || typeof val !== 'string' || val.trim().length === 0;
    });

    if (missing.length > 0) {
      console.error('\n' + '='.repeat(60));
      console.error('❌ [FATAL CONFIG ERROR] Server cannot start in production.');
      console.error('Missing the following required environment variable(s):');
      missing.forEach(v => console.error(`   👉 ${v}`));
      console.error('Please configure these in your Render Dashboard -> Environment Variables.');
      console.error('='.repeat(60) + '\n');
      process.exit(1);
    }
  }
}
validateStartupConfig();

const app = express();
const port = process.env.PORT || 3002;

// Initialize Gemini
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

async function getAIClient(req) {
  return await resolveAIClient(req);
}

function getFileDetails(file) {
  const originalname = file.originalname || '';
  const lowercaseName = originalname.toLowerCase();
  
  const isPdf = file.mimetype === 'application/pdf' || lowercaseName.endsWith('.pdf');
  const isDocx = file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowercaseName.endsWith('.docx');
  const isTxt = file.mimetype === 'text/plain' || lowercaseName.endsWith('.txt');
  const isImage = file.mimetype.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(lowercaseName);
  
  let detectedMime = file.mimetype;
  if (isPdf) detectedMime = 'application/pdf';
  else if (isDocx) detectedMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  else if (isTxt) detectedMime = 'text/plain';
  else if (isImage && (!detectedMime || detectedMime === 'application/octet-stream')) {
    if (lowercaseName.endsWith('.png')) detectedMime = 'image/png';
    else if (lowercaseName.endsWith('.jpg') || lowercaseName.endsWith('.jpeg')) detectedMime = 'image/jpeg';
    else if (lowercaseName.endsWith('.webp')) detectedMime = 'image/webp';
    else detectedMime = 'image/jpeg'; // default fallback for image
  }
  
  return { isPdf, isDocx, isTxt, isImage, mimeType: detectedMime };
}

function getSystemBrowserExecutable() {
  const candidatePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe') : null,
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe') : null
  ];

  for (const p of candidatePaths) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

function cleanAndParseJson(rawText) {
  if (!rawText || !rawText.trim()) throw new Error("Empty response from AI model");
  let text = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

  // 1. Standard parse first
  try {
    return JSON.parse(text);
  } catch (e1) {}

  // 2. Character-by-character control character escaper (escapes raw unescaped newlines/tabs/control chars inside string literals)
  let inString = false;
  let escaped = false;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const code = text.charCodeAt(i);

    if (char === '"' && !escaped) {
      inString = !inString;
      result += char;
    } else if (inString) {
      if (char === '\\') {
        escaped = !escaped;
        result += char;
      } else {
        escaped = false;
        if (char === '\n') result += '\\n';
        else if (char === '\r') result += '\\r';
        else if (char === '\t') result += '\\t';
        else if (code < 32) result += `\\u${code.toString(16).padStart(4, '0')}`;
        else result += char;
      }
    } else {
      escaped = false;
      result += char;
    }
  }

  try {
    return JSON.parse(result);
  } catch (e2) {
    // 3. Fallback Q&A object regex extractor if JSON structure is slightly malformed
    const qaPairs = [];
    const objRegex = /\{\s*"question"\s*:\s*"([\s\S]*?)"\s*,\s*"answer"\s*:\s*"([\s\S]*?)"(?:\s*,\s*"marks"\s*:\s*"([\s\S]*?)")?\s*\}/gi;
    let match;
    while ((match = objRegex.exec(text)) !== null) {
      qaPairs.push({
        question: match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        answer: match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        marks: match[3] || '5'
      });
    }
    if (qaPairs.length > 0) return qaPairs;
    throw new Error(`Invalid AI JSON response format: ${e2.message}`);
  }
}


app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Direct, database-free health endpoints for Render / Netlify cold-start ping (200 OK)
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Production-ready CORS allowing ALLOWED_ORIGIN (fallback to FRONTEND_URL or Netlify domain)
const allowedOrigin = (
  process.env.ALLOWED_ORIGIN ||
  process.env.CLIENT_URL ||
  process.env.FRONTEND_URL ||
  'https://smartnotes-genai.netlify.app'
).replace(/\/$/, '');

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server, curl, and health check pings without origin header
    if (!origin) return callback(null, true);

    // Exact match for the configured production origin
    if (origin === allowedOrigin) {
      return callback(null, true);
    }

    // In non-production development environments, allow localhost
    if (process.env.NODE_ENV !== 'production') {
      const devOrigins = [
        'http://localhost:5173',
        'http://localhost:4173',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:4173'
      ];
      if (devOrigins.includes(origin)) {
        return callback(null, true);
      }
    }

    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(optionalAuth);

// Global API rate limiting
app.use('/api', apiLimiter);

// Simple logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// SaaS Routers
app.use('/api/auth', authRoutes);
app.use('/api/me', (req, res, next) => {
  req.url = '/me' + (req.url === '/' ? '' : req.url);
  authRoutes(req, res, next);
});
app.use('/api/settings', settingsRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/subscription', usageRoutes);
app.get('/api/plans', (req, res) => {
  const { PLANS } = require('./src/config/plans');
  res.json({ success: true, plans: Object.values(PLANS) });
});

// Set up multer for file uploads (in memory for now)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } });

// Endpoint to handle file upload and text extraction
app.post('/api/extract', aiLimiter, upload.single('document'), async (req, res) => {
  console.log(`[Backend] Received extract request for file: ${req.file?.originalname} (${req.file?.mimetype})`);
  
  let tempFilePath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { genAI: reqGenAI, fileManager: reqFileManager, isByok } = await getAIClient(req);
    if (!reqGenAI) {
      return res.status(500).json({ error: 'Gemini API key not configured. Please supply a key in settings or contact the administrator.' });
    }

    if (req.user) {
      await checkCanGenerate(req.user.id, req.user.plan, isByok);
    }

    const systemPrompt = `
      You are a strict text-to-HTML formatting tool. Your task is to extract Q&A content from the provided material WITHOUT CHANGING A SINGLE WORD.
      
      STRICT FIDELITY RULES:
      1. NO REWRITING: Do not paraphrase, summarize, or modify any sentences. 
      2. 100% WORDING: Every word in the output must match the input exactly.
      3. NO ADDITIONS: Do not add your own explanations, introductions, or "notes".
      
      FORMATTING & STRUCTURE (CHATGPT-STYLE ALIGNMENT):
      For the "answer" field, you MUST return a beautifully structured premium educational note using semantic HTML.
      1. STRUCTURE: Use clean HTML tags like <p>, <ul>, <li>, <strong>, <blockquote>, and standard <table>, <th>, <td> (with <thead> and <tbody>) for tables/tabular/grid data. Use <h3> for sub-headings if logical breaks exist.
      2. BOLDING: Wrap the most important technical terms or keywords in <strong>...</strong> tags.
      3. HIGHLIGHTING: Wrap vital definitions or formulas in <mark>...</mark> tags.
      4. DIAGRAMS (CRITICAL): Automatically detect text-based diagrams, ASCII structures, certificate layouts, flowcharts, architectures, hierarchy trees, block/protocol/database diagrams. Convert these into clean, professional Mermaid JS diagrams. Wrap them exactly in <div class="mermaid">...</div>. Use modern educational styling for diagrams (clean boxes, aligned components). DO NOT output the original text-based diagram. Example: <div class="mermaid">graph TD;\nA-->B;</div>
      5. Q&A: Identify the Questions and Answers clearly.
      6. MARKS: Extract marks if present (e.g. "[10]").
      7. MATH/FORMULAS: Identify and format mathematical equations (powers, fractions, roots, matrices, subscripts). ALWAYS use $$ ... $$ for block equations and $ ... $ for inline math. NEVER use \\[ \\] or \\( \\) or raw brackets [ ].
      8. CODE BLOCKS: Automatically detect programming code sections, snippets, scripts, or syntax. Wrap all code blocks exactly in <pre><code class="language-[lang]">[code]</code></pre> tags. Replace [lang] with the actual language (e.g., html, jsp, java, sql, javascript, xml, css, python). Keep formatting and indentation exactly as in the source. Do NOT modify the code content.
      9. TABLES & MATRICES: Automatically detect comparative data, truth tables, matrices, and grids (such as confusion matrices). Convert them into beautifully formatted semantic HTML <table> structures with clear headers (<thead>, <tbody>, <th>, <td>). DO NOT output tabular data as plain inline text.
      
      OUTPUT: Return ONLY a JSON array of objects: [{ "question": "...", "answer": "...", "marks": "..." }]
      CRITICAL JSON ESCAPING: Ensure all HTML strings and multiline text in the JSON values use properly escaped newlines (\\n) and quotes (\\"). Do NOT include raw unescaped control characters or unescaped literal line breaks inside string values.
    `;

    const fileDetails = getFileDetails(req.file);
    let promptParts = [];
    let uploadedFile = null;

    if (fileDetails.isPdf || fileDetails.isImage) {
      const safeName = `upload_${Date.now()}${path.extname(req.file.originalname)}`;
      tempFilePath = path.join(os.tmpdir(), safeName);
      fs.writeFileSync(tempFilePath, req.file.buffer);
      
      const uploadResult = await reqFileManager.uploadFile(tempFilePath, {
        mimeType: fileDetails.mimeType,
        displayName: req.file.originalname,
      });
      
      // Clean up local temp file immediately after upload
      try {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        tempFilePath = null;
      } catch (err) {
        console.warn("[Backend] Failed to delete temp file:", err.message);
      }
      
      // Wait for the file to be processed (ACTIVE)
      let file = await reqFileManager.getFile(uploadResult.file.name);
      let attempts = 0;
      while (file.state === 'PROCESSING' && attempts < 30) {
        console.log(`[Backend] File processing, attempt ${attempts + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        file = await reqFileManager.getFile(uploadResult.file.name);
        attempts++;
      }
      
      if (file.state === 'FAILED') {
        throw new Error('Gemini failed to process the uploaded file.');
      }
      
      uploadedFile = file;
      
      promptParts = [
        {
          fileData: {
            mimeType: uploadedFile.mimeType,
            fileUri: uploadedFile.uri
          }
        },
        systemPrompt
      ];
    } else if (fileDetails.isDocx) {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      promptParts = [`CONTENT FROM DOCX FILE:\n${result.value}\n\n${systemPrompt}`];
    } else if (fileDetails.isTxt) {
      const text = req.file.buffer.toString('utf8');
      promptParts = [`CONTENT FROM TEXT FILE:\n${text}\n\n${systemPrompt}`];
    } else {
      return res.status(400).json({ error: `Unsupported file type: ${req.file.mimetype}` });
    }

    const preferredModel = req.headers['x-gemini-model'];
    const modelsToTry = [];
    if (preferredModel && preferredModel.trim()) {
      modelsToTry.push(preferredModel.trim());
    }
    const defaultModels = [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.1-flash-lite"
    ];
    for (const model of defaultModels) {
      if (!modelsToTry.includes(model)) {
        modelsToTry.push(model);
      }
    }

    let lastError = null;
    for (const modelName of modelsToTry) {
      try {
        const model = reqGenAI.getGenerativeModel({
          model: modelName,
          generationConfig: { responseMimeType: "application/json" }
        });
        const result = await model.generateContent(promptParts, { timeout: 300000 });
        const response = await result.response;
        let text = response.text().trim();
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const qaPairs = cleanAndParseJson(text);
        if (req.user) {
          recordGeneration(req.user.id, { model: modelName, generationType: 'qa', isByok }).catch(e => console.warn(e));
        }
        return res.json({ success: true, qaList: qaPairs });
      } catch (error) {
        console.error(`Model ${modelName} failed:`, error.message);
        lastError = error;
      }
    }
    throw new Error(lastError?.message || "AI failed");
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        console.warn("[Backend] Failed to delete temp file in finally:", err.message);
      }
    }
  }
});

// Endpoint to handle file upload and raw text extraction for Summarizer
app.post('/api/extract-text', aiLimiter, upload.single('document'), async (req, res) => {
  console.log(`[Backend] Received extract-text request for file: ${req.file?.originalname} (${req.file?.mimetype})`);
  
  let tempFilePath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileDetails = getFileDetails(req.file);

    // High-fidelity local PDF text extraction (does not require Gemini API key!)
    if (fileDetails.isPdf) {
      console.log(`[Backend] Local PDF text extraction using pdf-parse for: ${req.file.originalname}`);
      try {
        const data = await pdf(req.file.buffer);
        const text = data.text.trim();
        if (text) {
          console.log(`[Backend] Local extraction succeeded! Length: ${text.length} chars`);
          return res.json({ success: true, text });
        }
        console.warn(`[Backend] pdf-parse returned empty text, falling back to Gemini OCR.`);
      } catch (pdfError) {
        console.error('[Backend] Local pdf-parse failed, falling back to Gemini:', pdfError.message);
      }
    }

    if (fileDetails.isTxt) {
      const text = req.file.buffer.toString('utf8').trim();
      if (text) {
        return res.json({ success: true, text });
      }
    }

    if (fileDetails.isDocx) {
      try {
        const mammothResult = await mammoth.extractRawText({ buffer: req.file.buffer });
        const text = (mammothResult.value || '').trim();
        if (text) {
          return res.json({ success: true, text });
        }
      } catch (docErr) {
        console.warn('[Backend] mammoth extraction failed:', docErr.message);
      }
    }

    const { genAI: reqGenAI, fileManager: reqFileManager } = await getAIClient(req);
    if (!reqGenAI) {
      return res.status(500).json({ error: 'Gemini API key not configured.' });
    }

    const systemPrompt = `
      You are a document text extraction assistant. Your task is to extract the complete raw text, contents, lecture notes, or textbook chapter details from the provided document.
      Ensure you preserve the hierarchy, headings, and details. Output only the extracted plain text. Do not output JSON or HTML.
    `;

    let promptParts = [];
    let uploadedFile = null;

    if (fileDetails.isPdf || fileDetails.isImage) {
      const safeName = `upload_txt_${Date.now()}${path.extname(req.file.originalname)}`;
      tempFilePath = path.join(os.tmpdir(), safeName);
      fs.writeFileSync(tempFilePath, req.file.buffer);
      
      const uploadResult = await reqFileManager.uploadFile(tempFilePath, {
        mimeType: fileDetails.mimeType,
        displayName: req.file.originalname,
      });
      
      // Clean up local temp file immediately after upload
      try {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        tempFilePath = null;
      } catch (err) {
        console.warn("[Backend] Failed to delete temp file:", err.message);
      }
      
      // Wait for the file to be processed (ACTIVE)
      let file = await reqFileManager.getFile(uploadResult.file.name);
      let attempts = 0;
      while (file.state === 'PROCESSING' && attempts < 30) {
        console.log(`[Backend] File processing, attempt ${attempts + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        file = await reqFileManager.getFile(uploadResult.file.name);
        attempts++;
      }
      
      if (file.state === 'FAILED') {
        throw new Error('Gemini failed to process the uploaded file.');
      }
      
      uploadedFile = file;
      
      promptParts = [
        {
          fileData: {
            mimeType: uploadedFile.mimeType,
            fileUri: uploadedFile.uri
          }
        },
        systemPrompt
      ];
    } else if (fileDetails.isDocx) {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      promptParts = [`CONTENT FROM DOCX FILE:\n${result.value}\n\n${systemPrompt}`];
    } else if (fileDetails.isTxt) {
      const text = req.file.buffer.toString('utf8');
      promptParts = [`CONTENT FROM TEXT FILE:\n${text}\n\n${systemPrompt}`];
    } else {
      return res.status(400).json({ error: `Unsupported file type: ${req.file.mimetype}` });
    }

    const preferredModel = req.headers['x-gemini-model'];
    const modelsToTry = [];
    if (preferredModel && preferredModel.trim()) {
      modelsToTry.push(preferredModel.trim());
    }
    const defaultModels = [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.1-flash-lite"
    ];
    for (const model of defaultModels) {
      if (!modelsToTry.includes(model)) {
        modelsToTry.push(model);
      }
    }

    let lastError = null;
    for (const modelName of modelsToTry) {
      try {
        const model = reqGenAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(promptParts, { timeout: 300000 });
        const response = await result.response;
        const text = response.text().trim();
        return res.json({ success: true, text });
      } catch (error) {
        console.error(`Model ${modelName} failed text extraction:`, error.message);
        lastError = error;
      }
    }
    throw new Error(lastError?.message || "AI failed to extract text");
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        console.warn("[Backend] Failed to delete temp file in finally:", err.message);
      }
    }
  }
});

// Endpoint to handle AI formatting
app.post('/api/format-ai', aiLimiter, async (req, res) => {
  const { text, isHandwritten } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const { genAI: reqGenAI } = await getAIClient(req);
  if (!reqGenAI) return res.json({ html: `<p>${text}</p>` });

  const preferredModel = req.headers['x-gemini-model'];
  const modelsToTry = [];
  if (preferredModel && preferredModel.trim()) {
    modelsToTry.push(preferredModel.trim());
  }
  const defaultModels = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.1-flash-lite"
  ];
  for (const model of defaultModels) {
    if (!modelsToTry.includes(model)) {
      modelsToTry.push(model);
    }
  }

  try {
    for (const modelName of modelsToTry) {
      try {
        const model = reqGenAI.getGenerativeModel({ model: modelName });
        const prompt = `
          You are a Professional Academic Note Formatter. Transform the text into a beautifully structured premium educational note using semantic HTML and LaTeX for mathematics.
          
          ${isHandwritten ? `HANDWRITTEN MODE ACTIVE (STRICT REFERENCE):
          - QUESTION: Start with "Q[number]." (e.g., <h2 class="qa-question">Q1. ...</h2>).
          - SECTION TITLES: Use <h2> and <h3> headings.
          - BODY TEXT: Use paragraphs and clean semantic tags.
          - EMPHASIS: Use <strong> text.
          - HIGHLIGHTS: Use <mark> for highlights.
          - BULLETS: Use standard <ul> and <li>.
          - DO NOT output any <style> tags or inline 'style' attributes. The frontend CSS automatically handles the custom handwriting fonts, blue ink color, red question color, margins, and bullet styles!` : `MODERN MODE:
          - Use a clean, professional academic layout similar to ChatGPT.
          - Use <h1> for main titles and <h2> for section headers.
          - Use <blockquote> for key definitions or theorems.`}

          STRICT MATHEMATICAL FORMATTING (LATEX):
          1. ADVANCED MATH: Identify and properly format:
             - Powers & Roots: $x^2$, $\\sqrt{x}$, $\\sqrt[n]{x}$
             - Fractions: $\\frac{a}{b}$
             - Subscripts: $a_{n}$
             - Advanced Operators: $\\sum$ (summation), $\\int$ (integral), $\\lim$ (limit), $\\log$, $\\ln$
             - Vectors & Matrices: Use appropriate LaTeX environments.
             - Greek Symbols: $\\lambda, \\alpha, \\beta, \\gamma, \\Delta, \\theta, \\pi, \\Omega$, etc.
          2. DELIMITERS (CRITICAL FIX FOR CHATGPT FORMATS): 
             - You MUST convert ALL existing math delimiters like \\\\[ ... \\\\], \\\\( ... \\\\), [ ... ], or ( ... ) into the standard $$ ... $$ for block and $ ... $ for inline math.
             - If you see an equation wrapped in [ ] like [ \\text{MAX}(n)=\\max(s) ], you MUST change it to $$ \\text{MAX}(n)=\\max(s) $$.
             - NEVER output \\\\[ or \\\\( or [ ] for equations. ALWAYS use $$ and $.
          
          EDUCATIONAL STRUCTURE:
          Arrange the content into logical sections:
          - Heading (Brief Title)
          - Definition/Concept (Explanation in paragraphs)
          - Diagrams/Visuals: Detect text-based diagrams, ASCII structures, certificate layouts, flowcharts, architectures, hierarchy trees, block/protocol/database diagrams. Convert them into Mermaid JS diagrams! Wrap exactly in <div class="mermaid">...</div>. Use beautiful, balanced, professional exam-style layouts. DO NOT KEEP ASCII DIAGRAMS.
          - Code Blocks: Detect programming code sections, snippets, scripts, or syntax in languages like HTML, JSP, Java, SQL, JavaScript, XML, CSS, Python. Wrap them exactly in <pre><code class="language-[lang]">[code]</code></pre> tags. Replace [lang] with the actual language (e.g., html, jsp, java, sql, javascript, xml, css, python). Preserve all whitespace, indentation, structure, and code content exactly. Do NOT translate or alter the code!
          - Tables/Matrices: Detect comparative data, grids, truth tables, and matrices (e.g. confusion matrices). Convert them into standard semantic HTML tables with clear headers (<thead>, <tbody>, <th>, <td>). Never format tables or grids as plain unstructured text. Keep all numbers and labels exactly as provided.
          - Formula/Equation (Centered using display math)
          - Steps/Derivation (Numbered or bulleted list)
          - Important Note (Using <blockquote> or <strong>)
          - Conclusion
          
          STRICT WORD FIDELITY:
          - DO NOT CHANGE A SINGLE WORD of the original text content.
          - Keep the input text exactly as provided, only adding HTML and LaTeX formatting.
          
          STYLE GUIDELINES:
          1. STRUCTURE: Use <h1> for main title, <h2> for sections.
          2. FORMATTING: Use <ul>/<li> for lists, <strong> for emphasis.
          3. NUMBERING: Detect and fix sequences (1, 2, 4 -> 1, 2, 3).
          
          Input Text: ${text}
        `;

        const result = await model.generateContent(prompt, { timeout: 25000 });
        const response = await result.response;
        let html = response.text().trim();
        html = html.replace(/```html/gi, '').replace(/```/g, '').trim();
        
        // Post-processing fix to ensure ChatGPT's \[ \] and Gemini's broken [ \text... ] are converted to $$
        html = html.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$'); // \[ \] to $$ $$
        html = html.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$'); // \( \) to $ $
        
        // Aggressively fix broken brackets that contain math commands
        html = html.replace(/\[\s*(\\(?:text|max|min|frac|sum|int|alpha|beta|gamma|lambda|Delta)[^\]]*?)\]/g, '$$$$ $1 $$$$');
        html = html.replace(/\(\s*(\\(?:text|max|min|frac|sum|int|alpha|beta|gamma|lambda|Delta)[^\)]*?)\)/g, '$$ $1 $$');
        
        return res.json({ html });
      } catch (error) {
        console.error(`Model ${modelName} failed:`, error.message);
      }
    }
    res.json({ html: `<p>${text}</p>` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to scrape and import content from a public link
app.post('/api/import-link', aiLimiter, heavyLimiter, async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  try {
    await validateSsrfUrl(url);
  } catch (err) {
    return res.status(400).json({ error: `Security check: ${err.message}` });
  }

  let reqGenAI = null;
  try {
    const aiClient = await getAIClient(req);
    reqGenAI = aiClient?.genAI || null;
  } catch (e) {
    reqGenAI = null;
  }

  let browser = null;
  let contentText = '';
  let isPdf = false;

  try {
    // Check if the URL resolves directly to a PDF
    try {
      const headRes = await fetch(url, { method: 'HEAD', timeout: 5000 });
      const hContentType = headRes.headers.get('content-type') || '';
      if (hContentType.toLowerCase().includes('application/pdf')) {
        isPdf = true;
      }
    } catch (e) {
      console.warn('[Backend] HEAD request failed, falling back to path check:', e.message);
    }

    if (!isPdf && url.toLowerCase().split('?')[0].endsWith('.pdf')) {
      isPdf = true;
    }

    if (isPdf) {
      console.log(`[Backend] Direct PDF URL detected: ${url}`);
      const pdfRes = await fetch(url);
      if (!pdfRes.ok) {
        throw new Error(`Failed to download PDF from link. Status: ${pdfRes.status}`);
      }
      const buffer = await pdfRes.arrayBuffer();
      const pdfData = await pdf(Buffer.from(buffer));
      contentText = pdfData.text.trim();
      if (!contentText) {
        throw new Error('PDF contains no extractable text content.');
      }
    } else if (url.toLowerCase().split('?')[0].endsWith('.txt') || url.toLowerCase().split('?')[0].endsWith('.md')) {
      console.log(`[Backend] Text/Markdown URL detected: ${url}`);
      const txtRes = await fetch(url);
      if (!txtRes.ok) {
        throw new Error(`Failed to download text/markdown file. Status: ${txtRes.status}`);
      }
      contentText = await txtRes.text();
    } else {
      console.log(`[Backend] Webpage URL detected, extracting content from: ${url}`);
      const uniqueUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-import-'));
      let puppeteerSucceeded = false;

      try {
        const systemBrowser = getSystemBrowserExecutable();
        const launchOptions = {
          headless: true,
          userDataDir: uniqueUserDataDir,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        };
        if (systemBrowser) {
          launchOptions.executablePath = systemBrowser;
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
        
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        
        // Handle known dynamic sites
        if (url.includes('chatgpt.com/share') || url.includes('chat.openai.com/share')) {
          await page.waitForSelector('.flex.flex-col.items-start', { timeout: 10000 }).catch(() => {});
        } else if (url.includes('docs.google.com')) {
          await page.waitForSelector('.kix-page-content-wrapper, body', { timeout: 15000 }).catch(() => {});
        } else if (url.includes('notion.so') || url.includes('notion.site')) {
          await page.waitForSelector('.notion-page-content, body', { timeout: 15000 }).catch(() => {});
        }

        // Extract cleaned text and HTML
        contentText = await page.evaluate(() => {
          const removals = document.querySelectorAll('script, style, iframe, nav, header, footer, noscript, svg');
          removals.forEach(el => el.remove());
          const mainContent = document.querySelector('article') || document.querySelector('main') || document.body;
          return mainContent ? (mainContent.innerText || mainContent.innerHTML) : '';
        });

        await browser.close();
        browser = null;
        puppeteerSucceeded = !!(contentText && contentText.trim().length > 0);
      } catch (browserErr) {
        console.warn(`[Backend] Puppeteer launch/extract failed (${browserErr.message}). Falling back to HTTP fetch extraction.`);
      } finally {
        if (browser) {
          try { await browser.close(); } catch (e) {}
          browser = null;
        }
        if (uniqueUserDataDir && fs.existsSync(uniqueUserDataDir)) {
          try { fs.rmSync(uniqueUserDataDir, { recursive: true, force: true }); } catch (e) {}
        }
      }

      // If Puppeteer could not run or extracted empty text, fallback to standard fetch
      if (!puppeteerSucceeded) {
        console.log(`[Backend] Using resilient HTTP fetch for link: ${url}`);
        const pageRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        if (!pageRes.ok) {
          throw new Error(`Failed to load URL content (HTTP ${pageRes.status}: ${pageRes.statusText})`);
        }
        const rawHtml = await pageRes.text();
        contentText = rawHtml
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
          .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
          .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
          .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    if (!contentText || contentText.trim().length === 0) {
      throw new Error('Unable to extract readable content from the provided URL.');
    }

    // In BYOK architecture, if backend has no Gemini API key, return the scraped text
    // so the client can format it directly using the user's browser-stored Gemini key.
    if (!reqGenAI) {
      console.log(`[Backend] Extracted ${contentText.length} chars. No server Gemini key; returning text for client-side BYOK formatting.`);
      return res.json({ success: true, text: contentText });
    }

    console.log(`[Backend] Extracted ${contentText.length} chars. Passing to Gemini AI...`);

    const preferredModel = req.headers['x-gemini-model'];
    const modelsToTry = [];
    if (preferredModel && preferredModel.trim()) {
      modelsToTry.push(preferredModel.trim());
    }
    const defaultModels = [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.1-flash-lite"
    ];
    for (const model of defaultModels) {
      if (!modelsToTry.includes(model)) {
        modelsToTry.push(model);
      }
    }

    const systemPrompt = `
      You are an expert academic text-to-HTML formatting tool. Your task is to extract content from the provided source page and convert it into a beautifully structured, premium educational Q&A notes format.

      STRICT FORMAT RULES:
      1. Extract all relevant educational information, definitions, code blocks, lists, equations, and tables. Strip navigation menus, advertisements, and header/footer elements.
      2. Group content logically into separate Question and Answer elements. For example, make a question "Describe the main structure of [topic]?" or "What is the function of [concept]?" followed by a detailed structured answer.
      3. Automatically estimate logical exam-style "marks" (e.g. 2, 5, 10) for each question block.

      TAG PRESERVATION RULES:
      Inside the HTML "answer" field, you must preserve and format:
      - Headings: Use <h2> and <h3> headings.
      - Emphasis: Use <strong> and <mark> for terms.
      - Lists: Use <ul> and <li> for lists.
      - Code Blocks: Wrap programming code in <pre><code class="language-[lang]">[code]</code></pre> tags. Replace [lang] with the actual language (e.g. sql, python, javascript).
      - Tables: Convert grids, truth tables, or data matrixes into clean <table>, <th>, and <td> structures.
      - Images: Preserve images. Keep <img> tags exactly as they appear in the source HTML, retaining their absolute URLs.
      - Hyperlinks: Keep <a href="...">...</a> tags, preserving the absolute URL.
      - Diagrams: Auto-detect flowcharts or text diagrams and output them inside <div class="mermaid">...</div> blocks using Mermaid syntax.
      - Math: Use $$ ... $$ for display math and $ ... $ for inline math.

      OUTPUT FORMAT:
      Return ONLY a JSON array of objects: [{ "question": "...", "answer": "...", "marks": "..." }]
      Ensure you output only raw JSON. Do not wrap in markdown tags like \`\`\`json.
    `;

    let lastError = null;
    for (const modelName of modelsToTry) {
      try {
        console.log(`[Backend] Scraping import using Gemini model: ${modelName}`);
        const model = reqGenAI.getGenerativeModel({
          model: modelName,
          generationConfig: { responseMimeType: "application/json" }
        });
        const result = await model.generateContent([
          `SOURCE LINK URL: ${url}\n\nCONTENT EXTRACTED:\n${contentText.substring(0, 150000)}`,
          systemPrompt
        ], { timeout: 300000 });
        const response = await result.response;
        let text = response.text().trim();
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const qaPairs = cleanAndParseJson(text);
        
        console.log(`[Backend] Scraped content converted to ${qaPairs.length} questions successfully.`);
        return res.json({ success: true, qaList: qaPairs });
      } catch (err) {
        console.warn(`[Backend] Model ${modelName} failed link import processing:`, err.message);
        lastError = err;
      }
    }
    throw new Error(lastError?.message || "AI model execution failed.");
  } catch (error) {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    console.error(`[Backend] Extraction failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to test Gemini API connection
app.post('/api/test-connection', async (req, res) => {
  console.log(`[Backend] Received test connection request`);
  try {
    const { genAI: reqGenAI } = await getAIClient(req);
    if (!reqGenAI) {
      return res.status(400).json({ success: false, error: 'No API key provided.' });
    }

    const preferredModel = req.headers['x-gemini-model'] || 'gemini-3.1-flash-lite';
    const model = reqGenAI.getGenerativeModel({ model: preferredModel });
    
    // Quick, low-latency test generation
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Respond with exactly the word "OK" and nothing else.' }] }],
      generationConfig: { maxOutputTokens: 5 }
    });
    
    const response = await result.response;
    const text = response.text().trim();
    
    return res.json({ success: true, message: `Successfully connected to ${preferredModel}! AI response: "${text}"` });
  } catch (error) {
    console.error(`[Backend] Connection test failed:`, error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Pre-cache local server fonts as base64 data URIs for self-contained, offline-safe PDF rendering
const fontAssetsDir = path.join(__dirname, 'assets', 'fonts');
let cachedFontFaceCss = '';
try {
  const fontDefinitions = [
    { family: 'Caveat', weight: '400', style: 'normal', file: 'Caveat-Regular.woff2' },
    { family: 'Caveat', weight: '700', style: 'normal', file: 'Caveat-Bold.woff2' },
    { family: 'Kalam', weight: '400', style: 'normal', file: 'Kalam-Regular.woff2' },
    { family: 'Kalam', weight: '700', style: 'normal', file: 'Kalam-Bold.woff2' },
    { family: 'Inter', weight: '400', style: 'normal', file: 'Inter-Regular.woff2' },
    { family: 'Inter', weight: '700', style: 'normal', file: 'Inter-Bold.woff2' }
  ];
  cachedFontFaceCss = fontDefinitions.map(f => {
    const fontPath = path.join(fontAssetsDir, f.file);
    if (fs.existsSync(fontPath)) {
      const b64 = fs.readFileSync(fontPath).toString('base64');
      return `@font-face { font-family: '${f.family}'; font-style: ${f.style}; font-weight: ${f.weight}; font-display: swap; src: url(data:font/woff2;base64,${b64}) format('woff2'); }`;
    }
    return '';
  }).filter(Boolean).join('\n');
} catch (fontErr) {
  console.warn('[Backend] Could not load cached font files:', fontErr.message);
}

// Single-concurrency lock to protect 512MB RAM environment on Render
let isPdfExportInProgress = false;

// Endpoint to generate PDF using Puppeteer with hardened concurrency, security, and timeout
app.post('/api/generate-pdf', requireAuth, heavyLimiter, async (req, res) => {
  const { 
    html, 
    filename, 
    noteId,
    isHandwrittenMode,
    theme = 'default',
    fontFamily = 'Inter',
    fontSize = '14px',
    lineSpacing = '1.6',
    margins = 'normal',
    headerText = '',
    footerText = '',
    watermarkText = '',
    logoUrl = '',
    includePageNumbers = true,
    metadata = {},
    imageQuality = 'high',
    compression = 'none'
  } = req.body;

  if (!html) return res.status(400).json({ error: 'No HTML content provided' });

  // Authorization: users may only export notes that belong to them
  if (noteId) {
    try {
      const noteCheck = await query('SELECT id FROM notes WHERE id = $1 AND user_id = $2', [noteId, req.user.id]);
      if (noteCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Forbidden: You can only export your own notes.' });
      }
    } catch (dbErr) {
      console.error('[Backend] Note ownership verification failed:', dbErr.message);
      return res.status(500).json({ error: 'Database check failed' });
    }
  }

  // Enforce single concurrency to protect 512 MB memory limit
  if (isPdfExportInProgress) {
    return res.status(429).json({ error: 'Another PDF export is in progress. Please wait a few seconds and try again.' });
  }
  isPdfExportInProgress = true;

  const marginMap = {
    narrow: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
    normal: { top: '25mm', right: '20mm', bottom: '25mm', left: '20mm' },
    wide: { top: '35mm', right: '30mm', bottom: '35mm', left: '30mm' }
  };

  let browser = null;
  let uniqueUserDataDir = null;
  try {
    uniqueUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-pdf-'));
    try {
      const systemBrowser = getSystemBrowserExecutable();
      const launchOptions = {
        headless: true,
        userDataDir: uniqueUserDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-zygote',
          '--single-process',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--safebrowsing-disable-auto-update'
        ]
      };
      if (systemBrowser) {
        launchOptions.executablePath = systemBrowser;
      }
      browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      
      // Security: Disable in-page JavaScript execution
      await page.setJavaScriptEnabled(false);

      // Security: Intercept requests to block file://, SSRF, and external network calls
      await page.setRequestInterception(true);
      page.on('request', (interceptedReq) => {
        const url = interceptedReq.url();
        const resType = interceptedReq.resourceType();
        if (url.startsWith('file:') || (!url.startsWith('http:') && !url.startsWith('https:') && !url.startsWith('data:'))) {
          return interceptedReq.abort();
        }
        const lowerUrl = url.toLowerCase();
        if (
          lowerUrl.includes('localhost') ||
          lowerUrl.includes('127.0.0.1') ||
          lowerUrl.includes('169.254.169.254') ||
          lowerUrl.includes('0.0.0.0') ||
          lowerUrl.includes('[::1]')
        ) {
          return interceptedReq.abort();
        }
        if (resType === 'image' || resType === 'font') {
          return interceptedReq.continue();
        }
        return interceptedReq.abort();
      });

      // HTML Sanitization: remove dangerous tags, event handlers, and scripts
      const cleanHtml = sanitizeHtml(html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'hr', 'mark', 'code', 'pre', 'svg', 'path', 'g', 'rect', 'circle', 'line', 'polyline', 'polygon',
          'text', 'tspan', 'defs', 'clippath'
        ]),
        allowedAttributes: {
          '*': ['class', 'style', 'id', 'width', 'height', 'align', 'aria-hidden'],
          'a': ['href', 'name', 'target'],
          'img': ['src', 'alt', 'width', 'height'],
          'svg': ['viewBox', 'width', 'height', 'fill', 'stroke', 'xmlns', 'version', 'preserveAspectRatio'],
          'path': ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
          'g': ['fill', 'stroke', 'transform', 'class'],
          'rect': ['x', 'y', 'width', 'height', 'fill', 'stroke', 'rx', 'ry'],
          'circle': ['cx', 'cy', 'r', 'fill', 'stroke'],
          'line': ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'],
          'polyline': ['points', 'stroke', 'fill'],
          'polygon': ['points', 'stroke', 'fill'],
          'text': ['x', 'y', 'fill', 'font-size', 'font-family', 'text-anchor']
        },
        allowedSchemes: ['http', 'https', 'data'],
        disallowedTagsMode: 'discard'
      });

      const safeWatermark = watermarkText ? sanitizeHtml(watermarkText, { allowedTags: [], allowedAttributes: {} }) : '';
      const safeLogoUrl = (logoUrl && typeof logoUrl === 'string' && (logoUrl.startsWith('http://') || logoUrl.startsWith('https://') || logoUrl.startsWith('data:image/'))) ? logoUrl : '';

      // Determine font family styling
      let fontStyle = '';
      if (fontFamily === 'Inter' || fontFamily === 'Roboto' || fontFamily === 'Outfit') {
        fontStyle = `font-family: '${fontFamily}', sans-serif;`;
      } else if (fontFamily === 'Kalam' || fontFamily === 'Caveat') {
        fontStyle = `font-family: '${fontFamily}', cursive;`;
      } else if (fontFamily === 'Lora' || fontFamily === 'Playfair Display') {
        fontStyle = `font-family: '${fontFamily}', serif;`;
      } else if (fontFamily === 'Fira Code' || fontFamily === 'Courier New') {
        fontStyle = `font-family: '${fontFamily}', monospace;`;
      } else {
        fontStyle = `font-family: 'Inter', sans-serif;`;
      }

      // Determine font size
      let fontScale = '1rem';
      if (fontSize === '12px') fontScale = '0.85rem';
      else if (fontSize === '16px') fontScale = '1.15rem';
      else if (fontSize === '18px') fontScale = '1.3rem';

      // Theme rules CSS definition
      let themeStyles = '';
      if (theme === 'academic') {
        themeStyles = `
          body { background: #fff !important; color: #000 !important; font-family: 'Lora', Georgia, serif !important; }
          .notebook-page { padding: 20mm 20mm !important; }
          .qa-header { border-bottom: 2px double #334155; padding-bottom: 0.5rem; margin-bottom: 1rem; }
          .qa-question { font-family: 'Playfair Display', serif !important; font-size: 1.4rem !important; color: #000 !important; font-weight: bold !important; }
          .qa-marks { font-family: 'Lora', Georgia, serif !important; color: #334155 !important; font-size: 0.95rem !important; }
        `;
      } else if (theme === 'minimal') {
        themeStyles = `
          body { background: #fff !important; color: #111 !important; font-family: 'Inter', sans-serif !important; }
          .notebook-page { padding: 15mm 15mm !important; }
          .qa-header { border: none !important; margin-bottom: 0.75rem; }
          .qa-question { font-size: 1.3rem !important; font-weight: 600 !important; color: #111 !important; }
          .qa-marks { color: #666 !important; font-size: 0.85rem !important; }
          table, pre { border: 1px solid #e2e8f0 !important; box-shadow: none !important; }
        `;
      } else if (theme === 'modern') {
        themeStyles = `
          body { background: #fff !important; color: #0f172a !important; font-family: 'Outfit', sans-serif !important; }
          .notebook-page { padding: 20mm 20mm !important; }
          .qa-header { border-bottom: 1px solid #cbd5e1; padding-bottom: 0.5rem; margin-bottom: 1.25rem; }
          .qa-question { font-family: 'Outfit', sans-serif !important; font-size: 1.5rem !important; color: #0f172a !important; font-weight: 700 !important; }
          .qa-marks { color: #4f46e5 !important; font-size: 1rem !important; }
        `;
      } else if (theme === 'dark') {
        themeStyles = `
          body { background: #0f172a !important; color: #f8fafc !important; }
          .notebook-page { background: #0f172a !important; color: #f8fafc !important; padding: 20mm 20mm !important; }
          .qa-header { border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }
          .qa-question { color: #f8fafc !important; }
          .qa-marks { color: #818cf8 !important; }
          table { border: 1px solid #334155 !important; }
          td { background: #1e293b !important; color: #f1f5f9 !important; border-bottom: 1px solid #334155 !important; }
          th { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%) !important; }
          pre { background: #1e293b !important; border: 1px solid #334155 !important; color: #f8fafc !important; }
          code { color: #f8fafc !important; }
          .callout-box { background: #1e293b !important; border: 1px solid #334155 !important; color: #f1f5f9 !important; }
          .mermaid { background: #1e293b !important; border: 1px solid #334155 !important; }
          .mermaid svg { filter: invert(0.9) hue-rotate(180deg); }
        `;
      }

      const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            ${cachedFontFaceCss}

            body { 
              margin: 0; 
              padding: 0; 
              background: #fff; 
              ${fontStyle} 
              font-size: ${fontScale};
              line-height: ${lineSpacing};
            }
            
            /* Under handwritten mode, ruled paper styles apply. */
            .pdf-mock-page.handwritten-mode-active .notebook-page {
              font-family: 'Kalam', cursive;
              font-size: 1.1rem;
              line-height: 9mm;
              color: #0047ab; /* ink-blue */
              background-image: linear-gradient(#e2e8f0 1px, transparent 1px);
              background-size: 100% 9mm;
              background-position: 0 9mm;
              padding: 18mm 15mm 18mm 30mm;
            }
            .pdf-mock-page.handwritten-mode-active .notebook-page::before {
              content: '';
              position: absolute;
              top: 0;
              bottom: 0;
              left: 20mm;
              width: 2px;
              background-color: #ff6b6b;
              z-index: 10;
            }
            
            /* Modern mode styles for pdf-mock-page */
            .pdf-mock-page:not(.handwritten-mode-active) .notebook-page {
              font-family: inherit;
              font-size: inherit;
              line-height: inherit;
              color: inherit;
              background: white;
              padding: 20mm 20mm 20mm 20mm;
            }
            
            .pdf-mock-page:not(.handwritten-mode-active) .notebook-page::before {
              display: none !important;
            }

            /* General classes shared by both modes */
            .notebook-page {
              width: 100%;
              min-height: 297mm;
              position: relative;
              box-sizing: border-box;
              word-wrap: break-word;
              overflow-wrap: break-word;
            }

            /* General typography adjustments for handwritten mode */
            .handwritten-mode-active p,
            .handwritten-mode-active ul,
            .handwritten-mode-active ol,
            .handwritten-mode-active li,
            .handwritten-mode-active h1,
            .handwritten-mode-active h2,
            .handwritten-mode-active h3,
            .handwritten-mode-active h4,
            .handwritten-mode-active h5,
            .handwritten-mode-active h6 {
              margin: 0;
              padding: 0;
              line-height: 9mm;
              background: transparent;
            }

            /* Question / Marks Styling */
            .qa-question {
              margin: 0 0 0.5rem 0;
              font-size: 1.6rem;
              font-weight: 800;
              color: #0f172a;
              line-height: 1.3;
            }
            .qa-marks {
              font-weight: 700;
              color: #6366f1;
              font-size: 1.1rem;
            }
            .qa-header {
              display: flex;
              justify-content: space-between;
              align-items: baseline;
              margin-bottom: 1rem;
              page-break-after: avoid !important;
              break-after: avoid !important;
            }

            /* Cursive Overrides for Questions & Marks */
            .handwritten-mode-active .qa-question {
              color: #e11d48 !important;
              font-family: 'Caveat', cursive !important;
              font-size: 2.4rem !important;
              line-height: 9mm !important;
              margin: 0 !important;
            }
            .handwritten-mode-active .qa-marks {
              color: #0047ab !important;
              font-family: 'Caveat', cursive !important;
              font-size: 1.6rem !important;
              font-weight: bold !important;
            }
            
            /* Modern Headers */
            h1.page-title {
              font-size: 2.5rem;
              font-weight: 800;
              color: #0f172a;
              text-align: center;
              margin: 0 0 1.5rem 0;
            }
            .handwritten-mode-active h1.page-title {
              font-family: 'Caveat', cursive !important;
              font-size: 3rem !important;
              line-height: 18mm !important;
              padding-top: 9mm !important;
              color: #0047ab !important;
              margin: 0 !important;
            }

            /* General rules for other headings */
            h2, h3 {
              color: #1e293b;
              margin: 1.5rem 0 0.5rem 0;
              font-weight: 700;
              line-height: 1.4;
              page-break-after: avoid !important;
              break-after: avoid !important;
            }
            .handwritten-mode-active h2,
            .handwritten-mode-active h3 {
              color: #0047ab !important;
              font-family: 'Caveat', cursive !important;
              font-size: 2.1rem !important;
              margin: 0 !important;
              line-height: 9mm !important;
            }

            strong { color: inherit; font-weight: bold; }
            .handwritten-mode-active strong { color: #1a1a1a !important; }

            mark { background-color: rgba(253, 224, 71, 0.4); padding: 0 4px; }
            
            /* Lists */
            ul, ol {
              margin: 0.5rem 0 1rem 1.5rem;
            }
            .handwritten-mode-active ul,
            .handwritten-mode-active ol {
              list-style-type: none;
              padding-left: 1rem;
              margin: 0 !important;
            }
            .handwritten-mode-active ul li::before {
              content: "•";
              color: #0047ab;
              margin-right: 0.5rem;
              font-weight: bold;
            }
            .handwritten-mode-active ul li,
            .handwritten-mode-active ol li {
              line-height: 9mm !important;
            }

            /* Academic Table Styling for PDF */
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 1.5rem 0;
              font-size: 0.95rem;
              text-align: left;
              border-radius: 8px;
              overflow: hidden;
              border: 1px solid #cbd5e1;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            th {
              background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%) !important;
              color: white !important;
              font-weight: 700;
              padding: 10px 14px;
              text-transform: uppercase;
              font-size: 0.8rem;
              letter-spacing: 0.05em;
            }
            td {
              padding: 10px 14px;
              border-bottom: 1px solid #e2e8f0;
              color: #334155;
              background: #ffffff;
            }
            tr:nth-child(even) td {
              background: #f8fafc;
            }
            
            .handwritten-mode-active table {
              border: 1px dashed #0047ab !important;
              margin: 9mm 0 !important;
              box-shadow: none !important;
              border-radius: 0 !important;
            }
            .handwritten-mode-active th {
              background: transparent !important;
              color: #e11d48 !important;
              border-bottom: 2px solid #0047ab !important;
              font-family: 'Caveat', cursive !important;
              font-size: 1.4rem !important;
              padding: 6px 12px !important;
            }
            .handwritten-mode-active td {
              color: #0047ab !important;
              border-bottom: 1px dashed #cbd5e1 !important;
              font-family: 'Kalam', cursive !important;
              font-size: 1.1rem !important;
              padding: 6px 12px !important;
              background: transparent !important;
            }

            /* Math & Formula Spacing */
            .katex-display, .formula-block {
              margin: 1rem 0 !important;
              padding: 0.5rem 0 !important;
              background: transparent !important;
              border-radius: 0 !important;
              text-align: center !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }

            /* Code Block Styling */
            pre {
              margin: 1rem 0 !important;
              padding: 12px 16px !important;
              background: #f8fafc !important;
              border: 1px solid #cbd5e1 !important;
              border-radius: 8px !important;
              overflow-x: auto !important;
              white-space: pre-wrap !important;
              word-wrap: break-word !important;
              box-shadow: 0 1px 3px rgba(0,0,0,0.02) !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            
            .handwritten-mode-active pre {
              background: rgba(241, 245, 249, 0.6) !important;
              border: 1px dashed #cbd5e1 !important;
            }

            code {
              font-family: 'Fira Code', 'Courier New', Courier, monospace !important;
              font-size: 0.9rem !important;
              line-height: 1.5 !important;
              color: inherit !important;
              background: transparent !important;
              padding: 0 !important;
              border-radius: 0 !important;
            }

            /* Callout box print break protection */
            .callout-box {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              margin: 1rem 0 !important;
              padding: 12px 16px !important;
              border-radius: 8px !important;
              border: 1px solid #cbd5e1 !important;
              background: #f8fafc !important;
              display: flex;
              gap: 12px;
              align-items: flex-start;
            }
            .callout-icon {
              font-size: 1.2rem;
              line-height: 1;
            }
            .callout-content {
              font-size: 0.95rem;
              color: inherit;
              flex: 1;
            }
            .handwritten-mode-active .callout-box {
              background: transparent !important;
              border: 1px dashed #0047ab !important;
              margin: 0 !important;
              padding: 0 0 0 9mm !important;
              line-height: 9mm !important;
            }

            /* Diagram Spacing & Break Prevention */
            .mermaid {
              display: flex;
              justify-content: center;
              align-items: center;
              margin: 0.75rem auto !important;
              padding: 0.75rem !important;
              background: white !important;
              border: 1px solid #e2e8f0 !important;
              border-radius: 8px !important;
              box-shadow: 0 1px 3px rgba(0,0,0,0.02) !important;
              max-width: 100% !important;
              max-height: 320px !important;
              overflow: hidden !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .mermaid svg {
              max-width: 100% !important;
              max-height: 300px !important;
              width: auto !important;
              height: auto !important;
            }

            .handwritten-mode-active .mermaid {
              background: transparent !important;
              border: none !important;
              box-shadow: none !important;
              margin: 9mm auto !important;
              padding: 0 !important;
              max-height: 243mm !important;
            }
            .handwritten-mode-active .mermaid svg {
              max-height: 225mm !important;
              width: auto !important;
              height: auto !important;
            }

            .qa-item {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              margin-bottom: 2rem;
            }
            
            h1, h2, h3, h4, h5, h6 {
              page-break-after: avoid !important;
              break-after: avoid !important;
            }

            p, li {
              orphans: 3;
              widows: 3;
            }

            /* Watermark style */
            .watermark-overlay {
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%) rotate(-45deg);
              font-size: 5.5rem;
              color: rgba(148, 163, 184, 0.12);
              font-family: inherit;
              font-weight: 800;
              pointer-events: none;
              z-index: -1000;
              white-space: nowrap;
            }

            /* Table of Contents style */
            .toc-container {
              page-break-after: always;
              margin-bottom: 3rem;
              break-after: page;
            }
            .toc-title {
              font-size: 1.75rem;
              font-weight: 800;
              margin-bottom: 1.5rem;
              border-bottom: 2px solid currentColor;
              padding-bottom: 0.5rem;
            }
            .toc-list {
              list-style: none;
              padding: 0;
              margin: 0;
            }
            .toc-item {
              display: flex;
              align-items: baseline;
              margin-bottom: 0.75rem;
              font-weight: 600;
            }
            .toc-link {
              text-decoration: none;
              color: inherit !important;
              display: flex;
              width: 100%;
              justify-content: space-between;
              align-items: baseline;
            }
            .toc-name {
              order: 1;
              background: white;
              padding-right: 0.5rem;
            }
            .toc-dots {
              order: 2;
              flex-grow: 1;
              border-bottom: 1px dotted #cbd5e1;
              margin: 0 0.5rem;
            }
            .toc-number {
              order: 3;
              background: white;
              padding-left: 0.5rem;
            }

            /* Logo style */
            .pdf-logo {
              text-align: right;
              margin-bottom: 1.5rem;
            }
            .pdf-logo img {
              max-height: 48px;
              max-width: 160px;
              object-fit: contain;
            }

            ${themeStyles}
          </style>
        </head>
        <body>
          ${safeWatermark ? `<div class="watermark-overlay">${safeWatermark}</div>` : ''}
          <div id="pdf-content">
            ${safeLogoUrl ? `<div class="pdf-logo"><img src="${safeLogoUrl}" /></div>` : ''}
            ${cleanHtml}
          </div>
        </body>
        </html>
      `;

      // Set page format/margin options
      const marginConfig = marginMap[margins] || marginMap.normal;
      
      // Header and footer options
      const headerFooterOptions = {};
      if (includePageNumbers || headerText || footerText) {
        headerFooterOptions.displayHeaderFooter = true;
        headerFooterOptions.headerTemplate = `
          <div style="font-size: 8px; font-family: sans-serif; width: 100%; display: flex; justify-content: space-between; padding: 0 15mm; color: #94a3b8; box-sizing: border-box;">
            <span>${headerText ? sanitizeHtml(headerText, { allowedTags: [] }) : ''}</span>
            <span>${metadata.title ? sanitizeHtml(metadata.title, { allowedTags: [] }) : ''}</span>
          </div>
        `;
        headerFooterOptions.footerTemplate = `
          <div style="font-size: 8px; font-family: sans-serif; width: 100%; display: flex; justify-content: space-between; padding: 0 15mm; color: #94a3b8; box-sizing: border-box;">
            <span>${footerText ? sanitizeHtml(footerText, { allowedTags: [] }) : ''}</span>
            ${includePageNumbers ? `<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>` : ''}
          </div>
        `;
      }

      // Hard timeout enforcement: 20 seconds maximum execution time
      const generatePdfTask = (async () => {
        await page.setContent(fullHtml, { waitUntil: 'load', timeout: 15000 });
        return await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: marginConfig,
          ...headerFooterOptions,
          timeout: 15000
        });
      })();

      let timeoutTimer = null;
      const timeoutTask = new Promise((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new Error('TIMEOUT_EXCEEDED'));
        }, 20000);
      });

      let pdfBuffer;
      try {
        pdfBuffer = await Promise.race([generatePdfTask, timeoutTask]);
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }

      await browser.close();
      browser = null;

      // Write PDF metadata using pdf-lib
      try {
        const { PDFDocument } = require('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        
        pdfDoc.setTitle(metadata.title || filename || 'Untitled Note');
        if (metadata.subject) pdfDoc.setSubject(metadata.subject);
        if (metadata.author) pdfDoc.setAuthor(metadata.author);
        if (metadata.keywords && typeof metadata.keywords === 'string') {
          pdfDoc.setKeywords(metadata.keywords.split(',').map(k => k.trim()));
        }
        
        const customProducer = [
          metadata.institutionName,
          metadata.department,
          metadata.semester ? `Semester ${metadata.semester}` : '',
          metadata.academicYear
        ].filter(Boolean).join(', ');
        
        if (customProducer) {
          pdfDoc.setProducer(`SmartNotes AI (${customProducer})`);
        } else {
          pdfDoc.setProducer('SmartNotes AI');
        }
        pdfDoc.setCreator('SmartNotes AI');

        const compressedPdfBytes = await pdfDoc.save({
          useObjectStreams: compression !== 'none',
        });
        pdfBuffer = Buffer.from(compressedPdfBytes);
      } catch (metaErr) {
        console.error('[Backend] Failed to write native PDF metadata:', metaErr.message);
      }

      res.setHeader('Content-Type', 'application/pdf');
      const safeFilename = (filename || 'notes').replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.pdf"`);
      return res.end(pdfBuffer, 'binary');
    } catch (error) {
      console.error(`[Backend] PDF generation failed:`, error.message);
      if (error.message === 'TIMEOUT_EXCEEDED') {
        return res.status(504).json({ error: 'Export took too long, try a shorter note or simpler formatting.' });
      }
      return res.status(500).json({ error: error.message || 'PDF export failed' });
    } finally {
      if (browser) {
        try { await browser.close(); } catch (e) {}
      }
    }
  } finally {
    if (uniqueUserDataDir && fs.existsSync(uniqueUserDataDir)) {
      try { fs.rmSync(uniqueUserDataDir, { recursive: true, force: true }); } catch (e) {}
    }
    isPdfExportInProgress = false;
  }
});

// Endpoint to handle Ask PDF Chat (supports both GPT-4o and Gemini models)
app.post('/api/ask-pdf-chat', aiLimiter, async (req, res) => {
  const { messages, pdfText, constraints, model: requestedModel } = req.body;
  const modelName = requestedModel || req.headers['x-gemini-model'] || 'gpt-4o';
  const isGemini = modelName.startsWith('gemini-');

  if (isGemini) {
    const { genAI: reqGenAI } = await getAIClient(req);
    if (!reqGenAI) {
      return res.status(400).json({ error: 'Gemini API key not configured. Please supply a key in settings or contact the administrator.' });
    }

    try {
      const constraintList = constraints && constraints.length > 0
        ? constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')
        : 'No strict formatting constraints.';

      const systemPrompt = `You are a helpful, expert academic AI tutor designed to help students master their courses using uploaded textbooks and class notes.
      
TEXTBOOK PDF CONTENT CONTEXT:
\"\"\"
${pdfText || 'No PDF content uploaded.'}
\"\"\"

STRICT ANSWER CONSTRAINTS:
${constraintList}

INSTRUCTIONS:
1. Answer the user's question accurately based STRICTLY on the TEXTBOOK PDF CONTENT CONTEXT when relevant.
2. Flawlessly adhere to the STRICT ANSWER CONSTRAINTS. If a constraint requests a specific format (e.g. "bullet points", "Reply in Hindi", "Only 5 marks depth"), you MUST follow it exactly.
3. Be encouraging, concise, and structured. Use clear markdown formatting.`;

      const contents = [];
      for (const msg of messages) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }

      // Priority list of models to try
      const preferredModel = modelName;
      const modelsToTry = [];
      if (preferredModel && preferredModel.trim()) {
        modelsToTry.push(preferredModel.trim());
      }
      const defaultModels = [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-3.1-flash-lite"
      ];
      for (const model of defaultModels) {
        if (!modelsToTry.includes(model)) {
          modelsToTry.push(model);
        }
      }

      let lastError = null;
      let successfulModel = null;
      let text = '';

      for (const currentModelName of modelsToTry) {
        try {
          console.log(`[Backend] Trying Ask PDF Chat with model: ${currentModelName}`);
          const model = reqGenAI.getGenerativeModel({ 
            model: currentModelName,
            systemInstruction: systemPrompt
          });

          const result = await model.generateContent({ contents });
          const response = await result.response;
          text = response.text().trim();
          successfulModel = currentModelName;
          break; // Success! Exit loop
        } catch (error) {
          console.warn(`[Backend] Model ${currentModelName} failed for Ask PDF Chat:`, error.message);
          lastError = error;
        }
      }

      if (!successfulModel) {
        throw new Error(lastError?.message || "All Gemini models failed");
      }

      return res.json({ 
        success: true, 
        message: { role: 'assistant', content: text },
        usedModel: successfulModel
      });
    } catch (error) {
      console.error('[Backend] Gemini Ask PDF Chat failed:', error);
      return res.status(500).json({ error: error.message });
    }
  } else {
    // OpenAI GPT-4o fallback
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'OpenAI API Key is required. Please define OPENAI_API_KEY in the backend .env file.' });
    }

    try {
      const constraintList = constraints && constraints.length > 0
        ? constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')
        : 'No strict formatting constraints.';

      const systemPrompt = `You are a helpful, expert academic AI tutor designed to help students master their courses using uploaded textbooks and class notes.
      
TEXTBOOK PDF CONTENT CONTEXT:
\"\"\"
${pdfText || 'No PDF content uploaded.'}
\"\"\"

STRICT ANSWER CONSTRAINTS:
${constraintList}

INSTRUCTIONS:
1. Answer the user's question accurately based STRICTLY on the TEXTBOOK PDF CONTENT CONTEXT when relevant.
2. Flawlessly adhere to the STRICT ANSWER CONSTRAINTS. If a constraint requests a specific format (e.g. "bullet points", "Reply in Hindi", "Only 5 marks depth"), you MUST follow it exactly.
3. Be encouraging, concise, and structured. Use clear markdown formatting.`;

      const formattedMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: formattedMessages,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return res.status(response.status).json({ error: errorData.error?.message || 'OpenAI API request failed' });
      }

      const data = await response.json();
      return res.json({ success: true, message: data.choices[0].message });
    } catch (error) {
      console.error('[Backend] OpenAI chat completions failed:', error);
      return res.status(500).json({ error: error.message });
    }
  }
});

// Start server after ensuring database schema is initialized
initDatabase().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend server running on http://localhost:${port}`);
  });
}).catch(err => {
  console.error('[Startup] Database initialization failed:', err);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend server running on http://localhost:${port} (with database warnings)`);
  });
});


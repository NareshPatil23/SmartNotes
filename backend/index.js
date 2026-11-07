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
const pdf = require('pdf-parse');

const { initDatabase, query } = require('./src/config/db');
const { optionalAuth, requireAuth } = require('./src/middleware/auth');
const { apiLimiter, authLimiter, aiLimiter, heavyLimiter, validateSsrfUrl } = require('./src/middleware/security');
const { resolveAIClient } = require('./src/services/aiService');
const { DEFAULT_GEMINI_MODEL, getModelsToTry } = require('./src/config/aiConfig');
const { checkCanGenerate, recordGeneration } = require('./src/services/usageService');
const { extractLinkContent } = require('./src/services/linkExtractorService');
const {
  ControlledAiShareError,
  validateAiShareUrl,
  fetchAndParseAiShareLink,
  parsePastedChatText
} = require('./src/services/aiChatShareService');
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

    const modelsToTry = getModelsToTry(req.headers['x-gemini-model']);

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

    const modelsToTry = getModelsToTry(req.headers['x-gemini-model']);

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

  const modelsToTry = getModelsToTry(req.headers['x-gemini-model']);

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

// Endpoint to scrape and import content from a public link using lightweight HTTP + Readability
app.post('/api/import-link', requireAuth, aiLimiter, heavyLimiter, async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Please provide a valid URL link.' });
  }

  let extracted;
  try {
    extracted = await extractLinkContent(url.trim());
  } catch (extractErr) {
    console.warn(`[Backend] Link extraction failed for ${url}:`, extractErr.message);
    return res.status(400).json({ error: extractErr.message });
  }

  const { title, text: contentText } = extracted;
  if (!contentText || contentText.trim().length === 0) {
    return res.status(400).json({
      error: 'Could not extract readable article text from this page. Please copy the text and paste it into the editor instead.'
    });
  }

  let reqGenAI = null;
  try {
    const aiClient = await getAIClient(req);
    reqGenAI = aiClient?.genAI || null;
  } catch (e) {
    reqGenAI = null;
  }

  // In BYOK architecture, if backend has no Gemini API key, return the extracted text
  // so the client can format it directly using the user's browser-stored Gemini key.
  if (!reqGenAI) {
    console.log(`[Backend] Extracted ${contentText.length} chars. No server Gemini key; returning text for client-side BYOK formatting.`);
    return res.json({ success: true, title, text: contentText });
  }

  console.log(`[Backend] Extracted ${contentText.length} chars. Passing to Gemini AI...`);

  const modelsToTry = getModelsToTry(req.headers['x-gemini-model']);

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
      console.log(`[Backend] Formatting import using Gemini model: ${modelName}`);
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
      
      console.log(`[Backend] Extracted content converted to ${qaPairs.length} questions successfully.`);
      return res.json({ success: true, title, text: contentText, qaList: qaPairs });
    } catch (err) {
      console.warn(`[Backend] Model ${modelName} failed link import processing:`, err.message);
      lastError = err;
    }
  }

  // Graceful fallback: return the extracted text if AI formatting fails
  console.log(`[Backend] AI formatting failed (${lastError?.message}), returning raw extracted text as fallback.`);
  return res.json({ success: true, title, text: contentText });
});

// Endpoint to inspect and parse an AI chat share link or pasted text into selectable turns
app.post('/api/import-ai-share', requireAuth, aiLimiter, heavyLimiter, async (req, res) => {
  const { url, rawText } = req.body;

  // Handle pasted chat text fallback
  if (rawText && typeof rawText === 'string') {
    try {
      const turns = parsePastedChatText(rawText);
      if (!turns || turns.length === 0) {
        return res.status(400).json({ error: 'Could not detect any question/answer turns in the pasted text.' });
      }
      return res.json({
        success: true,
        title: 'Pasted AI Conversation',
        provider: 'custom',
        turns
      });
    } catch (err) {
      if (err && err.isControlled) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: 'Failed to parse pasted dialogue. Please check the text format.' });
    }
  }

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Please provide a valid AI chat share link.' });
  }

  try {
    const result = await fetchAndParseAiShareLink(url.trim());
    return res.json({
      success: true,
      title: result.title,
      provider: result.provider,
      turns: result.turns
    });
  } catch (err) {
    // Privacy: zero logging of URL or conversation content
    // Only return controlled friendly messages; unexpected errors receive a safe generic message
    if (err && err.isControlled) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({
      error: 'Unable to process this AI chat link at this time. Please use "Paste chat text" or "Upload export file" instead.'
    });
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

    const preferredModel = req.headers['x-gemini-model'] || DEFAULT_GEMINI_MODEL;
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

// PDF generation is executed client-side via pdfExportEngine.js (Zero server RAM)
app.post('/api/generate-pdf', requireAuth, (req, res) => {
  return res.status(410).json({
    error: 'Server-side PDF generation has been retired. Please use the high-performance client-side vector PDF export.'
  });
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
      const modelsToTry = getModelsToTry(modelName);

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


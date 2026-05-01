const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3002;

// Initialize Gemini
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// Simple logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Set up multer for file uploads (in memory for now)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// Endpoint to handle file upload and text extraction
app.post('/api/extract', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // In a full implementation, we'd use pdf-parse or mammoth here based on mimetype
    // For now, return placeholder success
    res.json({
      success: true,
      text: "Extracted text placeholder..."
    });
  } catch (error) {
    console.error('Extraction error:', error);
    res.status(500).json({ error: 'Failed to extract text' });
  }
});

// Endpoint to handle AI formatting
app.post('/api/format-ai', async (req, res) => {
  console.log(`[Backend] Received format request for text: ${req.body.text?.substring(0, 50)}...`);
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'No text provided' });
  }

  if (!genAI) {
    console.warn('GEMINI_API_KEY not found. Falling back to mock formatting.');
    const mockHtml = `
      <h3>Formatted Note</h3>
      <ul>
        <li><strong>Key Concept:</strong> ${text.substring(0, 50)}...</li>
        <li>This is a fallback response because no AI API key was found.</li>
        <li>You can still edit this text manually.</li>
      </ul>
    `;
    return res.json({ html: mockHtml });
  }

  // List of models to try in order of preference (updated based on environment availability)
  const modelsToTry = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-3-flash-preview",
    "gemini-pro-latest",
    "gemini-1.5-flash-latest"
  ];
  let lastError = null;

  for (const modelName of modelsToTry) {
    try {
      console.log(`[AI] Attempting ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = `
        You are an elite academic note-taker and information architect. 
        Transform the following raw study text into professional, high-impact, and logically structured exam notes.
        
        STRICT FORMATTING RULES:
        1. OUTPUT ONLY SEMANTIC HTML. No preamble, no postamble, no markdown blocks.
        2. Use <h3> for primary topics and main headers.
        3. Use <ul> and <li> for standard bullet points.
        4. Use <ol> and <li> for sequential steps or chronological processes.
        5. Use <strong> to highlight critical terminology, keywords, or names.
        6. Use <mark> to highlight the most vital definitions, formulas, or "must-remember" facts.
        7. If the content is comparative, use a <table> with <thead> and <tbody>.
        8. Organize information with clear hierarchy and logical flow.
        9. Keep the tone academic, concise, and structured for quick revision.
        10. Ensure the HTML is clean and valid.
        
        TEXT TO PROCESS:
        ${text}
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      let html = response.text().trim();
      
      // Clean up markdown code blocks if AI included them
      html = html.replace(/```html/gi, '').replace(/```/g, '').trim();

      console.log(`[AI] Success with ${modelName}`);
      return res.json({ html });
    } catch (error) {
      console.error(`[AI] Failed with ${modelName}:`, error.message || error);
      lastError = error;
      
      // If it's a quota issue, we might want to try other models, but if it's a global quota, we might fail anyway.
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.warn(`[AI] Quota exceeded for ${modelName}.`);
      }
    }
  }

  // If all models failed
  console.error('[AI] All models failed.');
  let errorMessage = "AI formatting was unavailable, so the text was preserved as is.";
  if (lastError?.message?.includes('429') || lastError?.message?.includes('quota')) {
    errorMessage = "AI Quota exceeded for your API key. Please check your billing or wait for quota to reset.";
  } else if (lastError?.status === 404) {
    errorMessage = "The requested AI models were not found. This might be a regional or API key restriction.";
  }

  const fallbackHtml = `
    <h3>${text.substring(0, 30)}... (Original Text)</h3>
    <p>${text}</p>
    <div style="background: rgba(255,0,0,0.1); padding: 10px; border-radius: 5px; margin-top: 10px; border-left: 4px solid #f44336;">
      <p style="margin: 0; font-size: 0.9rem; color: #d32f2f;"><strong>Notice:</strong> ${errorMessage}</p>
    </div>
  `;
  res.json({ html: fallbackHtml });
});

// Endpoint to generate notes using AI
app.post('/api/generate-notes', async (req, res) => {
  const { question, text, options } = req.body;
  
  if (!text && !question) {
    return res.status(400).json({ error: 'No text or question provided' });
  }

  // Use the entire raw text as is
  const sections = [
    {
      heading: "", 
      content: text, 
      bullets: []
    }
  ];

  setTimeout(() => {
    res.json({
      title: "Generated Notes",
      sections: sections
    });
  }, 1000);
});

// Endpoint to process and enhance an uploaded diagram
app.post('/api/process-diagram', upload.single('diagram'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    
    // Mock processing: "enhance clarity", "clean background", etc.
    // Here we just return a base64 version of the uploaded image to simulate it being "processed".
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    
    setTimeout(() => {
      res.json({
        success: true,
        message: 'Diagram processed and enhanced successfully',
        imageUrl: base64Image
      });
    }, 1500); // Simulate processing delay
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ error: 'Failed to process diagram' });
  }
});



// Serve static files from the frontend/dist directory
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Catch-all route to serve the frontend index.html for SPA support
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});

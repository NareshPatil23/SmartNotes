const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { query } = require('../config/db');
const { decrypt } = require('./encryptionService');

function cleanAndParseJson(rawText) {
  if (!rawText || !rawText.trim()) throw new Error("Empty response from AI model");
  let text = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

  // 1. Standard parse first
  try {
    return JSON.parse(text);
  } catch (e1) {}

  // 2. Character-by-character control character escaper
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
    // 3. Fallback regex extractor
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
    else detectedMime = 'image/jpeg';
  }
  
  return { isPdf, isDocx, isTxt, isImage, mimeType: detectedMime };
}

/**
 * Resolves AI client credentials securely:
 * 1. Checks user_settings for encrypted BYOK key if user is logged in
 * 2. Checks request header 'x-gemini-key' (for transitional BYOK)
 * 3. Falls back to platform server process.env.GEMINI_API_KEY
 */
async function resolveAIClient(req) {
  let resolvedKey = null;
  let isByok = false;
  let preferredModel = req.headers['x-gemini-model'] || null;

  if (req.user && req.user.id) {
    const settingsRes = await query('SELECT * FROM user_settings WHERE user_id = $1', [req.user.id]);
    const settings = settingsRes.rows[0];
    if (settings) {
      if (settings.preferred_model && !preferredModel) {
        preferredModel = settings.preferred_model;
      }
      if (settings.ai_provider === 'byok' && settings.encrypted_byok_key) {
        const decryptedKey = decrypt(settings.encrypted_byok_key);
        if (decryptedKey && decryptedKey.trim()) {
          resolvedKey = decryptedKey.trim();
          isByok = true;
        }
      }
    }
  }

  // Fallback to request header if not yet in database
  if (!resolvedKey) {
    const headerKey = req.headers['x-gemini-key'];
    if (headerKey && headerKey.trim()) {
      resolvedKey = headerKey.trim();
      isByok = true;
    }
  }

  // Platform fallback
  if (!resolvedKey) {
    resolvedKey = process.env.GEMINI_API_KEY;
    isByok = false;
  }

  if (!resolvedKey) {
    return { genAI: null, fileManager: null, isByok: false, preferredModel };
  }

  return {
    genAI: new GoogleGenerativeAI(resolvedKey),
    fileManager: new GoogleAIFileManager(resolvedKey),
    isByok,
    preferredModel: preferredModel || 'gemini-2.5-flash'
  };
}

function getModelsToTry(preferredModel) {
  const models = [];
  if (preferredModel && preferredModel.trim()) {
    models.push(preferredModel.trim());
  }
  const defaultModels = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.1-flash-lite'
  ];
  for (const m of defaultModels) {
    if (!models.includes(m)) {
      models.push(m);
    }
  }
  return models;
}

module.exports = {
  cleanAndParseJson,
  getFileDetails,
  resolveAIClient,
  getModelsToTry
};

const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { encrypt, decrypt, maskApiKey } = require('../services/encryptionService');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const router = express.Router();

/**
 * GET /api/settings
 * Fetch user's AI settings (never returns raw API key, only masked)
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const settingsRes = await query('SELECT * FROM user_settings WHERE user_id = $1', [req.user.id]);
    const settings = settingsRes.rows[0] || {};

    let maskedKey = '';
    if (settings.encrypted_byok_key) {
      const decrypted = decrypt(settings.encrypted_byok_key);
      if (decrypted) {
        maskedKey = maskApiKey(decrypted);
      }
    }

    return res.json({
      success: true,
      settings: {
        aiProvider: settings.ai_provider || 'platform',
        preferredModel: settings.preferred_model || 'gemini-2.5-flash',
        defaultTheme: settings.default_theme || 'default',
        hasByokKey: !!settings.encrypted_byok_key,
        maskedKey
      }
    });
  } catch (error) {
    console.error('[Settings] Fetch settings failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settings/byok
 * Securely store or update user's BYOK Gemini API key (encrypted with AES-256-GCM)
 */
router.post('/byok', requireAuth, async (req, res) => {
  try {
    const { apiKey, preferredModel, aiProvider } = req.body;

    let encryptedKey = undefined;
    if (apiKey !== undefined) {
      if (apiKey && apiKey.trim()) {
        // Encrypt with AES-256-GCM
        encryptedKey = encrypt(apiKey.trim());
      } else {
        encryptedKey = null; // Clear key
      }
    }

    // Check if settings exist
    const check = await query('SELECT id, encrypted_byok_key FROM user_settings WHERE user_id = $1', [req.user.id]);

    const targetProvider = aiProvider || (encryptedKey ? 'byok' : 'platform');
    const targetModel = preferredModel || 'gemini-2.5-flash';

    if (check.rows.length === 0) {
      const id = `set_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await query(
        `INSERT INTO user_settings (id, user_id, ai_provider, encrypted_byok_key, preferred_model) 
         VALUES ($1, $2, $3, $4, $5)`,
        [id, req.user.id, targetProvider, encryptedKey, targetModel]
      );
    } else {
      const currentEncrypted = check.rows[0].encrypted_byok_key;
      const finalKey = encryptedKey !== undefined ? encryptedKey : currentEncrypted;
      await query(
        `UPDATE user_settings 
         SET ai_provider = $1, encrypted_byok_key = $2, preferred_model = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE user_id = $4`,
        [targetProvider, finalKey, targetModel, req.user.id]
      );
    }

    return res.json({
      success: true,
      message: 'AI settings updated securely.',
      aiProvider: targetProvider,
      preferredModel: targetModel,
      hasByokKey: !!(encryptedKey || (check.rows[0] && check.rows[0].encrypted_byok_key))
    });
  } catch (error) {
    console.error('[Settings] Save BYOK failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settings/test-key
 * Test a Gemini API key (either raw key before saving, or the user's stored BYOK key)
 */
router.post('/test-key', async (req, res) => {
  try {
    let keyToTest = req.body.apiKey;
    const modelName = req.body.model || req.headers['x-gemini-model'] || 'gemini-2.5-flash';

    // If no key provided in body, but user is authenticated, check their stored key
    if (!keyToTest && req.user && req.user.id) {
      const s = await query('SELECT encrypted_byok_key FROM user_settings WHERE user_id = $1', [req.user.id]);
      if (s.rows[0] && s.rows[0].encrypted_byok_key) {
        keyToTest = decrypt(s.rows[0].encrypted_byok_key);
      }
    }

    // Transitional fallback to header
    if (!keyToTest) {
      keyToTest = req.headers['x-gemini-key'];
    }

    // Platform key fallback
    if (!keyToTest) {
      keyToTest = process.env.GEMINI_API_KEY;
    }

    if (!keyToTest) {
      return res.status(400).json({ success: false, error: 'No API key provided to test.' });
    }

    const genAI = new GoogleGenerativeAI(keyToTest.trim());
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Reply with "OK" only.' }] }],
      generationConfig: { maxOutputTokens: 5 }
    });

    const response = await result.response;
    const reply = response.text().trim();

    return res.json({
      success: true,
      message: `Successfully validated connection with ${modelName}! AI response: "${reply}"`
    });
  } catch (error) {
    console.error('[Settings] Test connection failed:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

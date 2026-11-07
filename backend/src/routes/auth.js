const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { query } = require('../config/db');
const { signToken, requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const { getUserUsage } = require('../services/usageService');
const { maskApiKey } = require('../services/encryptionService');
const { DEFAULT_GEMINI_MODEL } = require('../config/aiConfig');

const router = express.Router();

/**
 * Verify Google ID Token using official Google OAuth2Client
 * Verifies signature, issuer, audience, and expiration.
 * Fails closed on any error.
 */
async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured on the backend');
  }

  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({
    idToken,
    audience: clientId
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Invalid token payload: missing sub or email claims');
  }

  // Validate issuer
  const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!validIssuers.includes(payload.iss)) {
    throw new Error(`Invalid token issuer: ${payload.iss}`);
  }

  // Validate expiration
  const nowInSecs = Math.floor(Date.now() / 1000);
  if (payload.exp < nowInSecs) {
    throw new Error('Google ID token has expired');
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email.split('@')[0],
    profileImage: payload.picture || '',
    emailVerified: payload.email_verified
  };
}

/**
 * POST /api/auth/google
 * Authenticate with Google ID token
 */
router.post('/google', authLimiter, async (req, res) => {
  try {
    const { credential, testUser } = req.body;

    let googlePayload = null;

    if (credential) {
      // Mock auth is strictly restricted:
      // ONLY allowed in non-production environments AND when ALLOW_MOCK_AUTH=true is explicitly set
      // AND token prefix matches 'mock_dev_'
      if (
        process.env.NODE_ENV !== 'production' &&
        (process.env.ALLOW_MOCK_AUTH === 'true' || process.env.ALLOW_MOCK_AUTH === true) &&
        typeof credential === 'string' &&
        credential.startsWith('mock_dev_')
      ) {
        const parts = credential.split('.');
        if (parts.length === 3) {
          try {
            const rawPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            googlePayload = {
              googleId: rawPayload.sub || `mock_sub_${Date.now()}`,
              email: (rawPayload.email || 'user@example.com').toLowerCase(),
              name: rawPayload.name || 'Test User',
              profileImage: rawPayload.picture || '',
              emailVerified: true
            };
          } catch (e) {
            return res.status(401).json({ error: 'Malformed mock token' });
          }
        } else {
          return res.status(401).json({ error: 'Invalid mock token structure' });
        }
      } else {
        // Standard & Production path: strict Google OAuth verification. Must fail closed.
        try {
          googlePayload = await verifyGoogleIdToken(credential);
        } catch (verifyErr) {
          return res.status(401).json({
            error: verifyErr.message || 'Invalid or expired Google authentication token'
          });
        }
      }
    } else if (testUser) {
      // Demo Student Access
      // In production, demo login is strictly disabled unless explicitly enabled via ENABLE_DEMO_LOGIN === 'true'
      if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEMO_LOGIN !== 'true') {
        return res.status(403).json({ error: 'Demo student access is disabled in production.' });
      }

      // Generate strictly isolated guest identifier with zero access to real users
      const randomSeed = Math.random().toString(36).substring(2, 8);
      googlePayload = {
        googleId: `demo_guest_${Date.now()}_${randomSeed}`,
        email: `guest_${randomSeed}@demo.smartnotes.ai`,
        name: 'Demo Student',
        profileImage: `https://api.dicebear.com/7.x/bottts/svg?seed=demo_${randomSeed}`,
        emailVerified: true
      };
    } else {
      return res.status(400).json({ error: 'Missing authentication credentials' });
    }

    if (!googlePayload || !googlePayload.email) {
      return res.status(400).json({ error: 'Missing or invalid Google authentication credentials' });
    }

    const { googleId, email, name, profileImage } = googlePayload;

    // Check if user exists by google_id or email (account linking)
    let userResult = await query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [googleId, email]
    );

    let user = userResult.rows[0];

    if (!user) {
      const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await query(
        `INSERT INTO users (id, google_id, email, name, profile_image, plan, status) 
         VALUES ($1, $2, $3, $4, $5, 'free', 'active')`,
        [userId, googleId, email, name, profileImage]
      );

      // Create default user settings
      const settingsId = `set_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await query(
        `INSERT INTO user_settings (id, user_id, ai_provider, preferred_model, default_theme) 
         VALUES ($1, $2, 'platform', $3, 'default')`,
        [settingsId, userId, DEFAULT_GEMINI_MODEL]
      );

      user = {
        id: userId,
        google_id: googleId,
        email,
        name,
        profile_image: profileImage,
        plan: 'free',
        status: 'active'
      };
    } else {
      // Update profile info and link googleId if not yet set
      await query(
        `UPDATE users SET google_id = COALESCE(google_id, $1), name = $2, profile_image = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
        [googleId, name, profileImage, user.id]
      );
      user.name = name;
      user.profile_image = profileImage;
      user.google_id = user.google_id || googleId;
    }

    const token = signToken(user);
    const isProduction = process.env.NODE_ENV === 'production';

    // Set secure HTTP-only cookie with SameSite=Lax (safe across Netlify reverse-proxy)
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    const usage = await getUserUsage(user.id, user.plan);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profileImage: user.profile_image,
        plan: user.plan,
        status: user.status
      },
      usage
    });
  } catch (error) {
    console.error('[Auth] Login processing error:', error);
    return res.status(500).json({ error: 'Authentication failed. Please try again.' });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user session & settings
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = userRes.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const settingsRes = await query('SELECT * FROM user_settings WHERE user_id = $1', [user.id]);
    const settings = settingsRes.rows[0] || {};

    const usage = await getUserUsage(user.id, user.plan);

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profileImage: user.profile_image,
        plan: user.plan,
        status: user.status
      },
      settings: {
        aiProvider: settings.ai_provider || 'platform',
        preferredModel: settings.preferred_model || DEFAULT_GEMINI_MODEL,
        defaultTheme: settings.default_theme || 'default',
        hasByokKey: !!settings.encrypted_byok_key
      },
      usage
    });
  } catch (error) {
    console.error('[Auth] Fetch session failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/logout
 * Sign out and clear session cookie
 */
router.post('/logout', (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie('token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax'
  });
  return res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;

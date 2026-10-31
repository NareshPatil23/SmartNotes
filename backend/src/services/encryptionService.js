const crypto = require('crypto');

// 32-byte key derived from ENCRYPTION_KEY (or ENCRYPTION_SECRET)
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[Security] ENCRYPTION_KEY (32 bytes) must be defined in production environment variables.');
    }
    return crypto.createHash('sha256').update('smartnotes-dev-encryption-key-32b-seed!').digest();
  }

  // If provided as a 64-char hex string (32 bytes)
  if (typeof secret === 'string' && /^[0-9a-fA-F]{64}$/.test(secret.trim())) {
    return Buffer.from(secret.trim(), 'hex');
  }

  // If provided as exactly 32 ASCII/UTF-8 bytes
  if (typeof secret === 'string' && Buffer.byteLength(secret.trim(), 'utf8') === 32) {
    return Buffer.from(secret.trim(), 'utf8');
  }

  // Derive 32-byte buffer consistently using SHA-256
  return crypto.createHash('sha256').update(String(secret).trim()).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Output format: iv_hex:tag_hex:ciphertext_hex
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a ciphertext string formatted as iv_hex:tag_hex:ciphertext_hex
 */
function decrypt(encryptedText) {
  if (!encryptedText) return null;
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted text format');
    }
    
    const [ivHex, tagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[EncryptionService] Decryption failed:', err.message);
    return null;
  }
}

/**
 * Mask an API key for safe display to client (e.g. AIza••••••••dlb0)
 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.substring(0, 4)}••••••••${trimmed.substring(trimmed.length - 4)}`;
}

module.exports = {
  encrypt,
  decrypt,
  maskApiKey
};

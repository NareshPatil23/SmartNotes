const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const dns = require('dns').promises;
const { validateUrlSafe, isRestrictedIp } = require('../services/linkExtractorService');

// User-aware rate limit key generator (falls back to client IP)
const userOrIpKeyGenerator = (req) => {
  if (req.user && req.user.id) {
    return `usr_${req.user.id}`;
  }
  return ipKeyGenerator(req.ip);
};

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per user/IP per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKeyGenerator,
  message: { error: 'Too many requests, please try again later.' }
});

// Heavy operations limiter (PDF generation, link imports)
const heavyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKeyGenerator,
  message: { error: 'Rate limit exceeded for heavy tasks. Please wait a moment.' }
});

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  
  // IPv4 ranges:
  // 10.0.0.0/8
  // 172.16.0.0/12
  // 192.168.0.0/16
  // 169.254.0.0/16 (Link local / AWS metadata)
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  return false;
}

/**
 * Validates a target URL against SSRF threats
 */
async function validateSsrfUrl(urlString) {
  return await validateUrlSafe(urlString);
}

// Auth/Login rate limiter (prevent brute force / credential stuffing)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' }
});

// AI operations limiter (prevent quota exhaustion & scraping)
const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKeyGenerator,
  message: { error: 'Too many AI generation requests. Please wait a minute before trying again.' }
});

module.exports = {
  apiLimiter,
  authLimiter,
  aiLimiter,
  heavyLimiter,
  validateSsrfUrl
};

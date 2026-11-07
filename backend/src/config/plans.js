/**
 * SaaS Subscription Plans & Quota Configuration
 */
const { GEMINI_FALLBACK_MODELS } = require('./aiConfig');

const PLANS = {
  FREE: {
    id: 'free',
    name: 'Free',
    price: 0,
    limits: {
      generationsPerMonth: 10,
      maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
      maxPages: 15,
      askPdfQueriesPerDay: 20,
      storageLimitBytes: 100 * 1024 * 1024, // 100MB
    },
    features: {
      byokSupported: true,
      exportThemes: ['default', 'academic'],
      watermarkRemovable: false,
      models: [...GEMINI_FALLBACK_MODELS],
      exportFormats: ['pdf', 'md', 'txt']
    }
  },
  STUDENT: {
    id: 'student',
    name: 'Student',
    price: 9,
    limits: {
      generationsPerMonth: 100,
      maxFileSizeBytes: 25 * 1024 * 1024, // 25MB
      maxPages: 50,
      askPdfQueriesPerDay: 200,
      storageLimitBytes: 1024 * 1024 * 1024, // 1GB
    },
    features: {
      byokSupported: true,
      exportThemes: ['default', 'academic', 'minimal', 'modern', 'dark'],
      watermarkRemovable: true,
      models: [...GEMINI_FALLBACK_MODELS],
      exportFormats: ['pdf', 'md', 'html', 'txt']
    }
  },
  PRO: {
    id: 'pro',
    name: 'Pro',
    price: 19,
    limits: {
      generationsPerMonth: 500,
      maxFileSizeBytes: 100 * 1024 * 1024, // 100MB
      maxPages: 250,
      askPdfQueriesPerDay: 10000, // Unlimited
      storageLimitBytes: 10 * 1024 * 1024 * 1024, // 10GB
    },
    features: {
      byokSupported: true,
      exportThemes: ['default', 'academic', 'minimal', 'modern', 'dark'],
      watermarkRemovable: true,
      customBranding: true,
      models: [...GEMINI_FALLBACK_MODELS, 'gpt-4o'],
      exportFormats: ['pdf', 'md', 'html', 'txt']
    }
  }
};

function getPlan(planId) {
  const normalized = (planId || 'free').toUpperCase();
  return PLANS[normalized] || PLANS.FREE;
}

module.exports = {
  PLANS,
  getPlan
};

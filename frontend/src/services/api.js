/**
 * Central Authenticated API Service
 */
let authToken = localStorage.getItem('smartnotes_auth_token') || null;

export const setAuthToken = (token) => {
  authToken = token;
  if (token) {
    localStorage.setItem('smartnotes_auth_token', token);
  } else {
    localStorage.removeItem('smartnotes_auth_token');
  }
};

export const getAuthToken = () => authToken;

/**
 * Safely parse response JSON without throwing Unexpected token '<' on HTML error pages
 */
export async function safeParseJson(response) {
  if (!response) return {};
  const contentType = (response.headers && response.headers.get('content-type')) || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch (e) {
      // Fall through to text fallback
    }
  }
  const text = await response.text().catch(() => '');
  if (text.startsWith('<!DOCTYPE') || text.startsWith('<html') || text.includes('<title>')) {
    const errorMsg = response.status === 404
      ? 'API endpoint not found. Please verify backend routing and proxy configuration.'
      : 'Backend server is currently restarting or unavailable. Please try again shortly.';
    const err = new Error(errorMsg);
    err.status = response.status;
    err.isHtmlResponse = true;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return { error: text || `HTTP ${response.status} ${response.statusText}` };
  }
}

export const safeApiFetch = async (url, options = {}) => {
  const isRelative = typeof url === 'string' && url.startsWith('/');
  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  
  const urlsToTry = [];
  if (isRelative) {
    if (apiBase) {
      urlsToTry.push(`${apiBase}${url}`);
    }
    // Relative URL (standard Netlify /api/* proxy or same-domain API)
    urlsToTry.push(url);
    // In local development only, try direct localhost:3002
    if (!import.meta.env.PROD) {
      urlsToTry.push(`http://localhost:3002${url}`);
      urlsToTry.push(`http://127.0.0.1:3002${url}`);
    }
  } else {
    urlsToTry.push(url);
  }

  const headers = { ...(options.headers || {}) };
  if (authToken && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const fetchOptions = {
    ...options,
    headers,
    credentials: 'include'
  };

  let lastError = null;
  for (const targetUrl of urlsToTry) {
    try {
      const response = await fetch(targetUrl, fetchOptions);
      return response;
    } catch (err) {
      lastError = err;
    }
  }
  const cleanError = new Error(
    import.meta.env.PROD
      ? 'Unable to connect to the backend server. Please verify your internet connection or try again in a few moments.'
      : 'Unable to connect to backend server. Please ensure the backend server is running on port 3002.'
  );
  cleanError.originalError = lastError;
  throw cleanError;
};

export const api = {
  // Auth
  async loginWithGoogle(credential, testUser = null) {
    const res = await safeApiFetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential, testUser })
    });
    const data = await safeParseJson(res);
    if (res.ok && data.token) {
      setAuthToken(data.token);
    }
    return data;
  },

  async getMe() {
    if (!authToken && !(typeof document !== 'undefined' && document.cookie.includes('token='))) {
      return { success: false, user: null };
    }
    try {
      const res = await safeApiFetch('/api/me');
      if (res.status === 401) {
        setAuthToken(null);
        return { success: false, user: null };
      }
      return await safeParseJson(res);
    } catch (err) {
      // If network fails or unreachable
      return { success: false, user: null, error: err.message };
    }
  },

  async logout() {
    try {
      await safeApiFetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    setAuthToken(null);
  },

  // Settings & BYOK
  async getSettings() {
    if (!authToken && !(typeof document !== 'undefined' && document.cookie.includes('token='))) {
      return { success: false, settings: null };
    }
    try {
      const res = await safeApiFetch('/api/settings');
      if (res.status === 401) {
        return { success: false, settings: null };
      }
      return await safeParseJson(res);
    } catch (err) {
      return { success: false, settings: null, error: err.message };
    }
  },

  async saveByokSettings(apiKey, preferredModel, aiProvider = 'byok') {
    const res = await safeApiFetch('/api/settings/byok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, preferredModel, aiProvider })
    });
    return await safeParseJson(res);
  },

  async testKeyConnection(apiKey = null, model = 'gemini-2.5-flash') {
    const res = await safeApiFetch('/api/settings/test-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, model })
    });
    return await safeParseJson(res);
  },

  // Notes & Drafts
  async fetchNotes(filter = 'all', search = '') {
    const query = new URLSearchParams({ filter, search }).toString();
    const res = await safeApiFetch(`/api/notes?${query}`);
    return await safeParseJson(res);
  },

  async saveNote(noteData) {
    const res = await safeApiFetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(noteData)
    });
    return await safeParseJson(res);
  },

  async deleteNote(noteId, permanent = false) {
    const res = await safeApiFetch(`/api/notes/${noteId}?permanent=${permanent}`, {
      method: 'DELETE'
    });
    return await safeParseJson(res);
  },

  async syncLocalDrafts(localDrafts) {
    const res = await safeApiFetch('/api/notes/sync-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localDrafts })
    });
    return await safeParseJson(res);
  },

  // Usage & Subscription
  async getUsage() {
    const res = await safeApiFetch('/api/usage');
    return await safeParseJson(res);
  },

  async getPlans() {
    const res = await safeApiFetch('/api/plans');
    return await safeParseJson(res);
  },

  async upgradePlan(targetPlan) {
    const res = await safeApiFetch('/api/subscription/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPlan })
    });
    return await safeParseJson(res);
  }
};

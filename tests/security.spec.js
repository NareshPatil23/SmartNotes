// @ts-check
const { test, expect } = require('@playwright/test');

const API_BASE = process.env.API_BASE || 'http://localhost:3002';

test.describe('Security & SSRF Guard Verification', () => {
  test('should reject internal addresses to prevent SSRF', async ({ request }) => {
    // Authenticate first since /api/import-link requires a signed-in user
    const authRes = await request.post(`${API_BASE}/api/auth/google`, {
      data: { testUser: true }
    });
    const authData = await authRes.json();
    const headers = authData.token ? { Authorization: `Bearer ${authData.token}` } : {};

    // Attempt SSRF against localhost
    const resLocal = await request.post(`${API_BASE}/api/import-link`, {
      headers,
      data: { url: 'http://localhost:3002/api/health' }
    });
    expect(resLocal.status()).toBe(400);
    const bodyLocal = await resLocal.json();
    expect(bodyLocal.error).toContain('prohibited');

    // Attempt SSRF against AWS metadata endpoint
    const resMeta = await request.post(`${API_BASE}/api/import-link`, {
      headers,
      data: { url: 'http://169.254.169.254/latest/meta-data/' }
    });
    expect(resMeta.status()).toBe(400);
    const bodyMeta = await resMeta.json();
    expect(bodyMeta.error).toContain('prohibited');
  });

  test('should require authentication for private note endpoints', async ({ request }) => {
    const unauthRes = await request.get(`${API_BASE}/api/notes`);
    expect(unauthRes.status()).toBe(401);
  });
});

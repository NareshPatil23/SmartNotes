import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

export default function GoogleAuthCard({ onLoginSuccess, title = "Sign In to SmartNotes AI", subtitle = "Access your cloud study workspace, sync notes, and unlock AI generation." }) {
  const [loading, setLoading] = useState(false);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [lastCredential, setLastCredential] = useState(null);
  const [error, setError] = useState('');
  const [isGoogleConfigured, setIsGoogleConfigured] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  // Demo student button is only rendered in dev mode or when explicitly enabled via VITE_ENABLE_DEMO
  const isDemoEnabled = !import.meta.env.PROD || import.meta.env.VITE_ENABLE_DEMO === 'true';

  const rawClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const clientId = (rawClientId && rawClientId.trim() && !rawClientId.includes('demo') && !rawClientId.includes('your_google')) 
    ? rawClientId.trim() 
    : '';

  useEffect(() => {
    if (!clientId) {
      setIsGoogleConfigured(false);
      return;
    }

    setIsGoogleConfigured(true);

    const initGis = () => {
      try {
        if (window.google && window.google.accounts) {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: handleGoogleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: true
          });

          const btnContainer = document.getElementById('google-signin-btn-target');
          if (btnContainer) {
            btnContainer.innerHTML = '';
            window.google.accounts.id.renderButton(btnContainer, {
              type: 'standard',
              theme: 'outline',
              size: 'large',
              width: 320,
              text: 'continue_with',
              shape: 'rectangular',
              logo_alignment: 'left'
            });
          }
        }
      } catch (err) {
        console.warn('[Google GIS] Initialization warning:', err.message);
        setError('Failed to initialize Google Sign-In. Please check your browser settings or origin.');
      }
    };

    if (!window.google || !window.google.accounts) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = initGis;
      script.onerror = () => setError('Unable to load Google Identity Services. Check your internet connection.');
      document.body.appendChild(script);
    } else {
      initGis();
    }
  }, [clientId]);

  const handleGoogleCredentialResponse = async (response) => {
    if (!response || !response.credential) {
      setError('No credential received from Google account picker.');
      return;
    }

    setLastCredential(response.credential);
    setLoading(true);
    setIsWakingUp(false);
    setError('');

    // Timer: if serverless/free-tier backend is asleep, notify user after 5 seconds
    const wakeTimer = setTimeout(() => {
      setIsWakingUp(true);
    }, 5000);

    try {
      const res = await api.loginWithGoogle(response.credential);
      clearTimeout(wakeTimer);
      setIsWakingUp(false);

      if (res.success && res.user) {
        onLoginSuccess(res.user, res.usage);
      } else {
        setError(res.error || 'Google token verification failed on server.');
      }
    } catch (err) {
      clearTimeout(wakeTimer);
      const friendlyMsg = err.isHtmlResponse || isWakingUp
        ? 'Waking up the server, this can take up to a minute on free cloud hosting. Please retry.'
        : (err.message || 'Unable to connect to authentication server.');
      setError(friendlyMsg);
    } finally {
      clearTimeout(wakeTimer);
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const demoEmail = `student_${Math.floor(Math.random() * 9000 + 1000)}@smartnotes.ai`;
      const res = await api.loginWithGoogle(null, {
        googleId: `demo_student_${Date.now()}`,
        email: demoEmail,
        name: 'Alex Student',
        profileImage: `https://api.dicebear.com/7.x/bottts/svg?seed=${demoEmail}`
      });

      if (res.success && res.user) {
        onLoginSuccess(res.user, res.usage);
      } else {
        // Fallback to client-side isolated demo session (never blocks user and has 0 access to server data)
        const localGuest = {
          id: `guest_${Date.now()}`,
          email: demoEmail,
          name: 'Demo Student (Local)',
          profileImage: `https://api.dicebear.com/7.x/bottts/svg?seed=${demoEmail}`,
          plan: 'free',
          isGuest: true
        };
        onLoginSuccess(localGuest, { generationsUsed: 0, generationsLimit: 10 });
      }
    } catch (err) {
      // If backend is not reached, provide isolated client-side guest session
      const fallbackGuest = {
        id: `guest_${Date.now()}`,
        email: 'demo@smartnotes.ai',
        name: 'Demo Student',
        profileImage: 'https://api.dicebear.com/7.x/bottts/svg?seed=demo',
        plan: 'free',
        isGuest: true
      };
      onLoginSuccess(fallbackGuest, { generationsUsed: 0, generationsLimit: 10 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="google-auth-card">
      <div className="auth-card-header">
        <div className="auth-brand-badge">⚡ SmartNotes AI SaaS</div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>

      {error && (
        <div className="auth-error-alert" role="alert">
          <span className="error-icon">⚠️</span>
          <div className="error-text">
            <strong>Authentication Status</strong>
            <div>{error}</div>
            {lastCredential && !loading && (
              <button 
                type="button" 
                className="btn-retry-auth" 
                onClick={() => handleGoogleCredentialResponse({ credential: lastCredential })}
                style={{
                  marginTop: '0.5rem',
                  padding: '4px 12px',
                  background: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                🔄 Retry Sign-In
              </button>
            )}
          </div>
        </div>
      )}

      {loading && isWakingUp && (
        <div style={{
          margin: '0.75rem 0',
          padding: '0.75rem 1rem',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '8px',
          color: '#d97706',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <span>⏳</span>
          <span>Waking up the server, this can take up to a minute on free hosting...</span>
        </div>
      )}

      <div className="auth-card-body">
        {isGoogleConfigured ? (
          <div className="google-btn-wrapper">
            <div id="google-signin-btn-target" style={{ minHeight: '44px', display: 'flex', justifyContent: 'center' }}></div>
            {loading && !isWakingUp && <div className="auth-spinner-sm">Verifying with Google...</div>}
          </div>
        ) : (
          <div className="google-config-notice">
            <div className="notice-badge">ℹ️ {import.meta.env.PROD ? 'Google Sign-In Connecting' : 'Google OAuth Setup Required'}</div>
            <p className="notice-desc">
              {import.meta.env.PROD
                ? 'Google Sign-In is being connected for this domain. Please ensure VITE_GOOGLE_CLIENT_ID is set in Netlify Site Configuration.'
                : <>Google Client ID is not configured yet. To use live Google login, set <code>VITE_GOOGLE_CLIENT_ID</code> in <code>frontend/.env</code>.</>}
            </p>
            {!import.meta.env.PROD && (
              <>
                <button 
                  type="button" 
                  className="btn-setup-guide"
                  onClick={() => setShowSetupGuide(!showSetupGuide)}
                >
                  {showSetupGuide ? '▲ Hide Setup Instructions' : '▼ View Google Cloud Setup Steps'}
                </button>

                {showSetupGuide && (
                  <div className="setup-steps-box">
                    <ol>
                      <li>Go to <strong>Google Cloud Console</strong> &gt; <em>APIs &amp; Services</em> &gt; <em>Credentials</em>.</li>
                      <li>Click <strong>Create Credentials</strong> &gt; <strong>OAuth client ID</strong>.</li>
                      <li>Choose <strong>Web application</strong>.</li>
                      <li>Add Authorized JavaScript Origin: <code>http://localhost:5173</code>.</li>
                      <li>Paste the generated Client ID into:
                        <br /><code>frontend/.env</code> &rarr; <code>VITE_GOOGLE_CLIENT_ID=your_id.apps.googleusercontent.com</code>
                        <br /><code>backend/.env</code> &rarr; <code>GOOGLE_CLIENT_ID=your_id.apps.googleusercontent.com</code>
                      </li>
                    </ol>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {isDemoEnabled && (
          <>
            <div className="auth-separator">
              <span>OR TEST INSTANTLY</span>
            </div>

            <button 
              type="button" 
              className="btn-demo-quickstart"
              onClick={handleDemoLogin}
              disabled={loading}
            >
              {loading ? 'Authenticating...' : '🚀 One-Click Demo Student Access'}
            </button>
          </>
        )}

        <div className="auth-card-footer">
          🔒 Secure session with AES-256 encrypted BYOK keys. We never expose your credentials to third parties.
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, lazy, Suspense } from 'react'
import './index.css'
import { api } from './services/api'
import LandingPage from './components/auth/LandingPage'

// Code-split the heavy authenticated workspace dashboard (loaded only when signed in)
const Workspace = lazy(() => import('./components/workspace/Workspace'))

export default function App() {
  const hasExistingToken = typeof window !== 'undefined' && Boolean(
    localStorage.getItem('smartnotes_auth_token') || (document.cookie && document.cookie.includes('token='))
  );

  const [currentUser, setCurrentUser] = useState(null)
  const [isAuthChecking, setIsAuthChecking] = useState(hasExistingToken)
  const [userUsage, setUserUsage] = useState(null)
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Fetch session on initial load if token exists
  useEffect(() => {
    if (!hasExistingToken) {
      setIsAuthChecking(false);
      return;
    }

    api.getMe().then(res => {
      if (res && res.success && res.user) {
        setCurrentUser(res.user);
        setUserUsage(res.usage);
      } else {
        setCurrentUser(null);
      }
    }).catch(() => {
      setCurrentUser(null);
    }).finally(() => {
      setIsAuthChecking(false);
    });
  }, [hasExistingToken]);

  const handleLoginSuccess = (user, usage) => {
    setCurrentUser(user);
    setUserUsage(usage);
  };

  // If verifying an existing session token, show quick loader
  if (isAuthChecking) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-spinner"></div>
        <h3 style={{ fontWeight: 700, fontSize: '1.25rem', marginTop: '1rem' }}>SmartNotes AI</h3>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Verifying secure session...</p>
      </div>
    );
  }

  // Above-the-fold Landing Page & Sign-In Card: 100% Eager & Synchronous (Never Lazy-Loaded)
  if (!currentUser) {
    return (
      <LandingPage 
        onLoginSuccess={handleLoginSuccess}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />
    );
  }

  // Heavy Authenticated Workspace: Code-split and loaded only on sign-in
  return (
    <Suspense fallback={
      <div className="auth-loading-screen">
        <div className="auth-spinner"></div>
        <h3 style={{ fontWeight: 700, fontSize: '1.25rem', marginTop: '1rem' }}>SmartNotes AI</h3>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Loading your workspace...</p>
      </div>
    }>
      <Workspace 
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        userUsage={userUsage}
        setUserUsage={setUserUsage}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />
    </Suspense>
  );
}

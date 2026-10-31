import React, { useEffect, lazy, Suspense } from 'react';
import GoogleAuthCard from './GoogleAuthCard';

// Lazy-load below-the-fold features & footer so above-the-fold hero paints immediately
const LandingFeatures = lazy(() => import('./LandingFeatures'));

export default function LandingPage({ onLoginSuccess, isDarkMode, setIsDarkMode }) {
  // Silent non-blocking health ping to wake the Render backend early
  useEffect(() => {
    try {
      fetch('/api/health', { method: 'GET', keepalive: true }).catch(() => {
        // Intentionally silent: purely a warm-up ping for Render free tier container cold start
      });
    } catch (e) {}
  }, []);
  return (
    <div className={`landing-page-container ${isDarkMode ? 'dark-theme' : ''}`}>
      {/* Landing Navbar */}
      <header className="landing-navbar">
        <div className="landing-brand">
          <span className="brand-icon">⚡</span>
          <span className="brand-name">SmartNotes AI</span>
          <span className="brand-tag">SaaS</span>
        </div>

        <div className="landing-nav-actions">
          <button 
            type="button" 
            className="theme-toggle-btn" 
            onClick={() => setIsDarkMode(!isDarkMode)}
            title="Toggle theme"
            aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDarkMode ? '☀️ Light' : '🌙 Dark'}
          </button>
          <a href="#signin-section" className="btn-nav-signin">Sign In</a>
        </div>
      </header>

      {/* Main Landmark Container */}
      <main id="main-content" className="landing-main">
        {/* Above-The-Fold Hero Section - Synchronous, Never Lazy-Loaded */}
        <section className="landing-hero">
          <div className="hero-content">
            <div className="hero-pill">✨ The Next-Gen Study Companion</div>
            <h1 className="hero-title">
              Generate Exam-Ready Notes <br />
              <span className="gradient-text">In Seconds with AI</span>
            </h1>
            <p className="hero-subtitle">
              Transform textbook PDFs, messy lecture slides, and curriculum topics into beautifully formatted, 
              high-yield study notes with LaTeX math equations, Mermaid diagrams, and realistic handwritten modes.
            </p>
          </div>

          {/* Auth Section Card */}
          <div id="signin-section" className="hero-auth-wrapper">
            <GoogleAuthCard 
              onLoginSuccess={onLoginSuccess}
              title="Sign In to Your Workspace"
              subtitle="Sign in with your Google account to sync notes and start generating."
            />
          </div>
        </section>

        {/* Below-The-Fold Features & Footer - Lazy Loaded */}
        <Suspense fallback={null}>
          <LandingFeatures />
        </Suspense>
      </main>
    </div>
  );
}

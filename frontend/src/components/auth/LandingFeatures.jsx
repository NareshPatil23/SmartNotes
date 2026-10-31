import React from 'react';

export default function LandingFeatures() {
  return (
    <>
      {/* Features Showcase Grid (Below-the-fold) */}
      <section className="landing-features">
        <div className="features-header">
          <h2>Engineered for Serious Students &amp; Researchers</h2>
          <p>Everything you need to master your syllabus and ace exams.</p>
        </div>

        <div className="features-grid">
          <div className="feature-item">
            <div className="feature-icon">🧠</div>
            <h3>Structured Q&amp;A Notes</h3>
            <p>Automatically synthesizes complex subject matter into question-answer pairs with marks, key takeaways, and bulleted summaries.</p>
          </div>

          <div className="feature-item">
            <div className="feature-icon">📐</div>
            <h3>LaTeX Math &amp; Diagrams</h3>
            <p>Seamlessly renders formulas, matrices, physics equations, and Mermaid system flowcharts with academic precision.</p>
          </div>

          <div className="feature-item">
            <div className="feature-icon">✍️</div>
            <h3>Realistic Notebook Mode</h3>
            <p>Switch to handwritten cursive mode on ruled paper styling for natural tactile learning and retention.</p>
          </div>

          <div className="feature-item">
            <div className="feature-icon">📂</div>
            <h3>Ask PDF AI Tutor</h3>
            <p>Upload entire textbook chapters and conduct deep-dive conceptual Q&amp;A sessions with context-aware Gemini AI.</p>
          </div>

          <div className="feature-item">
            <div className="feature-icon">🖨️</div>
            <h3>Puppeteer PDF Export</h3>
            <p>One-click export into crisp, beautifully typeset academic PDFs with custom headers, footers, watermarks, and TOC.</p>
          </div>

          <div className="feature-item">
            <div className="feature-icon">🔒</div>
            <h3>AES-256 BYOK Encryption</h3>
            <p>Bring your own Gemini API key or use platform models. All personal keys and notes are isolated and encrypted at rest.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-info">
          <div><strong>SmartNotes AI</strong> &bull; Production Study SaaS</div>
          <p>Secure Google Identity Services authentication &bull; Zero secret leakage &bull; Isolated multi-tenant storage</p>
        </div>
      </footer>
    </>
  );
}

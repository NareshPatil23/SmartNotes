import React, { useState, useEffect, useRef } from 'react';
import { validateGeminiApiKey, saveApiKey, getStoredApiKey, isRemembered } from '../../services/geminiClient';

export default function GeminiKeyModal({ isOpen, onClose, onKeySaved, isRequired = false }) {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [remember, setRemember] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const inputRef = useRef(null);
  const modalRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setApiKeyInput('');
      setErrorMessage('');
      setSuccessMessage('');
      setRemember(isRemembered() || true);
      setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 100);
    }
  }, [isOpen]);

  // Handle Escape key to close modal (if not strictly required without cancel)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isRequired) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isRequired, onClose]);

  if (!isOpen) return null;

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    const cleanKey = apiKeyInput.trim();
    if (!cleanKey) {
      setErrorMessage('Please enter your Google Gemini API key.');
      return;
    }

    setIsValidating(true);
    setErrorMessage('');
    setSuccessMessage('');

    // Validate the key with the models list endpoint (no generation quota used)
    const result = await validateGeminiApiKey(cleanKey);

    setIsValidating(false);

    if (!result.valid) {
      setErrorMessage(result.error || 'Failed to validate API key.');
      return;
    }

    // Save strictly to browser storage (localStorage or sessionStorage)
    saveApiKey(cleanKey, remember);
    setSuccessMessage(result.warning ? `✓ ${result.warning}` : '✓ API Key verified and saved successfully!');

    setTimeout(() => {
      if (onKeySaved) onKeySaved(cleanKey, result.availableModels);
      onClose();
    }, 800);
  };

  return (
    <div 
      className="modal-overlay" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="gemini-key-modal-title"
      ref={modalRef}
      style={{ zIndex: 10000 }}
    >
      <div 
        className="modal-card" 
        style={{ 
          maxWidth: '520px', 
          width: '90%', 
          background: 'var(--card-bg, #ffffff)', 
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
          border: '1px solid var(--border-color, #e2e8f0)',
          overflow: 'hidden'
        }}
      >
        <div 
          className="modal-header" 
          style={{ 
            padding: '1.25rem 1.5rem', 
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--card-bg, #ffffff)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.4rem' }}>🔑</span>
            <h2 id="gemini-key-modal-title" style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--text-color, #0f172a)' }}>
              Add Your Gemini API Key
            </h2>
          </div>
          {!isRequired && (
            <button 
              type="button" 
              className="modal-close-btn" 
              onClick={onClose}
              aria-label="Close dialog"
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '1.25rem',
                cursor: 'pointer',
                color: 'var(--text-muted, #64748b)',
                padding: '4px 8px',
                borderRadius: '6px'
              }}
            >
              ✕
            </button>
          )}
        </div>

        <form onSubmit={handleSave} style={{ padding: '1.5rem' }}>
          {/* Explanation */}
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted, #475569)', lineHeight: 1.5, marginTop: 0, marginBottom: '1rem' }}>
            SmartNotes AI connects <strong>directly from your browser</strong> to Google Gemini. Your key is stored locally in your browser and is <strong>never sent to our server</strong>, logged, or exposed in URLs.
          </p>

          <div 
            style={{ 
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: '10px',
              padding: '0.85rem 1rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.85rem'
            }}
          >
            <span style={{ color: '#4338ca', fontWeight: 600 }}>
              Need a free Gemini key?
            </span>
            <a 
              href="https://aistudio.google.com/apikey" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{
                color: '#4f46e5',
                fontWeight: 700,
                textDecoration: 'underline',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}
              aria-label="Get API key from Google AI Studio (opens in new tab)"
            >
              Get Key from Google AI Studio ↗
            </a>
          </div>

          {/* Error Message Announcement */}
          {errorMessage && (
            <div 
              role="alert" 
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                fontSize: '0.85rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem'
              }}
            >
              <span aria-hidden="true">⚠️</span>
              <div style={{ flex: 1, fontWeight: 500 }}>{errorMessage}</div>
            </div>
          )}

          {/* Success Message Announcement */}
          {successMessage && (
            <div 
              role="status" 
              style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                color: '#16a34a',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                fontSize: '0.85rem',
                marginBottom: '1rem',
                fontWeight: 600
              }}
            >
              {successMessage}
            </div>
          )}

          {/* Password-type input */}
          <div style={{ marginBottom: '1rem' }}>
            <label 
              htmlFor="gemini-api-key-input" 
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-color, #0f172a)', marginBottom: '0.4rem' }}
            >
              Google Gemini API Key
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="gemini-api-key-input"
                ref={inputRef}
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  if (errorMessage) setErrorMessage('');
                }}
                placeholder="AIzaSy..."
                autoComplete="off"
                spellCheck="false"
                disabled={isValidating}
                style={{
                  width: '100%',
                  padding: '0.75rem 3rem 0.75rem 0.9rem',
                  fontSize: '0.95rem',
                  borderRadius: '10px',
                  border: errorMessage ? '1.5px solid #ef4444' : '1px solid var(--border-color, #cbd5e1)',
                  outline: 'none',
                  background: 'var(--input-bg, #ffffff)',
                  color: 'var(--text-color, #0f172a)',
                  fontFamily: 'monospace'
                }}
                aria-required="true"
                aria-invalid={Boolean(errorMessage)}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                style={{
                  position: 'absolute',
                  right: '10px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted, #64748b)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  padding: '4px 6px'
                }}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Remember on this device checkbox */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <input
              id="remember-gemini-key"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={isValidating}
              style={{ cursor: 'pointer', width: '16px', height: '16px' }}
            />
            <label 
              htmlFor="remember-gemini-key" 
              style={{ fontSize: '0.85rem', color: 'var(--text-muted, #475569)', cursor: 'pointer', userSelect: 'none' }}
            >
              Remember on this device (stores in localStorage; uncheck for sessionStorage)
            </label>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            {!isRequired && (
              <button
                type="button"
                onClick={onClose}
                disabled={isValidating}
                className="btn-secondary"
                style={{
                  padding: '0.65rem 1.25rem',
                  borderRadius: '10px',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: isValidating ? 'not-allowed' : 'pointer'
                }}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isValidating || !apiKeyInput.trim()}
              className="btn-primary"
              style={{
                padding: '0.65rem 1.5rem',
                borderRadius: '10px',
                fontSize: '0.9rem',
                fontWeight: 700,
                background: 'var(--primary-gradient, linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%))',
                color: '#ffffff',
                border: 'none',
                cursor: isValidating || !apiKeyInput.trim() ? 'not-allowed' : 'pointer',
                opacity: isValidating || !apiKeyInput.trim() ? 0.7 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              {isValidating ? (
                <>
                  <span className="auth-spinner-sm" style={{ width: 14, height: 14, borderWidth: 2 }} aria-hidden="true"></span>
                  Validating with Gemini...
                </>
              ) : (
                'Validate & Save Key'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

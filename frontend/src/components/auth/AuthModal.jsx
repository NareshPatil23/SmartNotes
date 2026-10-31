import React from 'react';
import GoogleAuthCard from './GoogleAuthCard';

export default function AuthModal({ isOpen, onClose, onLoginSuccess }) {
  if (!isOpen) return null;

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px', padding: 0, overflow: 'hidden' }}>
        <button 
          className="auth-modal-close" 
          onClick={onClose}
          style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 10, background: 'rgba(0,0,0,0.06)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          &times;
        </button>
        
        <GoogleAuthCard 
          onLoginSuccess={(user, usage) => {
            onLoginSuccess(user, usage);
            onClose();
          }}
          title="Sign In to SmartNotes"
          subtitle="Sync your exam notes across all devices, unlock multi-model generation, and manage your study library securely."
        />
      </div>
    </div>
  );
}

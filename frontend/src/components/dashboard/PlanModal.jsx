import React, { useState } from 'react';
import { api } from '../../services/api';

export default function PlanModal({ isOpen, onClose, currentPlan, onPlanUpdated }) {
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [msg, setMsg] = useState('');

  if (!isOpen) return null;

  const plans = [
    {
      id: 'free',
      name: 'Free',
      price: '$0',
      period: '/month',
      description: 'Essential AI note-taking for occasional study sessions.',
      features: [
        '10 note generations / month',
        'Max 10MB document size',
        'Standard PDF export',
        'Gemini 2.5 Flash Lite access',
        'BYOK (Bring Your Own Key) support',
        'Local & cloud drafts sync'
      ]
    },
    {
      id: 'student',
      name: 'Student',
      price: '$9',
      period: '/month',
      isPopular: true,
      description: 'Ideal for college students preparing for semester exams.',
      features: [
        '100 note generations / month',
        'Max 25MB document size (up to 50 pages)',
        'All PDF themes (Academic, Minimal, Modern, Dark)',
        'Removable PDF watermark',
        'Gemini 3.1 Flash Lite & Flash',
        '200 Ask-PDF queries / day',
        'Priority generation queue'
      ]
    },
    {
      id: 'pro',
      name: 'Pro Researcher',
      price: '$19',
      period: '/month',
      description: 'Power users, researchers, and professional educators.',
      features: [
        '500 note generations / month',
        'Max 100MB document size (full textbooks)',
        'High-resolution PDF export + custom branding',
        'GPT-4o & Gemini Pro access',
        'Unlimited Ask-PDF queries',
        'Dedicated 24/7 priority support'
      ]
    }
  ];

  const handleSelectPlan = async (planId) => {
    if (planId === currentPlan) return;
    setLoadingPlan(planId);
    setMsg('');
    try {
      const res = await api.upgradePlan(planId);
      if (res.success) {
        setMsg(`Upgraded to ${planId.toUpperCase()} successfully!`);
        onPlanUpdated(res.plan, res.usage);
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err) {
      setMsg(`Error upgrading: ${err.message}`);
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="plan-modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="auth-modal-close" onClick={onClose}>&times;</button>
        
        <div className="plan-modal-header">
          <h2>Upgrade Your SmartNotes Plan</h2>
          <p>Supercharge your academic performance with higher limits and multi-model AI reasoning.</p>
        </div>

        {msg && <div className="plan-feedback-banner">{msg}</div>}

        <div className="plan-cards-grid">
          {plans.map((p) => {
            const isCurrent = (currentPlan || 'free').toLowerCase() === p.id;
            return (
              <div key={p.id} className={`plan-card ${p.isPopular ? 'popular' : ''} ${isCurrent ? 'current' : ''}`}>
                {p.isPopular && <span className="plan-popular-badge">MOST POPULAR</span>}
                <h3 className="plan-name">{p.name}</h3>
                <div className="plan-pricing">
                  <span className="plan-price">{p.price}</span>
                  <span className="plan-period">{p.period}</span>
                </div>
                <p className="plan-desc">{p.description}</p>
                
                <ul className="plan-feature-list">
                  {p.features.map((feat, idx) => (
                    <li key={idx}>✓ {feat}</li>
                  ))}
                </ul>

                <button
                  className={`plan-cta-btn ${isCurrent ? 'current-btn' : ''}`}
                  onClick={() => handleSelectPlan(p.id)}
                  disabled={isCurrent || loadingPlan !== null}
                >
                  {loadingPlan === p.id ? 'Switching...' : isCurrent ? 'Current Plan' : `Upgrade to ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>

        <div className="plan-modal-footer">
          💡 You can also use <strong>Bring Your Own Key (BYOK)</strong> in Settings to bypass monthly limits for free using your personal Gemini API key.
        </div>
      </div>
    </div>
  );
}

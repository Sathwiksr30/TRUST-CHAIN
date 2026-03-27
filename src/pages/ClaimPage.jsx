import React, { useState } from 'react';
import axios from 'axios';
import './ClaimPage.css';

const API_BASE = process.env.REACT_APP_BACKEND_URL || `http://${window.location.hostname}:5000`;

function ClaimPage({ willId: propWillId, onNavigate }) {
  const [status, setStatus] = useState('confirm'); // confirm, processing, success, error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  // Extract willId from URL if not provided via props
  const searchParams = new URL(window.location.href).searchParams;
  const willId = propWillId || searchParams.get('willId');

  const handleClaim = async () => {
    try {
      setStatus('processing');
      setProgress(10);
      
      // Simulate progress for UI professional feel
      const interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) {
            clearInterval(interval);
            return 90;
          }
          return prev + Math.floor(Math.random() * 15);
        });
      }, 800);

      // Call backend directly
      const response = await axios.post(`${API_BASE}/will/${willId}/claim-request`);
      
      clearInterval(interval);
      setProgress(100);

      if (response.data.status === 'SUCCESS') {
        setTimeout(() => setStatus('success'), 500);
      } else {
        throw new Error(response.data.message || "Claim failed.");
      }
    } catch (err) {
      console.error("Claim Error:", err);
      const msg = err.response?.data?.message || err.message;
      setError(msg);
      setStatus('error');
    }
  };

  if (status === 'confirm') {
    return (
      <div className="claim-page-overlay">
        <div className="professional-card claim-card">
          <div className="card-top-accent"></div>
          <div className="card-body">
            <h1 className="claim-title">Process of Claiming My Assets</h1>
            <h3 className="will-id-subtitle">{willId}</h3>
            
            <div className="question-highlight-box">
              <p>Do you want to claim your assets that are inherited?</p>
            </div>

            <div className="claim-actions">
              <button className="btn-professional-yes" onClick={handleClaim}>Yes</button>
              <button className="btn-professional-no" onClick={() => onNavigate('dashboard')}>No</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'processing') {
    return (
      <div className="claim-page-overlay">
        <div className="professional-card claim-card">
          <div className="card-top-accent"></div>
          <div className="card-body centered-content">
            <h1 className="claim-title">Process of Claiming My Assets</h1>
            <h3 className="will-id-subtitle">{willId}</h3>

            <div className="spinner-container">
              <div className="nprogress-custom-spinner"></div>
            </div>

            <div className="progress-percent-text">{progress}%</div>

            <h2 className="processing-status-title">Verifying & Transferring Assets...</h2>
            <p className="processing-status-desc">Checking inheritance eligibility and claim status...</p>

            <div className="professional-progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="claim-page-overlay">
        <div className="professional-card claim-card">
          <div className="card-top-accent"></div>
          <div className="card-body centered-content">
            <h1 className="claim-title">Process of Claiming My Assets</h1>
            <h3 className="will-id-subtitle">{willId}</h3>

            <div className="success-icon-wrapper">
              <div className="success-circle">
                <i className="fas fa-check"></i>
              </div>
            </div>

            <h2 className="success-status-title">Assets Transferred Successfully</h2>
            
            <div className="success-highlight-box">
              <p>Successfully, assets are being transferred to the beneficiary and assets have been successfully transferred.</p>
            </div>

            <button className="btn-professional-yes return-btn" onClick={() => onNavigate('dashboard')}>
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="claim-page-overlay">
        <div className="professional-card claim-card">
          <div className="card-top-accent"></div>
          <div className="card-body centered-content">
            <h1 className="claim-title">Claim Error</h1>
            <div className="error-icon-wrapper">
               <i className="fas fa-exclamation-triangle fa-3x" style={{color: '#e53e3e'}}></i>
            </div>
            <p className="error-message">{error}</p>
            <button className="btn-professional-no" onClick={() => setStatus('confirm')}>Try Again</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default ClaimPage;

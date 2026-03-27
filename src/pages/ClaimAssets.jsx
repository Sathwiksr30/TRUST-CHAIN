import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';

const API_BASE = process.env.REACT_APP_BACKEND_URL || `http://${window.location.hostname}:5000`;

function ClaimAssets({ willId: propWillId, onNavigate }) {
  const queryParams = new URLSearchParams(window.location.search);
  const willId = propWillId || queryParams.get('willId');

  const [step, setStep] = useState('confirm');
  const [statusText, setStatusText] = useState('Preparing claim workflow...');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const goDashboard = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('dashboard');
      return;
    }
    window.location.href = '/';
  };

  const startProgressAnimation = () => {
    setProgress(4);
    timerRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 92) return prev;
        return prev + Math.max(1, Math.round((96 - prev) / 10));
      });
    }, 280);
  };

  const stopProgressAnimation = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleClaimYes = async () => {
    if (!willId) {
      setStep('error');
      setError('Will ID is missing. Please open the claim link from your email.');
      return;
    }

    setError('');
    setStep('processing');
    setStatusText('Verifying claim request...');
    startProgressAnimation();

    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      setStatusText('Checking inheritance eligibility and claim status...');

      await new Promise((resolve) => setTimeout(resolve, 1400));
      setStatusText('Processing asset transfer on blockchain...');

      const response = await axios.post(`${API_BASE}/will/${encodeURIComponent(willId)}/claim-request`);
      const isSuccess = response?.data?.status === 'SUCCESS' || response?.data?.success === true;

      if (!isSuccess) {
        throw new Error(response?.data?.message || 'Claim request could not be completed.');
      }

      setStatusText('Finalizing transfer confirmation...');
      stopProgressAnimation();
      setProgress(100);

      await new Promise((resolve) => setTimeout(resolve, 500));
      setStep('success');
    } catch (err) {
      stopProgressAnimation();
      setStep('error');
      setError(err?.response?.data?.message || err?.message || 'Claim process failed. Please try again.');
    }
  };

  return (
    <div className="page" style={{ padding: '60px 20px', textAlign: 'center', maxWidth: '680px', margin: '0 auto' }}>
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '42px 34px',
          boxShadow: '0 14px 34px rgba(33, 53, 84, 0.18)'
        }}
      >
        <h2 style={{ color: '#1f3655', marginBottom: '12px' }}>Process of Claiming My Assets</h2>
        <p style={{ color: '#60708a', marginBottom: '24px', fontSize: '20px', fontWeight: '700' }}>
          WILL-{willId || 'N/A'}
        </p>

        {step === 'confirm' && (
          <div>
            <div
              style={{
                background: '#f4f8ff',
                border: '1px solid #d4e3ff',
                borderRadius: '12px',
                padding: '24px',
                marginBottom: '24px'
              }}
            >
              <p style={{ color: '#2a3e5f', margin: 0, fontSize: '18px', lineHeight: 1.6 }}>
                Do you want to claim your assets that are inherited?
              </p>
            </div>

            <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={handleClaimYes}
                style={{
                  padding: '12px 26px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#2f6fed',
                  color: 'white',
                  fontWeight: '700',
                  cursor: 'pointer',
                  minWidth: '130px'
                }}
              >
                Yes
              </button>
              <button
                onClick={goDashboard}
                style={{
                  padding: '12px 26px',
                  borderRadius: '10px',
                  border: '1px solid #c9d2e6',
                  background: '#ffffff',
                  color: '#2f3f5f',
                  fontWeight: '700',
                  cursor: 'pointer',
                  minWidth: '130px'
                }}
              >
                No
              </button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div>
            <i className="fas fa-spinner fa-spin fa-3x" style={{ color: '#5b76e8', marginBottom: '18px' }}></i>
            <p style={{ fontSize: '30px', fontWeight: '700', color: '#243b5b', marginBottom: '8px' }}>
              {progress}%
            </p>
            <p style={{ fontSize: '31px', fontWeight: '600', color: '#1f3655', marginBottom: '12px' }}>
              Verifying & Transferring Assets...
            </p>
            <p style={{ color: '#5f7291', fontSize: '20px', marginBottom: '22px' }}>{statusText}</p>
            <div
              style={{
                width: '100%',
                height: '12px',
                borderRadius: '999px',
                background: '#e8edf8',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #4d7cf8, #6789f9)',
                  transition: 'width 0.25s ease'
                }}
              />
            </div>
          </div>
        )}

        {step === 'success' && (
          <div>
            <i className="fas fa-check-circle fa-4x" style={{ color: '#34b36d', marginBottom: '20px' }}></i>
            <h3 style={{ color: '#228351', marginBottom: '14px' }}>Assets Transferred Successfully</h3>
            <div
              style={{
                background: '#ecfff3',
                border: '1px solid #b7efcf',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px'
              }}
            >
              <p style={{ color: '#1f7a4b', margin: 0, fontWeight: '600', lineHeight: 1.6 }}>
                Successfully, assets are being transferred to the beneficiary and assets have been successfully transferred.
              </p>
            </div>
            <button
              onClick={goDashboard}
              style={{
                marginTop: '6px',
                padding: '12px 26px',
                borderRadius: '10px',
                border: 'none',
                background: '#2f6fed',
                color: 'white',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Return to Dashboard
            </button>
          </div>
        )}

        {step === 'error' && (
          <div>
            <i className="fas fa-exclamation-triangle fa-3x" style={{ color: '#dc4f4f', marginBottom: '16px' }}></i>
            <h3 style={{ color: '#b03030', marginBottom: '10px' }}>Claim Request Failed</h3>
            <p style={{ color: '#5f7291', marginBottom: '20px' }}>{error}</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={handleClaimYes}
                style={{
                  padding: '12px 26px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#2f6fed',
                  color: 'white',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                Try Again
              </button>
              <button
                onClick={goDashboard}
                style={{
                  padding: '12px 26px',
                  borderRadius: '10px',
                  border: '1px solid #c9d2e6',
                  background: '#ffffff',
                  color: '#2f3f5f',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ClaimAssets;
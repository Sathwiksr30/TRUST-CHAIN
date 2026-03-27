import React, { useState } from 'react';
import axios from 'axios';

const API_BASE = process.env.REACT_APP_BACKEND_URL || `http://${window.location.hostname}:5000`;

function ReleaseWill({ willId: propWillId, onNavigate }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, uploading, verifying, executing, success, error
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  // Extract willId from URL if not provided via props
  const [searchParams] = new URLSearchParams(window.location.search);
  const willId = propWillId || searchParams.get('willId');

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleVerify = async () => {
    if (!file) {
      alert("Please upload a death certificate.");
      return;
    }

    if (!willId) {
      alert("Will ID is missing. Please use the link from your email.");
      return;
    }

    setStatus('uploading');
    setError(null);

    const formData = new FormData();
    formData.append('willId', willId);
    formData.append('certificate', file);

    try {
      const response = await axios.post(`${API_BASE}/verify-death-and-execute`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setProgress(percentCompleted);
        }
      });

      console.log("[VERIFY] Response:", response.data);
      
      if (response?.data?.status === 'SUCCESS' || response?.data?.success === true) {
        setStatus('success');
      } else {
        throw new Error(response.data.message || "Verification failed.");
      }
    } catch (err) {
      console.error("[VERIFY] Error:", err);
      setError(err.response?.data?.message || err.message || "An error occurred during verification.");
      setStatus('error');
    }
  };

  return (
    <div className="page release-will-page" style={{ padding: '60px 20px', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
      <div className="release-card" style={{ background: 'white', padding: '40px', borderRadius: '15px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
        <h2 style={{ color: '#2d3748', marginBottom: '10px' }}>Death Verification</h2>
        <p style={{ color: '#718096', marginBottom: '30px' }}>
          Upload a valid death certificate to trigger the automated release of the Digital Will <strong>{willId}</strong>.
        </p>
        
        {status === 'idle' && (
          <div className="upload-section">
            <div 
              className="file-drop-zone" 
              style={{ 
                border: '2px dashed #cbd5e0', 
                padding: '40px', 
                borderRadius: '10px', 
                marginBottom: '20px',
                cursor: 'pointer',
                background: '#f7fafc'
              }}
              onClick={() => document.getElementById('death-cert-upload').click()}
            >
              <i className="fas fa-file-upload fa-3x" style={{ color: '#667eea', marginBottom: '15px' }}></i>
              <p>{file ? file.name : "Click to select or drag & drop Death Certificate (PDF/JPG/PNG)"}</p>
              <input 
                type="file" 
                id="death-cert-upload" 
                style={{ display: 'none' }} 
                onChange={handleFileChange}
                accept=".pdf,.jpg,.jpeg,.png"
              />
            </div>
            <button 
              onClick={handleVerify}
              disabled={!file}
              style={{ 
                width: '100%',
                padding: '14px', 
                background: file ? '#667eea' : '#cbd5e0', 
                color: 'white', 
                border: 'none', 
                borderRadius: '8px', 
                cursor: file ? 'pointer' : 'not-allowed',
                fontWeight: '600',
                fontSize: '16px',
                transition: 'background 0.3s'
              }}
            >
              Verify and Execute Will
            </button>
          </div>
        )}

        {status === 'uploading' && (
          <div className="status-box">
             <i className="fas fa-spinner fa-spin fa-3x" style={{ color: '#667eea', marginBottom: '20px' }}></i>
             <p style={{ fontSize: '18px', fontWeight: '600' }}>Uploading Certificate... {progress}%</p>
             <p>Securing document transfer to verification engine.</p>
          </div>
        )}

        {(status === 'verifying' || (status === 'uploading' && progress === 100)) && (
          <div className="status-box">
             <i className="fas fa-shield-alt fa-3x fa-pulse" style={{ color: '#4c51bf', marginBottom: '20px' }}></i>
             <p style={{ fontSize: '18px', fontWeight: '600' }}>Verifying Authenticity...</p>
             <p>Our AI engine is checking the death certificate for validity. This might take 30-60 seconds.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="status-box">
             <i className="fas fa-check-circle fa-4x" style={{ color: '#48bb78', marginBottom: '20px' }}></i>
             <h3 style={{ color: '#2f855a' }}>✅ Verification Successful!</h3>
             <p>The death certificate has been verified. The Digital Will has been executed on-chain.</p>
             <div style={{ background: '#f0fff4', border: '1px solid #c6f6d5', padding: '15px', borderRadius: '8px', margin: '20px 0' }}>
                <p style={{ margin: 0, fontSize: '14px', color: '#2f855a' }}>
                  <strong>Next Step:</strong> The will has been executed. Check your inbox for the <strong>Claim My Rewards</strong> email to receive your assets.
                </p>
             </div>
             <button 
               onClick={() => onNavigate('dashboard')}
               style={{ 
                 marginTop: '10px', 
                 padding: '12px 24px', 
                 background: '#667eea', 
                 color: 'white', 
                 border: 'none', 
                 borderRadius: '8px', 
                 cursor: 'pointer',
                 fontWeight: '600'
               }}
             >
               Go to Dashboard
             </button>
          </div>
        )}

        {status === 'error' && (
          <div className="status-box">
             <i className="fas fa-exclamation-triangle fa-4x" style={{ color: '#e53e3e', marginBottom: '20px' }}></i>
             <h3 style={{ color: '#c53030' }}>Verification Failed</h3>
             <p style={{ color: '#718096' }}>{error}</p>
             <button 
               onClick={() => setStatus('idle')}
               style={{ 
                 marginTop: '30px', 
                 padding: '12px 24px', 
                 background: '#718096', 
                 color: 'white', 
                 border: 'none', 
                 borderRadius: '8px', 
                 cursor: 'pointer',
                 fontWeight: '600'
               }}
             >
               Try Again
             </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ReleaseWill;

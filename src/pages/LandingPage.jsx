import React from 'react';
import './LandingPage.css';

function LandingPage({ onNavigate }) {
  const openDashboard = () => {
    onNavigate ? onNavigate('dashboard') : window.location.href = '/dashboard.html';
  };

  const openDigitalWills = () => {
    onNavigate ? onNavigate('will') : window.location.href = '/wills.html';
  };

  return (
    <div className="landing-page">
      {/* Hero Section */}
      <section id="home" className="hero">
        <div className="hero-container">
          <div className="hero-content">
            <h2 className="hero-subtitle-top">Blockchain-Powered Security</h2>
            <h1 className="hero-title">
              <span className="secure">Secure</span> your legacy with <span className="brand">Trust Chain</span>
            </h1>
            <h5 className="hero-subtitle">
              The blockchain-based platform for digital wills, secure document storage, and verification.
            </h5>
          </div>
          <div className="hero-visual">
            <div className="hero-features">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <h3>Blockchain Secured</h3>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🤖</div>
                <h3>AI Verification</h3>
              </div>
              <div className="feature-item">
                <div className="feature-icon">💾</div>
                <h3>IPFS Storage</h3>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features">
        <div className="container">
          <div className="section-header">
            <h2>Features</h2>
            <p>Complete Digital Asset Protection</p>
            <p>TrustChain combines blockchain technology with AI-powered verification to provide the most secure platform for your digital legacy.</p>
          </div>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">📜</div>
              <h3>Digital Wills</h3>
              <p>Create legally-binding digital wills with smart contracts that execute automatically based on predefined conditions.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">💾</div>
              <h3>IPFS Storage</h3>
              <p>Documents are stored securely using IPFS with hashes recorded on the blockchain for permanent, tamper-proof storage.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🤖</div>
              <h3>AI Verification</h3>
              <p>Machine learning models analyze document features to predict authenticity before storing in the system.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🔗</div>
              <h3>Blockchain Security</h3>
              <p>Every action is recorded on the blockchain ensuring immutability, transparency, and audit-ready records.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">⚡</div>
              <h3>Smart Contracts</h3>
              <p>Automated execution of digital wills using smart contracts ensures proper transfer of assets.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">👁️</div>
              <h3>Full Transparency</h3>
              <p>Track every document action with complete audit trails visible to authorized parties.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Process Section */}
      <section className="process">
        <div className="container">
          <div className="section-header">
            <h2>Process</h2>
            <p>How TrustChain Works</p>
            <p>A simple four-step process to secure your digital assets forever.</p>
          </div>
          <div className="process-steps">
            <div className="process-step">
              <div className="step-number">1</div>
              <div className="step-content">
                <h3>01</h3>
                <h4>Upload Document</h4>
                <p>Upload your document or create a digital will through our secure interface.</p>
              </div>
            </div>
            <div className="process-step">
              <div className="step-number">2</div>
              <div className="step-content">
                <h3>02</h3>
                <h4>AI Verification</h4>
                <p>Our ML model analyzes document features including ID, name, and details to verify authenticity.</p>
              </div>
            </div>
            <div className="process-step">
              <div className="step-number">3</div>
              <div className="step-content">
                <h3>03</h3>
                <h4>Blockchain Storage</h4>
                <p>Verified documents are stored on IPFS with hashes recorded on the blockchain.</p>
              </div>
            </div>
            <div className="process-step">
              <div className="step-number">4</div>
              <div className="step-content">
                <h3>04</h3>
                <h4>Secure & Immutable</h4>
                <p>Your documents are now permanently secured with full transparency and audit trails.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <div className="footer-content">
            <div className="footer-brand">
              <h3><span className="brand">Trust Chain</span></h3>
              <p>Blockchain-powered security for your digital legacy.</p>
            </div>
            <div className="footer-links">
              <div className="footer-section">
                <h4>Platform</h4>
                <ul>
                  <li><button className="footer-link" onClick={openDashboard}>Dashboard</button></li>
                  <li><button className="footer-link" onClick={openDigitalWills}>Digital Wills</button></li>
                </ul>
              </div>
              <div className="footer-section">
                <h4>Resources</h4>
                <ul>
                  <li><button className="footer-link">Documentation</button></li>
                  <li><button className="footer-link">API Reference</button></li>
                  <li><button className="footer-link">Blockchain Explorer</button></li>
                </ul>
              </div>
              <div className="footer-section">
                <h4>Legal</h4>
                <ul>
                  <li><button className="footer-link">Privacy Policy</button></li>
                  <li><button className="footer-link">Terms of Service</button></li>
                  <li><button className="footer-link">Security</button></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="footer-bottom"></div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
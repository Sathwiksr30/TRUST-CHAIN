import React, { useState, useEffect } from 'react';
import {
  connectMetaMask,
  disconnectMetaMask,
  getStoredWalletAddress,
  shortenAddress,
} from '../utils/wallet';

function Navbar({ onNavigate, currentView }) {
  const [user, setUser] = useState(null);
  const [showEmail, setShowEmail] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    // Check if user is logged in
    const checkUser = () => {
      const stored = getStoredWalletAddress();
      setUser(stored || null);
    };

    checkUser();

    // Listen for storage changes across tabs
    const handleStorageChange = (e) => {
      if (e.key === 'trustchain_user' || e.key === 'trustchain_logged_in') {
        checkUser();
      }
    };

    // Also check on window focus
    const handleFocus = () => {
      checkUser();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleFocus);

    // Poll every second to catch changes immediately
    const interval = setInterval(checkUser, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, []);

  const handleSignOut = async () => {
    await disconnectMetaMask();
    setUser(null);
    onNavigate('home');
  };

  const handleConnectWallet = async () => {
    setConnecting(true);
    try {
      const account = await connectMetaMask({ requireHardhat: true });
      setUser(account);
      onNavigate('home');
    } catch (error) {
      console.error("MetaMask connection error:", error);
      alert(error?.message || 'MetaMask connection failed.');
    } finally {
      setConnecting(false);
    }
  };

  const handleUserIconClick = () => {
    setShowEmail(!showEmail);
  };

  return (
    <nav className="navbar">
      <div className="nav-container">
        <div className="nav-logo">
          <h2><span className="brand">Trust Chain</span></h2>
        </div>
        
        <div className="nav-links">
          <button className={currentView === 'home' ? 'nav-btn nav-home-btn active' : 'nav-btn nav-home-btn'} onClick={() => onNavigate && onNavigate('home')}><i className="fas fa-home"></i> Home</button>
          {user && (
            <>
              <button className={currentView === 'dashboard' ? 'nav-btn nav-desktop-only active' : 'nav-btn nav-desktop-only'} onClick={() => onNavigate && onNavigate('dashboard')}><i className="fas fa-tachometer-alt"></i> Dashboard</button>
              <button className={currentView === 'will' ? 'nav-btn nav-desktop-only active' : 'nav-btn nav-desktop-only'} onClick={() => onNavigate && onNavigate('will')}><i className="fas fa-scroll"></i> Digital Wills</button>
              <button className={(currentView === 'documents' || currentView === 'view') ? 'nav-btn nav-desktop-only active' : 'nav-btn nav-desktop-only'} onClick={() => onNavigate && onNavigate('documents')}><i className="fas fa-file-upload"></i> Upload & Verify</button>
            </>
          )}
          <div className="nav-auth nav-connect-wrap">
            {user ? (
              <>
                <div style={{position: 'relative', display: 'flex', alignItems: 'center'}}>
                  <div className="user-icon-container" onClick={handleUserIconClick} title={user} style={{cursor: 'pointer'}}>
                    {showEmail ? <span style={{fontSize: '14px', color: '#667eea', fontWeight: '600'}}>{user}</span> : <span style={{fontSize: '14px', color: '#667eea', fontWeight: '700'}}>{shortenAddress(user)}</span>}
                  </div>
                </div>
                <button className="nav-btn logout-btn" onClick={handleSignOut}><i className="fas fa-sign-out-alt"></i> Sign Out</button>
              </>
            ) : (
              <>
                <button className={currentView === 'connect' ? 'nav-btn nav-connect-btn active' : 'nav-btn nav-connect-btn signin-btn'} onClick={handleConnectWallet} disabled={connecting}><i className="fas fa-wallet"></i> {connecting ? 'Connecting...' : <><span className="connect-label-desktop">Connect MetaMask</span><span className="connect-label-mobile">Connect Wallet</span></>}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;

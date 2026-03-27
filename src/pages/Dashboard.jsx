import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import { syncWillStatuses } from '../utils/willStatusSync';

const API_BASE = process.env.REACT_APP_BACKEND_URL || `http://${window.location.hostname}:5000`;
const STORAGE_KEY = 'trustchain_documents';

function Dashboard({ onNavigate }) {
  const [documents, setDocuments] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);

  // Check if user is logged in
  const currentUser = localStorage.getItem('trustchain_user') || null;

  useEffect(() => {
    // Redirect to wallet connect if not logged in
    if (!currentUser) {
      onNavigate('home');
      return;
    }

    setIsLoading(false);
  }, [currentUser, onNavigate]);

  // Load documents from localStorage when component mounts or when viewing dashboard
  useEffect(() => {
    if (!currentUser) return;

    let isMounted = true;

    const loadDocuments = async () => {
      const synced = await syncWillStatuses(API_BASE, currentUser);
      if (!isMounted) return;
      setDocuments(synced);
    };

    loadDocuments();

    // Refresh documents when the window gains focus
    window.addEventListener('focus', loadDocuments);

    // Poll for changes every 2 seconds to catch real-time updates
    const interval = setInterval(loadDocuments, 15000);

    return () => {
      isMounted = false;
      window.removeEventListener('focus', loadDocuments);
      clearInterval(interval);
    };
  }, [currentUser]);

  if (isLoading) {
    return (
      <div className="dashboard-page">
        <main className="dashboard-main">
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <i className="fas fa-spinner fa-spin" style={{ fontSize: '40px', color: '#667eea' }}></i>
            <p style={{ marginTop: '20px', color: '#666' }}>Loading dashboard...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  const userDocs = documents;

  const total = userDocs.length;
  const verified = userDocs.filter(d => d.status && d.status.toLowerCase() === 'verified').length;
  const pending = userDocs.filter(d => d.status && d.status.toLowerCase() === 'pending').length;
  const wills = userDocs.filter(d => d.type && d.type.toLowerCase() === 'will').length;

  const filtered = userDocs.filter(doc => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      String(doc.name || '').toLowerCase().includes(term) ||
      String(doc.id || '').toLowerCase().includes(term) ||
      (doc.description || '').toLowerCase().includes(term)
    );
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every((doc) => selectedIds.includes(doc.id));

  const toggleSelectOne = (docId) => {
    setSelectedIds((prev) => (
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    ));
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredIdSet = new Set(filtered.map((doc) => doc.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredIdSet.has(id)));
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      filtered.forEach((doc) => next.add(doc.id));
      return Array.from(next);
    });
  };

  const deleteSelectedDocuments = () => {
    if (selectedIds.length === 0) return;

    const selectedSet = new Set(selectedIds);
    const nextDocuments = documents.filter((doc) => !selectedSet.has(doc.id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextDocuments));
    setDocuments(nextDocuments);
    setSelectedIds([]);
  };

  // Removed handleClaim - claims are now handled on the dedicated ClaimPage via email link

  return (
    <div className="dashboard-page">
      <main className="dashboard-main">
        {/* Header: title and subtitle on left side */}
        <header className="dashboard-header">
          <div className="header-content">
            <h1 className="dashboard-title">Dashboard</h1>
            <p className="dashboard-subtitle">
              Manage your documents and digital wills
            </p>
          </div>
        </header>

        {/* Top stats row – centered row like screenshot */}
        <section className="stats-row">
          <div className="stat-card">
            <div>
              <p className="stat-label">Total Documents</p>
              <p className="stat-value">{total}</p>
            </div>
            <div className="stat-icon">
              <i className="fas fa-file-alt" />
            </div>
          </div>

          <div className="stat-card">
            <div>
              <p className="stat-label">Verified</p>
              <p className="stat-value">{verified}</p>
            </div>
            <div className="stat-icon">
              <i className="fas fa-check" />
            </div>
          </div>

          <div className="stat-card">
            <div>
              <p className="stat-label">Pending</p>
              <p className="stat-value">{pending}</p>
            </div>
            <div className="stat-icon">
              <i className="fas fa-clock" />
            </div>
          </div>

          <div className="stat-card">
            <div>
              <p className="stat-label">Digital Wills</p>
              <p className="stat-value">{wills}</p>
            </div>
            <div className="stat-icon">
              <i className="fas fa-shield-alt" />
            </div>
          </div>
        </section>

        {/* Documents panel */}
        <section className="documents-section">
          <div className="documents-header">
            <h2>Your Documents</h2>
            <div className="search-wrap">
              <div className="search-input-wrap">
                <i className="fas fa-search search-prefix" />
                <input
                  type="text"
                  placeholder="Search documents..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              <button className="filter-button">
                <i className="fas fa-filter" />
              </button>
            </div>
          </div>

          <div className="documents-actions-row">
            <button
              className="delete-selected-btn"
              onClick={deleteSelectedDocuments}
              disabled={selectedIds.length === 0}
            >
              <i className="fas fa-trash"></i> Delete Selected ({selectedIds.length})
            </button>
            <label className="select-all-label">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAllFiltered}
              />
              <span>Select all</span>
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <i className="far fa-file-alt" />
              </div>
              <h3>No documents yet</h3>
              <p>
                Your verified documents will appear here once
                you upload and verify them.
              </p>
            </div>
          ) : (
            <div className="documents-list">
              {filtered.map(doc => (
                <div key={doc.id} className="document-item">
                  <div className="document-main-col">
                    <div className="document-name">{doc.name}</div>
                    <div className="document-meta">
                      {doc.type || 'Document'} • {doc.uploadDate}
                    </div>
                  </div>
                    <div className="document-right-actions">
                      {doc.status && (
                        <span className={`status ${doc.status.toLowerCase()}`}>
                          {doc.status}
                        </span>
                      )}
                      
                      {/* Action buttons removed - now driven by email links */}


                      <div className="document-select-col">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(doc.id)}
                          onChange={() => toggleSelectOne(doc.id)}
                        />
                      </div>
                    </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Simple footer (unchanged structure) */}
      <footer className="dashboard-footer">
        <div className="footer-inner">
          <div className="footer-left">
            <span className="footer-logo">TrustChain</span>
            <span className="footer-text">
              Blockchain-powered security for your digital legacy.
            </span>
          </div>
          <div className="footer-right"></div>
        </div>
      </footer>
    </div>
  );
}

export default Dashboard;

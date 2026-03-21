import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './ViewDocuments.css';
import { toIndiaDateString } from '../utils/timezone';

const configuredBackendUrl = (
  process.env.REACT_APP_BACKEND_URL ||
  process.env.REACT_APP_API_BASE_URL ||
  ''
).trim();
const API_BASE = (configuredBackendUrl || `http://${window.location.hostname}:5000`).replace(/\/$/, '');
const STORAGE_KEY = 'trustchain_documents';

function ViewDocuments({ onNavigate }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    file: null,
    name: '',
    type: '',
    description: ''
  });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');

  const currentUser = localStorage.getItem('trustchain_user') || null;

  useEffect(() => {
    if (!currentUser) {
      onNavigate('home');
      return;
    }
    loadDocuments();
  }, [currentUser, onNavigate]);

  const loadDocuments = () => {
    setLoading(true);

    const storedDocs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const verificationOnlyDocs = storedDocs.filter((doc) => {
      const type = String(doc?.type || '').toLowerCase();
      return type !== 'will';
    });
    setDocuments(verificationOnlyDocs);
    setTimeout(() => setLoading(false), 300);
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setUploadForm((prev) => ({
      ...prev,
      file: selectedFile,
      name: selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, '') : ''
    }));
  };

  const handleUploadInputChange = (e) => {
    const { name, value } = e.target;
    setUploadForm((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const parseConfidence = (value) => {
    if (!value) return 0;
    const n = Number(String(value).replace('%', '').trim());
    return Number.isFinite(n) ? n : 0;
  };

  const formatFileSize = (sizeValue) => {
    if (sizeValue === null || sizeValue === undefined || sizeValue === '') return '-';
    if (typeof sizeValue === 'string' && sizeValue.toLowerCase().includes('kb')) return sizeValue;
    const bytes = Number(sizeValue);
    if (!Number.isFinite(bytes)) return String(sizeValue);
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const buildPreviewUrl = (doc) => {
    if (!doc?.ipfsCid) return '';
    // Use preview endpoint that extracts text from Office docs
    return `${API_BASE}/api/ipfs/preview/${doc.ipfsCid}`;
  };

  const handlePreviewOnIpfs = (doc) => {
    // Always show preview in modal
    setPreviewUrl(buildPreviewUrl(doc));
  };

  const handleDownloadDocument = (doc) => {
    if (!doc?.ipfsCid) return;
    // Use download endpoint to force file download
    const link = document.createElement('a');
    link.href = `${API_BASE}/api/ipfs/download/${doc.ipfsCid}`;
    link.download = doc.fileName || 'document';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleQuickUpload = async (e) => {
    e.preventDefault();

    if (!uploadForm.file) {
      setUploadStatus('Please select a file to upload.');
      return;
    }

    const fileName = uploadForm.file.name.toLowerCase();
    if (!fileName.endsWith('.pdf') && !fileName.endsWith('.docx')) {
      setUploadStatus('Only PDF and DOCX files are supported.');
      return;
    }

    if (!uploadForm.description || !uploadForm.description.trim()) {
      setUploadStatus('Please enter a document description.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStatus('Starting ML verification...');

    try {
      const formData = new FormData();
      formData.append('document', uploadForm.file);

      const resp = await axios.post(`${API_BASE}/verify`, formData, {
        headers: {
          'x-api-key': 'trustchain_dummy_key',
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || progressEvent.loaded || 1;
          const percent = Math.round((progressEvent.loaded * 100) / total);
          setUploadProgress(percent);
          setUploadStatus(`Uploading... ${percent}%`);
        }
      });

      const data = resp.data;
      const confidence = parseConfidence(data.verification?.confidence);
      const normalizedStatus = data.status === 'VERIFIED' ? 'Verified' : 'Rejected';
      const uploadDate = data.uploadTime ? toIndiaDateString(data.uploadTime) : toIndiaDateString();
      const txHash = data.blockchain?.transactionHash || '-';
      const cid = data.ipfs?.cid || '';
      const ipfsLink = cid ? `${API_BASE}/api/ipfs/preview/${cid}` : '';

      const newDocument = {
        id: data.documentId || `DOC-${Date.now()}`,
        name: uploadForm.name,
        type: uploadForm.type,
        description: uploadForm.description,
        uploadDate,
        owner: currentUser || data.blockchain?.owner || uploadForm.file.name,
        status: normalizedStatus,
        authenticity: confidence,
        classification: data.verification?.classification || '-',
        verificationMessage: data.message || '',
        processingTime: data.processingTime || '-',
        sha256Hash: data.sha256Hash || '-',
        hash: txHash,
        ipfsCid: cid,
        ipfsLink,
        blockchainStored: Boolean(data.blockchain?.stored),
        blockNumber: data.blockchain?.blockNumber || '-',
        fileName: data.fileName || uploadForm.file.name,
        fileSize: data.fileSize || uploadForm.file.size,
        flow: Array.isArray(data.flow) ? data.flow : []
      };

      const existingDocs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const updatedDocs = [...existingDocs, newDocument];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedDocs));

      const verificationOnlyDocs = updatedDocs.filter((doc) => {
        const type = String(doc?.type || '').toLowerCase();
        return type !== 'will';
      });
      setDocuments(verificationOnlyDocs);

      if (normalizedStatus === 'Verified') {
        setUploadStatus('Document verified and added successfully!');
      } else {
        setUploadStatus('Document uploaded but rejected by ML verification.');
      }

      setTimeout(() => {
        setShowUploadModal(false);
        setUploadForm({ file: null, name: '', type: '', description: '' });
        setUploadStatus('');
        setUploadProgress(0);
      }, 1200);
    } catch (error) {
      console.error(error);
      const serverMessage = error?.response?.data?.message || error?.response?.data?.error;
      const statusCode = error?.response?.status;
      if (serverMessage) {
        setUploadStatus(`Upload failed: ${serverMessage}`);
      } else if (!error?.response) {
        setUploadStatus(`Upload failed: Cannot reach backend at ${API_BASE}. Ensure backend is running.`);
      } else {
        setUploadStatus(`Upload failed${statusCode ? ` (${statusCode})` : ''}. Please try again.`);
      }
    } finally {
      setUploading(false);
    }
  };

  const filteredDocuments = documents.filter((doc) => {
    const matchesFilter = filter === 'all' || doc.type === filter;
    const matchesSearch = doc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (doc.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const closeUploadModal = () => {
    setShowUploadModal(false);
    setUploadForm({ file: null, name: '', type: '', description: '' });
    setUploadStatus('');
    setUploadProgress(0);
  };

  const closeModal = () => {
    setSelectedDocument(null);
    setPreviewUrl('');
  };

  const getTypeColor = (type) => {
    const colors = {
      will: '#e3f2fd',
      contract: '#f3e5f5',
      certificate: '#e8f5e8',
      id: '#fff3e0',
      legal: '#fce4ec',
      financial: '#e0f2f1',
      other: '#f5f5f5'
    };
    return colors[type] || colors.other;
  };

  const getTypeIcon = (type) => {
    const icons = {
      will: '📄',
      contract: '📋',
      certificate: '🏆',
      id: '🆔',
      legal: '⚖️',
      financial: '💰',
      other: '📎'
    };
    return icons[type] || icons.other;
  };

  if (loading) {
    return (
      <div className="page view-container">
        <h2>Loading Your TrustChain Documents...</h2>
        <div className="loading-spinner"></div>
        <p>Retrieving verified documents from secure storage...</p>
      </div>
    );
  }

  return (
    <div className="page view-container">
      <div className="header-section">
        <h2>Your TrustChain Documents</h2>
        <p>View and manage your AI-verified documents stored securely on the blockchain.</p>
      </div>

      <div className="controls-section">
        <div className="search-filter">
          <input
            type="text"
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Types</option>
            <option value="contract">Contracts</option>
            <option value="certificate">Certificates</option>
            <option value="id">ID Documents</option>
            <option value="legal">Legal Documents</option>
            <option value="financial">Financial Documents</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="action-buttons">
          <button onClick={() => setShowUploadModal(true)} className="add-doc-btn">
            <span className="btn-icon">➕</span>
            Add Document
          </button>
          <div className="stats">
            <span className="stat-item">Total: {documents.length}</span>
            <span className="stat-item">Verified: {documents.filter((d) => d.status === 'Verified').length}</span>
          </div>
        </div>
      </div>

      {filteredDocuments.length === 0 ? (
        <div className="no-documents">
          <div className="no-docs-icon">📂</div>
          <h3>No documents found</h3>
          <p>{searchTerm || filter !== 'all' ? 'Try adjusting your search or filter criteria.' : 'Start by adding your first document.'}</p>
          {!searchTerm && filter === 'all' && (
            <button onClick={() => setShowUploadModal(true)} className="upload-redirect-btn">
              <span className="btn-icon">📤</span>
              Add Your First Document
            </button>
          )}
        </div>
      ) : (
        <div className="documents-grid">
          {filteredDocuments.map((doc) => (
            <div key={doc.id} className="document-card hover-lift interactive-card" onClick={() => setSelectedDocument(doc)}>
              <div className="document-header">
                <div className="doc-icon-type">
                  <span className="doc-icon">{getTypeIcon(doc.type)}</span>
                  <span className="doc-type" style={{ backgroundColor: getTypeColor(doc.type) }}>
                    {doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}
                  </span>
                </div>
                <span className={`status-badge ${String(doc.status).toLowerCase()}`}>
                  {doc.status}
                </span>
              </div>

              <div className="document-content">
                <h3 className="doc-title">{doc.name}</h3>
                <p className="doc-id">ID: {doc.id}</p>
                <p className="doc-description">{doc.description || 'No description provided'}</p>
              </div>

              <div className="document-footer">
                <div className="doc-meta">
                  <span className="upload-date">📅 {doc.uploadDate}</span>
                  <span className="authenticity-score">✓ {doc.authenticity || 0}%</span>
                </div>
                <button className="view-details-btn">View Details</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showUploadModal && (
        <div className="modal-overlay" onClick={closeUploadModal}>
          <div className="modal-content upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-section">
                <span className="modal-icon">📤</span>
                <div>
                  <h3>Add New Document</h3>
                  <p className="modal-subtitle">Upload and verify a document to add to your TrustChain</p>
                </div>
              </div>
              <button onClick={closeUploadModal} className="close-btn">&times;</button>
            </div>

            <form onSubmit={handleQuickUpload} className="upload-form-modal">
              <div className="form-group">
                <label htmlFor="upload-file">Select Document File:</label>
                <div className="file-input-wrapper">
                  <input
                    type="file"
                    id="upload-file"
                    onChange={handleFileChange}
                    accept=".pdf,.docx"
                    required
                    className="file-input"
                  />
                  <label htmlFor="upload-file" className="file-input-label">
                    <span className="file-icon">📎</span>
                    {uploadForm.file ? (
                      <div className="file-selected">
                        <span className="file-name">{uploadForm.file.name}</span>
                        <span className="file-size">({(uploadForm.file.size / 1024).toFixed(1)} KB)</span>
                      </div>
                    ) : (
                      'Choose file or drag & drop here...'
                    )}
                  </label>
                </div>
                {uploadForm.file && (
                  <div className="file-info">
                    <small>Size: {(uploadForm.file.size / 1024).toFixed(1)} KB</small>
                  </div>
                )}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="upload-name">📝 Document Name:</label>
                  <input
                    type="text"
                    id="upload-name"
                    name="name"
                    value={uploadForm.name}
                    onChange={handleUploadInputChange}
                    placeholder="Enter document name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="upload-type">🏷️ Document Type:</label>
                  <select
                    id="upload-type"
                    name="type"
                    value={uploadForm.type}
                    onChange={handleUploadInputChange}
                    required
                  >
                    <option value="">Select type</option>
                    <option value="contract">📄 Contract</option>
                    <option value="certificate">🎓 Certificate</option>
                    <option value="id">🆔 ID Document</option>
                    <option value="legal">⚖️ Legal Document</option>
                    <option value="financial">💰 Financial Document</option>
                    <option value="other">📂 Other</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="upload-description">💬 Description:</label>
                <textarea
                  id="upload-description"
                  name="description"
                  value={uploadForm.description}
                  onChange={handleUploadInputChange}
                  placeholder="Enter document description"
                  rows="3"
                  required
                />
              </div>

              {uploading && (
                <div className="upload-progress">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${uploadProgress}%` }}></div>
                  </div>
                  <p className="progress-text">{uploadStatus}</p>
                </div>
              )}

              {uploadStatus && !uploading && (
                <div className={`upload-result ${uploadStatus.includes('successfully') ? 'success' : 'error'}`}>
                  <p>{uploadStatus}</p>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" onClick={closeUploadModal} className="btn btn-tertiary">
                  <i className="fas fa-times"></i> Cancel
                </button>
                <button type="submit" disabled={uploading} className="btn btn-primary">
                  <i className="fas fa-upload"></i> {uploading ? 'Verifying...' : 'Upload & Verify'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedDocument && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-section">
                <span className="modal-icon">{getTypeIcon(selectedDocument.type)}</span>
                <div>
                  <h3>{selectedDocument.name}</h3>
                  <p className="modal-subtitle">Document ID: {selectedDocument.id}</p>
                </div>
              </div>
              <button onClick={closeModal} className="close-btn">&times;</button>
            </div>

            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-section">
                  <h4>Document Information</h4>
                  <div className="detail-row"><strong>Type:</strong> {selectedDocument.type}</div>
                  <div className="detail-row"><strong>Upload Date:</strong> {selectedDocument.uploadDate}</div>
                  <div className="detail-row"><strong>Status:</strong> <span className={`status-badge ${String(selectedDocument.status).toLowerCase()}`}>{selectedDocument.status}</span></div>
                  <div className="detail-row"><strong>File Name:</strong> {selectedDocument.fileName}</div>
                  <div className="detail-row"><strong>File Size:</strong> {formatFileSize(selectedDocument.fileSize)}</div>
                  <div className="detail-row"><strong>Description:</strong> {selectedDocument.description}</div>
                </div>

                <div className="detail-section">
                  <h4>AI Verification Results</h4>
                  <div className="verification-results">
                    <div className="authenticity-meter">
                      <div className="meter-label">
                        <span>Authenticity Score</span>
                        <span className="score">{selectedDocument.authenticity || 0}%</span>
                      </div>
                      <div className="meter-bar">
                        <div className="meter-fill" style={{ width: `${selectedDocument.authenticity || 0}%` }}></div>
                      </div>
                    </div>
                    <div className="verification-note">
                      <span className="verified-icon">✓</span>
                      {selectedDocument.status === 'Verified'
                        ? 'This document has been verified using advanced AI/ML analysis and is confirmed authentic.'
                        : 'This document was rejected by ML verification.'}
                    </div>
                    <div className="detail-row" style={{ marginTop: '10px' }}><strong>Classification:</strong> {selectedDocument.classification || '-'}</div>
                    <div className="detail-row"><strong>Message:</strong> {selectedDocument.verificationMessage || '-'}</div>
                    <div className="detail-row"><strong>Processing Time:</strong> {selectedDocument.processingTime || '-'}</div>
                  </div>
                </div>

                <div className="detail-section">
                  <h4>Blockchain & Storage</h4>
                  <div className="detail-row"><strong>SHA-256:</strong> <span className="hash-text">{selectedDocument.sha256Hash || '-'}</span></div>
                  <div className="detail-row"><strong>Transaction Hash:</strong> <span className="hash-text">{selectedDocument.hash || '-'}</span></div>
                  <div className="detail-row"><strong>Block Number:</strong> {selectedDocument.blockNumber || '-'}</div>
                  <div className="detail-row"><strong>IPFS CID:</strong> <span className="hash-text">{selectedDocument.ipfsCid || '-'}</span></div>
                  <div className="detail-row">
                    <strong>IPFS Link:</strong>
                    {selectedDocument.ipfsCid ? (
                      <button type="button" className="ipfs-link" onClick={() => { handlePreviewOnIpfs(selectedDocument); }}>
                        View on IPFS ↗
                      </button>
                    ) : (
                      <span>-</span>
                    )}
                  </div>
                  {previewUrl && (
                    <div className="detail-row">
                      <iframe
                        title="IPFS Document Preview"
                        src={previewUrl}
                        style={{ width: '100%', height: '420px', border: '1px solid #ddd', borderRadius: '8px' }}
                      />
                    </div>
                  )}
                </div>

                <div className="detail-section">
                  <h4>Verification Flow</h4>
                  {Array.isArray(selectedDocument.flow) && selectedDocument.flow.length > 0 ? (
                    <div className="storage-info">
                      <ul>
                        {selectedDocument.flow.map((step) => (
                          <li key={step.step}>
                            <strong>{step.step}. {step.name}</strong> - {step.status}
                            {step.error ? ` | Error: ${step.error}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="detail-row">No flow details available.</div>
                  )}
                </div>
              </div>

              <div className="modal-actions">
                <button onClick={() => handleDownloadDocument(selectedDocument)} className="btn btn-primary" disabled={!selectedDocument.ipfsCid}>
                  <i className="fas fa-download"></i> Download Document
                </button>
                <button onClick={closeModal} className="btn btn-tertiary">
                  <i className="fas fa-times"></i> Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ViewDocuments;

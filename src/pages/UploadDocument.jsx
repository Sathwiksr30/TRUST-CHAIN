import React, { useState, useEffect } from "react";
import axios from "axios";
import './UploadDocument.css';
import { toIndiaDateString } from '../utils/timezone';

const API_BASE = (
  process.env.REACT_APP_API_BASE_URL ||
  process.env.REACT_APP_BACKEND_URL ||
  "http://localhost:5000"
).replace(/\/$/, "");

const UploadDocument = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [backendConnected, setBackendConnected] = useState(true);
  const [verificationData, setVerificationData] = useState(null);

  // Check backend connectivity on mount
  useEffect(() => {
    const checkBackend = async () => {
      try {
        await axios.get(`${API_BASE}/dashboard`, {
          headers: { "x-api-key": "trustchain_dummy_key" },
          timeout: 3000
        });
        setBackendConnected(true);
      } catch (error) {
        setBackendConnected(false);
        console.warn("Backend not accessible at", API_BASE);
      }
    };

    checkBackend();
  }, []);

  // Handle file selection
  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
    setResult("");
    setVerificationData(null);
  };

  // Verify document (connects to backend)
  const handleVerify = async () => {
    if (!selectedFile) {
      setResult("⚠ Please select a document first");
      return;
    }

    if (!backendConnected) {
      setResult(`✗ Backend not running at ${API_BASE}. Start it with: cd trustchain-backend && npm start`);
      return;
    }

    const formData = new FormData();
    formData.append("document", selectedFile);

    try {
      setLoading(true);
      setResult("Uploading document...");

      console.log("Uploading to:", `${API_BASE}/verify`);
      console.log("File:", selectedFile.name, selectedFile.type, selectedFile.size);

      const response = await axios.post(
        `${API_BASE}/verify`,
        formData,
        {
          headers: {
            "x-api-key": "trustchain_dummy_key",
            "Content-Type": "multipart/form-data"
          },
          timeout: 30000
        }
      );

      console.log("Upload response:", response.data);

      const data = response.data;
      setVerificationData(data);

      // Check response status
      if (data.status === "VERIFIED") {
        setResult(`✓ ${data.message}`);
        // Store document in localStorage
        const doc = {
          id: data.documentId || Date.now().toString(),
          name: selectedFile.name,
          type: "Document",
          status: "Verified",
          uploadDate: toIndiaDateString(),
          owner: localStorage.getItem('trustchain_user') || 'anonymous',
          path: data.file?.path,
          authenticity: data.verification?.confidence || 0,
          ipfsLink: data.ipfs?.cid ? `http://localhost:5000/api/ipfs/preview/${data.ipfs.cid}` : null
        };
        const stored = JSON.parse(localStorage.getItem('trustchain_documents') || '[]');
        stored.push(doc);
        localStorage.setItem('trustchain_documents', JSON.stringify(stored));
        setSelectedFile(null);
      } else if (data.status === "REJECTED") {
        setResult(`✗ ${data.message}`);
      } else {
        setResult("✗ Document verification failed. Please try again.");
      }
    } catch (error) {
      console.error("Upload/Verification Error:", error);
      console.error("Error details:", {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        data: error.response?.data
      });
      
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        setResult(`✗ Request timeout. Backend at ${API_BASE} is not responding.`);
      } else if (error.response) {
        // Backend responded with error
        const errorMsg = error.response.data?.error || error.response.data?.message || `Upload failed (Status: ${error.response.status})`;
        setResult(`✗ Error: ${errorMsg}`);
        if (error.response.data && typeof error.response.data === "object") {
          setVerificationData(error.response.data);
        }
      } else if (error.request) {
        // Request made but no response
        setResult(`✗ Cannot connect to backend at ${API_BASE}. Is it running? Start with: cd trustchain-backend && npm start`);
      } else {
        // Other errors
        setResult(`✗ Error: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-24 bg-white">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="bg-white/95 backdrop-blur-2xl border border-gray-100 rounded-3xl shadow-2xl p-12 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-64 h-64 bg-primary-100/20 rounded-full -ml-32 -mt-32"></div>

          <div className="relative">
            <h2 className="text-5xl font-black text-gray-900 text-center mb-3">Document Verification</h2>
            <p className="text-center text-gray-600 mb-10">
              Upload and verify any document type with our AI-powered authenticity verification system
            </p>

            {!backendConnected && (
              <div className="mb-8 bg-red-50 border-2 border-red-200 text-red-700 px-6 py-4 rounded-xl text-sm">
                <strong>⚠ Backend Not Running:</strong> Start the backend with:{" "}
                <code className="bg-red-100 px-2 py-1 rounded">cd trustchain-backend && npm start</code>
              </div>
            )}

            <div className="space-y-6">
              {/* File Upload Area */}
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center hover:border-primary-400 hover:bg-primary-50/30 transition-all duration-300">
                <div className="text-5xl mb-4">📁</div>
                <label htmlFor="file-input" className="cursor-pointer block">
                  <input
                    id="file-input"
                    type="file"
                    accept=".pdf,.docx"
                    onChange={handleFileChange}
                    disabled={!backendConnected}
                    className="hidden"
                  />
                  <div className="text-gray-700">
                    <p className="font-bold text-lg mb-2">
                      {selectedFile ? selectedFile.name : "Choose PDF or DOCX document"}
                    </p>
                    <p className="text-sm text-gray-600">
                      PDF or Word documents only • Drag and drop or click
                    </p>
                  </div>
                </label>
              </div>

              {/* Verify Button */}
              <button
                onClick={handleVerify}
                disabled={loading || !backendConnected || !selectedFile}
                className="w-full bg-gradient-to-r from-primary-500 to-secondary-500 text-white font-bold py-4 rounded-xl hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg"
              >
                {loading ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i>
                    Verifying...
                  </>
                ) : (
                  <>
                    <i className="fas fa-upload"></i>
                    Upload & Verify
                  </>
                )}
              </button>

              {/* Result Message */}
              {result && (
                <div
                  className={`p-6 rounded-xl border-2 flex items-start gap-4 ${
                    result.includes('✓')
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  <div className="text-2xl mt-1">
                    {result.includes('✓') ? '✓' : '✗'}
                  </div>
                  <p className="text-sm leading-relaxed flex-1">{result}</p>
                </div>
              )}

              {/* Verification Details */}
              {verificationData && (
                <div className="mt-8 space-y-4">
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">📊 Verification Summary</h3>
                    <div className="space-y-2 text-sm text-gray-700">
                      <p><span className="font-semibold">Document ID:</span> {verificationData.documentId || "-"}</p>
                      <p><span className="font-semibold">Status:</span> <span className={verificationData.status === "VERIFIED" ? "text-green-600 font-bold" : "text-red-600 font-bold"}>{verificationData.status || "-"}</span></p>
                      <p><span className="font-semibold">Classification:</span> {verificationData.verification?.classification || "-"}</p>
                      <p><span className="font-semibold">Confidence:</span> {verificationData.verification?.confidence || "-"}</p>
                      <p><span className="font-semibold">Processing Time:</span> {verificationData.processingTime || "-"}</p>
                      <p><span className="font-semibold">Message:</span> {verificationData.message || "-"}</p>
                    </div>
                  </div>

                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">🔐 Storage & Blockchain</h3>
                    <div className="space-y-2 text-sm text-gray-700 break-all">
                      <p><span className="font-semibold">SHA-256 Hash:</span> {verificationData.sha256Hash || "-"}</p>
                      <p><span className="font-semibold">IPFS CID:</span> {verificationData.ipfs?.cid || "-"}</p>
                      <p><span className="font-semibold">Transaction Hash:</span> {verificationData.blockchain?.transactionHash || "-"}</p>
                      <p><span className="font-semibold">Block Number:</span> {verificationData.blockchain?.blockNumber || "-"}</p>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">📋 Verification Flow</h3>
                    {Array.isArray(verificationData.flow) && verificationData.flow.length > 0 ? (
                      <ul className="space-y-2 text-sm text-gray-700">
                        {verificationData.flow.map((step) => (
                          <li key={step.step}>
                            <span className="font-semibold">{step.step}. {step.name}</span> - {step.status}
                            {step.error ? ` | Error: ${step.error}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-500">No flow details available.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Info Cards */}
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { icon: '🔒', title: 'Secure', desc: 'End-to-end encrypted uploads' },
                { icon: '🤖', title: 'AI Verified', desc: 'Machine learning verification' },
                { icon: '⚡', title: 'Fast', desc: 'Instant verification results' }
              ].map((item, idx) => (
                <div key={idx} className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center hover:shadow-md transition-shadow">
                  <div className="text-4xl mb-3">{item.icon}</div>
                  <h4 className="font-bold text-gray-900 mb-2">{item.title}</h4>
                  <p className="text-sm text-gray-600">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadDocument;

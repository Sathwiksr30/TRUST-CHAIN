# TrustChain - Document Verification System

A blockchain-based document verification platform with ML-powered authenticity detection.

---

## ⚡ Setup (First Time Only)

Before running the project for the first time, copy the environment configuration:

```bash
# Copy the template config file
cp .env.example .env
```

Then install all dependencies:
```bash
npm install                 # Root & Frontend
cd trustchain-backend && npm install && cd ..
cd blockchain && npm install && cd ..
cd ml && pip install -r requirements.txt && cd ..
```

**For detailed setup instructions**, see [`.env.setup.md`](.env.setup.md)

---

## Quick Start

### 1) Start Backend (recommended resilient mode)
```bash
cd trustchain-backend
npm start
```
**This will automatically:**
- Start the Node.js backend server on port 5000
- Start/reuse local Hardhat blockchain on port 8545
- Initialize and start embedded Helia IPFS node
- Recover valid will schedules from blockchain records safely
- Automatically archive/remove stale old-chain will records so logs and dashboard stay clean

This is the only backend command you need for daily use:
```bash
cd trustchain-backend
npm start
```

### 2) Start Frontend
```bash
cd ..
npm start
```
**Frontend will run on:** http://localhost:3000

### 3) Optional: Start ML Service (real AI verification)
```bash
cd ml
python app.py
```
**ML service will run on:** http://localhost:5002

## Access Points

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **Health**: http://localhost:5000/health
- **ML Service**: http://localhost:5002

## Project Structure

```
TrustChain1/
├── src/                    # React frontend source code
│   ├── pages/              # Application pages
│   └── components/         # React components
├── public/                 # Static assets
├── trustchain-backend/     # Node.js backend server
│   └── uploads/            # Uploaded documents
├── ml/                     # Python ML service
│   ├── app.py              # Flask ML server
│   └── uploads/            # ML processing files
├── package.json            # Frontend dependencies
└── trustchain-backend/.env # Backend runtime configuration
```

## Features

- **Document Upload**: Upload PDF/DOCX documents
- **ML Verification**: Automatic authenticity detection
- **Auto-Starting IPFS**: Helia IPFS node starts automatically with backend
- **Blockchain**: Immutable transaction records
- **Real-time Results**: Instant verification feedback
- **Glass Design**: Modern glassmorphism UI

## Technology Stack

- **Frontend**: React 19
- **Backend**: Node.js + Express
- **ML Service**: Python + Flask
- **Storage**: IPFS
- **Blockchain**: Ethereum-compatible

# 🚀 TrustChain: Deployment & Data Update Guide

This guide provides step-by-step instructions on how to deploy the TrustChain platform and what to do when you make changes to your data or code.

---

## 🛠️ Part 1: Initial Deployment (First Time)

If you are setting up the project on a new machine or for the first time:

1.  **Configure Environment**:
    ```bash
    cp .env.example .env
    ```
2.  **Install All Dependencies**:
    ```bash
    # Root & Frontend
    npm install
    
    # Backend
    cd trustchain-backend && npm install && cd ..
    
    # Smart Contracts
    cd blockchain && npm install && cd ..
    
    # ML Service (ensure Python is installed)
    cd ml && pip install -r requirements.txt && cd ..
    ```

---

## 🔄 Part 2: What to do when you change Data?

Follow these steps based on what you have changed:

### 1. If you change ML Data (`ml/certificate_dataset.csv`)
If you add new certificates or modify the dataset:
1.  **Retrain the Model**:
    ```bash
    cd ml
    python train_model.py
    ```
    *This generates new `certificate_model.pkl` and `tfidf_vectorizer.pkl` files.*
2.  **Restart the ML Service**:
    *Stop the running `python app.py` (Ctrl+C) and start it again:*
    ```bash
    python app.py
    ```

### 2. If you change Smart Contracts (`blockchain/contracts/`)
If you modify the Solidity code:
1.  **Compile & Deploy**:
    ```bash
    cd blockchain
    npx hardhat run scripts/deploy.js --network localhost
    ```
2.  **Update Backend Config**:
    *Copy the new "Contract Address" from the terminal and update it in your `.env` file:*
    ```env
    DIGITAL_WILL_CONTRACT_ADDRESS=0xYourNewAddress...
    ```
3.  **Restart Backend**:
    *Go to `trustchain-backend` and restart `npm start`.*

### 3. If you change Backend Code (`trustchain-backend/server.js`)
If you change logic in the server:
1.  **Restart the Backend**:
    *Stop (Ctrl+C) and run:*
    ```bash
    cd trustchain-backend
    npm start
    ```

### 4. If you change Frontend Code (`src/` folder)
If you change the UI or React components:
1.  The frontend usually **auto-reloads** if it's running.
2.  If it doesn't, just refresh your browser (F5) or restart the terminal:
    ```bash
    npm start
    ```

---

## ⚡ Part 3: Daily Running Commands (Quick Start)

To start the whole project for testing every day, open 3 terminals:

*   **Terminal 1 (Blockchain & Backend)**:
    ```bash
    cd trustchain-backend
    npm start
    ```
*   **Terminal 2 (ML Service)**:
    ```bash
    cd ml
    python app.py
    ```
*   **Terminal 3 (Frontend)**:
    ```bash
    npm start
    ```

---

## 📝 Required Data Checklist for Success
When deploying, ensure your `.env` has these correctly:
- `BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545`
- `ML_SERVICE_URL=http://127.0.0.1:5002`
- `HARDHAT_CHAIN_ID_HEX=0x7a69`
- `DIGITAL_WILL_CONTRACT_ADDRESS` (Must match the one from `deploy.js`)

---

## 🌐 Part 4: Online Deployment (Pro)

To put your project online so anyone can access it, you need to use cloud services.

### 1. Deploy Smart Contract to Sepolia (Testnet)
1.  **Get a Provider URL**: Sign up at [Alchemy](https://www.alchemy.com/) or [Infura](https://www.infura.io/) and get a **Sepolia RPC URL**.
2.  **Add to `blockchain/.env`**:
    ```env
    SEPOLIA_RPC_URL=your_alchemy_url_here
    DEPLOYER_PRIVATE_KEY=your_metamask_private_key_here
    ```
3.  **Deploy**:
    ```bash
    cd blockchain
    npx hardhat run scripts/deploy.js --network sepolia
    ```
4.  **Save Address**: Copy the printed contract address.

### 2. Deploy Backend & ML to Render
1.  Create an account at [Render.com](https://render.com/).
2.  Create a **New Blueprints** project and connect your GitHub repository.
3.  Render will automatically see `render.yaml` and create two services: `trustchain-backend` and `trustchain-ml`.
4.  **Add Secret Environment Variables** in the Render Dashboard for `trustchain-backend`:
    - `BLOCKCHAIN_RPC_URL`: Your Sepolia RPC URL.
    - `DIGITAL_WILL_CONTRACT_ADDRESS`: The address from step 1.
    - `DIGITAL_WILL_OWNER_PRIVATE_KEY`: Your wallet private key.
    - `EMAIL_USER` / `EMAIL_PASS`: (Optional) For notifications.

### 3. Deploy Frontend (React) to Vercel
1.  **Preparation**: Ensure your code is pushed to a GitHub repository.
2.  **Import Project**:
    - Sign in to [Vercel.com](https://vercel.com/).
    - Click **"Add New"** > **"Project"**.
    - Import your `TRUST-CHAIN` repository.
3.  **Configure Build Settings**:
    - Vercel should automatically detect "Create React App".
    - **Build Command**: `npm run build`
    - **Output Directory**: `build`
4.  **CRITICAL: Set Environment Variables**:
    - Open the **"Environment Variables"** section before clicking deploy.
    - Add Key: `REACT_APP_BACKEND_URL`
    - Add Value: The URL of your live Render backend (e.g., `https://trustchain-backend.onrender.com`).
    *Why? This tells your React website exactly where to send document verification requests.*
5.  **Deploy**: Click **"Deploy"**.
6.  **Verify**:
    - Once finished, Vercel gives you a URL (e.g., `https://trust-chain.vercel.app`).
    - Open the site and try to connect your wallet.
    - **Note**: Your `vercel.json` file in the root directory is already configured to handle React Router navigation correctly on the web.

### 💻 Option: Deploy via Vercel CLI
If you prefer using the terminal (`cmd` or `powershell`):
1.  **Install CLI**: `npm install -g vercel`
2.  **Login**: `vercel login`
3.  **Link Project**: `vercel link`
4.  **Add Environment Variable**:
    ```bash
    vercel env add REACT_APP_BACKEND_URL production
    # Enter the URL of your live Render backend when prompted
    ```
5.  **Deploy to Production**:
    ```bash
    vercel --prod
    ```

### ⚠️ Common Frontend Fix: `CI=false`
If your Vercel build fails with the error "Treating warnings as errors because process.env.CI = true", do this:
1.  Go to Vercel Dashboard > **Settings** > **General**.
2.  In **Build & Development Settings**, change the **Build Command** to:
    ```bash
    CI=false npm run build
    ```
    *This ensures the build succeeds even if there are minor CSS lint warnings.*

---

## ✅ Deployment Success Checklist

- [ ] Contract deployed to Sepolia (Check Etherscan)
- [ ] Backend status is "Live" on Render
- [ ] ML Service status is "Live" on Render
- [ ] Frontend can connect to MetaMask on Vercel URL
- [ ] Document Upload works and communicates with the Render API


---

## 🔄 Part 5: Updating Your Online App

If you change your code or data after the project is already online:

### 1. For Code Changes (Frontend, Backend, or ML logic)
1.  **Commit and Push** your changes to GitHub:
    ```bash
    git add .
    git commit -m "Update: [your change description]"
    git push origin main
    ```
2.  **Auto-Deploy**: Render and Vercel will detect the push and automatically start building your new version. You can watch the progress in their dashboards.

### 2. For ML Data Changes (`ml/certificate_dataset.csv`)
1.  **Retrain Locally**: Run `python train_model.py` in the `ml` folder to update the `.pkl` files.
2.  **Push Everything**: Ensure you push the updated `.csv` AND the new `.pkl` files to GitHub.
3.  **Auto-Deploy**: Render will rebuild the ML service with the new model weights.

### 3. For Smart Contract Changes
1.  **Redeploy to Sepolia**:
    ```bash
    cd blockchain
    npx hardhat run scripts/deploy.js --network sepolia
    ```
2.  **Update Render Settings**:
    - Go to the **Render Dashboard**.
    - Select your `trustchain-backend` service.
    - Go to **Environment**.
    - Update `DIGITAL_WILL_CONTRACT_ADDRESS` with the new address.
    - Click **Save**. Render will restart the backend with the new contract.



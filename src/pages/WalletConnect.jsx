import React, { useMemo, useState } from "react";
import "./WalletConnect.css";
import {
  connectMetaMask,
  shortenAddress,
  getStoredWalletAddress,
} from "../utils/wallet";

function WalletConnect({ onConnected }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const existing = useMemo(() => getStoredWalletAddress(), []);

  const connectWallet = async () => {
    setError("");
    setConnecting(true);

    try {
      const account = await connectMetaMask({ requireHardhat: true });
      if (onConnected) {
        onConnected(account);
      }
    } catch (err) {
      const message = err?.message || "MetaMask connection failed.";
      if (message.toLowerCase().includes("localhost")) {
        setError(
          "MetaMask could not reach http://127.0.0.1:8545. Start Hardhat node and enable localhost access in MetaMask settings."
        );
      } else {
        setError(message);
      }
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="wallet-connect-page">
      <div className="wallet-connect-card">
        <h1>Connect MetaMask</h1>
        <p>
          TrustChain now uses wallet-based login. Connect your MetaMask account to continue.
        </p>

        {existing && (
          <div className="wallet-chip">Last wallet: {shortenAddress(existing)}</div>
        )}

        <button
          className="wallet-connect-btn"
          onClick={connectWallet}
          disabled={connecting}
        >
          {connecting ? "Connecting..." : "Connect MetaMask"}
        </button>

        {error && <div className="wallet-error">{error}</div>}

        <ul className="wallet-hints">
          <li>Required network: Hardhat Localhost (Chain ID 31337)</li>
          <li>Required RPC URL: http://127.0.0.1:8545</li>
          <li>Start node before opening app: npx hardhat node</li>
        </ul>
      </div>
    </div>
  );
}

export default WalletConnect;

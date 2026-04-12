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
      const account = await connectMetaMask({ requireNetwork: true });
      if (onConnected) {
        onConnected(account);
      }
    } catch (err) {
      const message = err?.message || "MetaMask connection failed.";
      if (message.toLowerCase().includes("re-connecting") || message.toLowerCase().includes("failed to connect")) {
        setError(
          "MetaMask is currently busy or re-connecting. Please wait a few seconds and try clicking 'Connect' again."
        );
      } else if (message.toLowerCase().includes("localhost")) {
        setError(
          "MetaMask could not reach the local node. Ensure your blockchain is running or check your internet."
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
          <li>Required network: Sepolia Testnet</li>
          <li>Unlock MetaMask before clicking connect</li>
          <li>If connection fails, refresh and try once more</li>
        </ul>
      </div>
    </div>
  );
}

export default WalletConnect;

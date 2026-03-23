import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import contractABI from '../abi/DigitalWill.json';

const CONTRACT_ADDRESS = "0x009B1e24Eb61B7B63DaFCC4bbDE86B17Ded48048";

function ReleaseWill({ willId, onNavigate }) {
  const [status, setStatus] = useState('initializing');
  const [error, setError] = useState(null);

  useEffect(() => {
    const triggerRelease = async () => {
      try {
        if (!window.ethereum) {
          throw new Error("MetaMask not found. Please open this link in a browser with MetaMask installed.");
        }

        setStatus('connecting');
        const provider = new ethers.BrowserProvider(window.ethereum);
        const network = await provider.getNetwork();
        
        console.log(`[RELEASE] Connecting to willId: ${willId} on chain: ${network.chainId}`);

        if (network.chainId !== 11155111n) {
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0xaa36a7' }], 
            });
          } catch (err) {
            throw new Error("Please switch your MetaMask to the Sepolia Testnet.");
          }
        }

        const signer = await provider.getSigner();
        const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI.abi, signer);

        setStatus('confirming');
        console.log(`[RELEASE] Executing executeWill("${willId}") on-chain...`);
        
        // --- Diagnostics: Gas Estimation ---
        // This helps identify reverts BEFORE sending the transaction
        let gasLimit;
        try {
          const estimatedGas = await contract.executeWill.estimateGas(willId);
          gasLimit = (estimatedGas * 12n) / 10n; // 20% buffer
          console.log(`[RELEASE] Estimated Gas: ${estimatedGas}, using Limit: ${gasLimit}`);
        } catch (estError) {
          console.error("[RELEASE] Gas estimation failed. Reverting?", estError);
          
          // Try to decode common revert reasons
          let reason = "The transaction would fail. ";
          if (estError.message.includes("ConditionNotMet")) reason = "Conditions not yet met. If this is a recent claim, please wait 30 seconds for the blockchain to synchronize and try again.";
          else if (estError.message.includes("NotAuthorized")) reason = "You are not authorized to release this will.";
          else if (estError.message.includes("WillAlreadyExecuted")) reason += "This will has already been executed.";
          else if (estError.message.includes("WillRevoked")) reason += "This will has been revoked.";
          else if (estError.message.includes("NoFundsAvailable")) reason += "No funds available in the will.";
          else reason += (estError.reason || estError.message || "Unknown reason");
          
          throw new Error(reason);
        }

        // --- Execute Transaction ---
        const tx = await contract.executeWill(willId, { gasLimit });
        console.log(`[RELEASE] Transaction sent: ${tx.hash}`);
        
        setStatus('pending');
        const receipt = await tx.wait();
        console.log(`[RELEASE] Transaction confirmed:`, receipt);

        if (receipt.status === 0) {
          throw new Error("Transaction execution failed on the blockchain.");
        }
        
        setStatus('success');
      } catch (err) {
        console.error("[RELEASE] Error:", err);
        setError(err.reason || err.message || "Execution failed. Check your network or wallet permissions.");
        setStatus('error');
      }
    };

    if (willId) {
      triggerRelease();
    } else {
      setError("No Will ID provided in the link.");
      setStatus('error');
    }
  }, [willId]);

  return (
    <div className="page release-will-page" style={{ padding: '60px 20px', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
      <div className="release-card" style={{ background: 'white', padding: '40px', borderRadius: '15px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
        <h2 style={{ color: '#2d3748', marginBottom: '20px' }}>TrustChain: Digital Asset Release</h2>
        
        {status === 'initializing' && <p>Preparing secure connection...</p>}
        {status === 'connecting' && <p>Connecting to Sepolia Blockchain...</p>}
        
        {status === 'confirming' && (
          <div className="status-box">
             <i className="fas fa-wallet fa-3x" style={{ color: '#667eea', marginBottom: '20px' }}></i>
             <p style={{ fontSize: '18px', fontWeight: '600' }}>Confirm Asset Release</p>
             <p>Please confirm the transaction in your <strong>MetaMask</strong> to receive the assets directly into your wallet.</p>
          </div>
        )}

        {status === 'pending' && (
          <div className="status-box">
             <i className="fas fa-spinner fa-spin fa-3x" style={{ color: '#667eea', marginBottom: '20px' }}></i>
             <p style={{ fontSize: '18px', fontWeight: '600' }}>Processing Distribution...</p>
             <p>The blockchain is verifying the asset transfer. This usually takes 10-20 seconds.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="status-box">
             <i className="fas fa-check-circle fa-4x" style={{ color: '#48bb78', marginBottom: '20px' }}></i>
             <h3 style={{ color: '#2f855a' }}>🎉 Inheritance Received!</h3>
             <p>The Digital Assets have been successfully transferred to your wallet.</p>
             <button 
               onClick={() => onNavigate('dashboard')}
               style={{ 
                 marginTop: '30px', 
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
             <h3 style={{ color: '#c53030' }}>Unable to Release Assets</h3>
             <p style={{ color: '#718096' }}>{error}</p>
             <button 
               onClick={() => window.location.reload()}
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

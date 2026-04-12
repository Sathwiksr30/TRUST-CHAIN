// Production: Sepolia Testnet | Development: Hardhat Localhost
const IS_PRODUCTION = process.env.REACT_APP_NETWORK === "sepolia";

const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111
const HARDHAT_CHAIN_ID_HEX = "0x7a69";   // 31337

const TARGET_CHAIN_ID_HEX = IS_PRODUCTION ? SEPOLIA_CHAIN_ID_HEX : HARDHAT_CHAIN_ID_HEX;

let connectInFlight = null;

function isMetaMaskConnectFailureMessage(message) {
  const msg = String(message || '').toLowerCase();
  return (
    msg.includes('failed to connect to metamask') ||
    (msg.includes('metamask') && msg.includes('failed to connect')) ||
    msg.includes('disconnected') ||
    msg.includes('provider disconnected')
  );
}

function normalizeMetaMaskError(error, fallbackMessage = 'MetaMask connection failed. Open MetaMask, unlock it, and retry.') {
  if (!error) return new Error(fallbackMessage);

  if (error?.code === -32002) {
    return new Error('MetaMask already has a pending connection request. Open MetaMask and approve/reject it first.');
  }

  if (error?.code === 4001) {
    return new Error('Connection request rejected in MetaMask.');
  }

  const rawMessage = String(error?.message || error || '');
  if (isMetaMaskConnectFailureMessage(rawMessage)) {
    return new Error('MetaMask connection failed. Open MetaMask, unlock it, and retry the connection.');
  }

  return error instanceof Error ? error : new Error(rawMessage || fallbackMessage);
}

const NETWORK_PARAMS = IS_PRODUCTION
  ? {
      chainId: SEPOLIA_CHAIN_ID_HEX,
      chainName: "Sepolia Testnet",
      nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
      rpcUrls: [process.env.REACT_APP_RPC_URL || "https://rpc.sepolia.org"],
      blockExplorerUrls: ["https://sepolia.etherscan.io"],
    }
  : {
      chainId: HARDHAT_CHAIN_ID_HEX,
      chainName: "Hardhat Localhost 31337",
      nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
      rpcUrls: ["http://127.0.0.1:8545"],
      blockExplorerUrls: [],
    };

export function hasMetaMask() {
  const provider = getMetaMaskProvider();
  return Boolean(provider);
}

export function getMetaMaskProvider() {
  const ethereum = window.ethereum;
  if (!ethereum) return null;

  if (Array.isArray(ethereum.providers)) {
    const mmProvider = ethereum.providers.find(
      (provider) => provider?.isMetaMask && typeof provider?.request === "function"
    );
    return mmProvider || null;
  }

  if (ethereum.isMetaMask && typeof ethereum.request === "function") return ethereum;

  return null;
}

export function isMobileDevice() {
  const ua = navigator.userAgent || navigator.vendor || "";
  return /android|iphone|ipad|ipod|mobile/i.test(ua) || navigator.maxTouchPoints > 1;
}

export function getStoredWalletAddress() {
  return sessionStorage.getItem("trustchain_wallet_address") || null;
}

export function persistWalletSession(address) {
  sessionStorage.setItem("trustchain_wallet_address", address);
  localStorage.setItem("trustchain_wallet_address", address);
  localStorage.setItem("trustchain_user", address);
  localStorage.setItem("trustchain_user_id", address);
  localStorage.setItem("trustchain_logged_in", "true");
}

export function clearWalletSession() {
  sessionStorage.removeItem("trustchain_wallet_address");
  localStorage.removeItem("trustchain_wallet_address");
  localStorage.removeItem("trustchain_user");
  localStorage.removeItem("trustchain_user_id");
  localStorage.removeItem("trustchain_logged_in");
}

export function shortenAddress(address) {
  if (!address || address.length < 10) return address || "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export async function ensureCorrectNetwork() {
  const provider = getMetaMaskProvider();
  if (!provider) return;

  // Wait a moment to ensure provider is ready to receive requests
  await new Promise(r => setTimeout(r, 100));

  let chainId;
  try {
    chainId = await provider.request({ method: "eth_chainId" });
  } catch (err) {
    console.error("Failed to fetch chainId", err);
    return; // Don't block if we can't even get the chainId
  }

  if (String(chainId).toLowerCase() === TARGET_CHAIN_ID_HEX) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: TARGET_CHAIN_ID_HEX }],
    });
  } catch (switchError) {
    // This error code indicates that the chain has not been added to MetaMask.
    if (switchError.code === 4902) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [NETWORK_PARAMS],
        });
      } catch (addError) {
        throw normalizeMetaMaskError(addError, 'Failed to add the required network to MetaMask.');
      }
      return;
    }
    throw normalizeMetaMaskError(switchError, 'Unable to switch MetaMask network. Open MetaMask and switch network manually.');
  }
}

export async function connectMetaMask({ requireNetwork = true } = {}) {
  if (connectInFlight) {
    return connectInFlight;
  }

  connectInFlight = (async () => {
  const provider = getMetaMaskProvider();

  if (!provider) {
    throw new Error("MetaMask is not installed. Please install it in your browser.");
  }

  // Helpful early check: user may have MetaMask installed but still locked.
  try {
    if (provider?._metamask?.isUnlocked) {
      const unlocked = await provider._metamask.isUnlocked();
      if (!unlocked) {
        throw new Error("MetaMask is locked. Please unlock it and try again.");
      }
    }
  } catch (error) {
    if (String(error?.message || "").includes("locked")) {
      throw error;
    }
    // Ignore non-critical unlock probe errors.
  }

  let accounts = [];
  if (provider.selectedAddress) {
    accounts = [provider.selectedAddress];
  }
  try {
    // Reuse already authorized account when available to avoid repeated connect prompts.
    accounts = await provider.request({ method: "eth_accounts" });
  } catch (error) {
    if (isMetaMaskConnectFailureMessage(error?.message)) {
      throw normalizeMetaMaskError(error);
    }
    accounts = [];
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    try {
      accounts = await provider.request({ method: "eth_requestAccounts" });
    } catch (error) {
      throw normalizeMetaMaskError(error);
    }
  }

  const walletAddress = accounts?.[0] || null;

  if (!walletAddress) {
    throw new Error("No wallet account was returned by MetaMask.");
  }

  if (requireNetwork) {
    try {
      await ensureCorrectNetwork();
    } catch (error) {
      // If we just got a connection error, it might be because the network switch 
      // triggered a re-initialization in MetaMask.
      if (isMetaMaskConnectFailureMessage(error?.message)) {
        throw new Error("MetaMask is re-connecting to the network. Please wait a moment and try again.");
      }
      throw error;
    }
  }

  persistWalletSession(walletAddress);
  return walletAddress;
  })();

  try {
    return await connectInFlight;
  } catch (error) {
    throw normalizeMetaMaskError(error);
  } finally {
    connectInFlight = null;
  }
}

export async function getCurrentMetaMaskAccount() {
  const provider = getMetaMaskProvider();
  if (!provider) return null;
  const accounts = await provider.request({ method: "eth_accounts" });
  return accounts?.[0] || null;
}

export async function disconnectMetaMask() {
  const provider = getMetaMaskProvider();

  if (!provider) {
    clearWalletSession();
    return;
  }

  try {
    await provider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch (error) {
    // Some wallets may not support revoke permissions; clear local session anyway.
    console.warn("wallet_revokePermissions not available", error);
  } finally {
    clearWalletSession();
  }
}

export function subscribeWalletEvents({ onAccountChanged, onChainChanged }) {
  const provider = getMetaMaskProvider();

  if (!provider?.on) {
    return () => {};
  }

  const accountHandler = (accounts) => {
    const account = accounts?.[0] || null;
    if (account) {
      persistWalletSession(account);
    } else {
      clearWalletSession();
    }
    if (onAccountChanged) onAccountChanged(account);
  };

  const chainHandler = (chainId) => {
    if (onChainChanged) onChainChanged(chainId);
  };

  provider.on("accountsChanged", accountHandler);
  provider.on("chainChanged", chainHandler);

  return () => {
    if (!provider?.removeListener) return;
    provider.removeListener("accountsChanged", accountHandler);
    provider.removeListener("chainChanged", chainHandler);
  };
}

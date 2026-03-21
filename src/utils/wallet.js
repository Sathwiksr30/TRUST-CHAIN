// Production: Sepolia Testnet | Development: Hardhat Localhost
const IS_PRODUCTION = process.env.REACT_APP_NETWORK === "sepolia";

const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111
const HARDHAT_CHAIN_ID_HEX = "0x7a69";   // 31337

const TARGET_CHAIN_ID_HEX = IS_PRODUCTION ? SEPOLIA_CHAIN_ID_HEX : HARDHAT_CHAIN_ID_HEX;

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

  if (ethereum.isMetaMask) return ethereum;

  if (Array.isArray(ethereum.providers)) {
    const mmProvider = ethereum.providers.find((provider) => provider?.isMetaMask);
    return mmProvider || null;
  }

  return ethereum;
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

export async function ensureHardhatNetwork() {
  const provider = getMetaMaskProvider();
  if (!provider) return;

  const chainId = await provider.request({ method: "eth_chainId" });
  if (String(chainId).toLowerCase() === TARGET_CHAIN_ID_HEX) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: TARGET_CHAIN_ID_HEX }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [NETWORK_PARAMS],
      });
      return;
    }
    throw switchError;
  }
}

export async function connectMetaMask({ requireHardhat = true } = {}) {
  const provider = getMetaMaskProvider();

  if (!provider) {
    throw new Error("MetaMask is not installed. Please install it in your browser.");
  }



  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const walletAddress = accounts?.[0] || null;

  if (!walletAddress) {
    throw new Error("No wallet account was returned by MetaMask.");
  }

  if (requireHardhat) {
    await ensureHardhatNetwork();
  }

  persistWalletSession(walletAddress);
  return walletAddress;
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

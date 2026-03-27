import React, { useEffect, useState } from "react";
import "./App.css";
import Navbar from "./components/Navbar";
import LandingPage from "./pages/LandingPage";
import Dashboard from "./pages/Dashboard";
import UploadDocument from "./pages/UploadDocument";
import CreateWill from "./pages/CreateWill";
import ViewDocuments from "./pages/ViewDocuments";
import WalletConnect from "./pages/WalletConnect";
import ReleaseWill from "./pages/ReleaseWill";
import ClaimPage from "./pages/ClaimPage";
import {
  getStoredWalletAddress,
  subscribeWalletEvents,
} from "./utils/wallet";

function App() {
  const [view, setView] = useState("home");
  const [, setWalletAddress] = useState(() => getStoredWalletAddress());
  const viewRef = React.useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    // Handle query parameters for email links (e.g. ?view=release&willId=WILL-123)
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    const willIdParam = urlParams.get('willId');
    const pathName = window.location.pathname;
    
    if (viewParam === 'release' && willIdParam) {
      setView('release');
    }
    if (viewParam === 'claim' && willIdParam) {
      setView('claim');
    }
    // Backward-compatible support for old links like /upload?willId=...
    if (pathName === '/upload' && willIdParam) {
      setView('release');
    }

    const isPublicView = (v) => ['claim', 'release', 'upload'].includes(v);

    const unsubscribe = subscribeWalletEvents({
      onAccountChanged: (account) => {
        setWalletAddress(account || null);
        const currentPathView = new URLSearchParams(window.location.search).get('view');
        // Only redirect to home if NOT on a public wallet-less view
        if (!account && !isPublicView(viewRef.current) && !isPublicView(currentPathView)) {
          setView("home");
        }
      },
      onChainChanged: () => {},
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [setView]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderView = () => {
    switch (view) {
      case "connect":
        return (
          <WalletConnect
            onConnected={(address) => {
              setWalletAddress(address);
              setView("home");
            }}
          />
        );
      case "dashboard":
        return <Dashboard onNavigate={setView} />;
      case "upload":
        return <UploadDocument onNavigate={setView} />;
      case "will":
        return <CreateWill onNavigate={setView} />;
      case "documents":
        return <ViewDocuments onNavigate={setView} />;
      case "view":
        return <ViewDocuments onNavigate={setView} />;
      case "release": {
        const urlParams = new URLSearchParams(window.location.search);
        const willId = urlParams.get('willId');
        return <ReleaseWill willId={willId} onNavigate={setView} />;
      }
      case "claim": {
        const urlParams = new URLSearchParams(window.location.search);
        const willId = urlParams.get('willId');
        return <ClaimPage willId={willId} onNavigate={setView} />;
      }
      default:
        return <LandingPage onNavigate={setView} />;
    }
  };

  return (
    <div className="app-container">
      <Navbar onNavigate={setView} currentView={view} />
      <main id="main-content">{renderView()}</main>
    </div>
  );
}

export default App;

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
import {
  getStoredWalletAddress,
  subscribeWalletEvents,
} from "./utils/wallet";

function App() {
  const [view, setView] = useState("home");
  const [, setWalletAddress] = useState(() => getStoredWalletAddress());

  useEffect(() => {
    // Handle query parameters for email links (e.g. ?view=release&willId=WILL-123)
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    const willIdParam = urlParams.get('willId');
    
    if (viewParam === 'release' && willIdParam) {
      setView('release');
      // We'll store willId in state if needed, or extract it in the renderView
    }

    const unsubscribe = subscribeWalletEvents({
      onAccountChanged: (account) => {
        setWalletAddress(account || null);
        if (!account) {
          setView("home");
        }
      },
      onChainChanged: () => {},
    });

    return () => {
      unsubscribe();
    };
  }, []);

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

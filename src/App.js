import React, { useEffect, useState } from "react";
import "./App.css";
import Navbar from "./components/Navbar";
import LandingPage from "./pages/LandingPage";
import Dashboard from "./pages/Dashboard";
import UploadDocument from "./pages/UploadDocument";
import CreateWill from "./pages/CreateWill";
import ViewDocuments from "./pages/ViewDocuments";
import WalletConnect from "./pages/WalletConnect";
import {
  getStoredWalletAddress,
  subscribeWalletEvents,
} from "./utils/wallet";

function App() {
  const [view, setView] = useState("home");
  const [, setWalletAddress] = useState(() => getStoredWalletAddress());

  useEffect(() => {
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

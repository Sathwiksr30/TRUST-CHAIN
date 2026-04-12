import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

function isMetaMaskConnectRuntimeError(payload) {
	const message = String(payload?.message || payload?.reason?.message || payload?.reason || '').toLowerCase();
	const fileName = String(payload?.filename || '').toLowerCase();
	return (
		message.includes('failed to connect to metamask') ||
		(fileName.includes('chrome-extension://') && message.includes('metamask') && message.includes('connect'))
	);
}

window.addEventListener('error', (event) => {
	if (isMetaMaskConnectRuntimeError(event)) {
		event.preventDefault();
	}
});

window.addEventListener('unhandledrejection', (event) => {
	if (isMetaMaskConnectRuntimeError(event)) {
		event.preventDefault();
	}
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

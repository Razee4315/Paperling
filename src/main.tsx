import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { revealMainWindow } from "./utils/appWindow";
import { initPlatformClass } from "./utils/platform";
// Bundled fonts — load BEFORE index.css so @font-face declarations are
// registered before any rule that references the family names. Without this
// import the app falls back to system fonts when there is no network.
import "./fonts";
import "./index.css";

// Resolve the shell (mobile vs desktop) and stamp `mobile`/`touch` classes on
// <html> BEFORE the first render, so the phone layout never flashes the
// desktop one. The decision is made once and never revisited (see
// utils/platform.ts); all mobile styling keys off these classes.
initPlatformClass();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Failsafe: the window is created hidden and normally revealed from App's mount
// effect. If mount hangs or crashes before that runs, this still shows the
// window so the app can never end up running invisibly (#98). Safe to fire late
// since the inline script in index.html already painted the themed background.
setTimeout(() => {
  revealMainWindow();
}, 3000);

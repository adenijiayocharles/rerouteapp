import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// The WKWebView's native right-click menu (Reload, Inspect Element, etc.)
// doesn't belong in a packaged desktop app — nothing here should be a page
// to inspect from the outside.
document.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

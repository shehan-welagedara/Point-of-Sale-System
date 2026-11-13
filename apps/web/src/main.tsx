import { queryAudit } from "@pos/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SystemBanners } from "./components/SystemBanners";
import { installGlobalErrorHandlers } from "./lib/errors";
import { loadFirebaseConfig } from "./lib/firebase";
import { AppProvider } from "./state/app";
import "./styles.css";
import "./phone.css";

installGlobalErrorHandlers();
// The end-to-end suite exposes __posQueryAudit to check that every query has its Firestore index.
queryAudit.record = (collection, q) => {
  const report = (window as unknown as { __posQueryAudit?: (shape: string) => void }).__posQueryAudit;
  if (typeof report === "function") report(JSON.stringify({ collection, where: (q?.where ?? []).map(([f, op]) => [f, op]), ...(q?.orderBy ? { orderBy: q.orderBy } : {}) }));
};
// The client's Firebase project comes from the site it is served from (one build for every client).
await loadFirebaseConfig();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AppProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
          <SystemBanners />
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig } from "./firebase";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
void loadConfig().then((ok) =>
  root.render(
    <StrictMode>
      {ok ? (
        <App />
      ) : (
        <div className="auth">
          <div className="card card-body stack">
            <h2>Polymath Console</h2>
            <p className="muted">This copy has no Firebase settings. Deploy it with <code>pnpm console:deploy</code> (docs/22), or run it against the emulators.</p>
          </div>
        </div>
      )}
    </StrictMode>,
  ),
);

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../lib/errors";

/**
 * Catches an unexpected error in a screen so the device shows a way back instead of a blank page
 * (during service, a blank POS is the worst outcome). The error is reported for support.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(Object.assign(error, { stack: `${error.stack ?? ""}\n--- component stack ---${info.componentStack ?? ""}` }));
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth">
        <div className="card auth-card" style={{ width: "min(520px, 100%)" }} role="alert">
          <h1>Something went wrong on this screen</h1>
          <p className="muted">Nothing that was already saved is lost. The problem has been reported. Reload to carry on.</p>
          <p className="tiny muted mono">{this.state.error.message}</p>
          <div className="row wrap">
            <button className="btn primary lg" onClick={() => location.reload()}>Reload</button>
            <button className="btn lg" onClick={() => location.assign(location.pathname.startsWith("/pos") ? "/pos" : "/emc/home")}>Start again</button>
          </div>
        </div>
      </div>
    );
  }
}

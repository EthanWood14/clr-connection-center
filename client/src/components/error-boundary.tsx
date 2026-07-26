import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App crashed:", error, info.componentStack);
  }

  handleReload = () => {
    try { sessionStorage.clear(); } catch {}
    window.location.reload();
  };

  handleLapHome = () => {
    try { sessionStorage.clear(); } catch {}
    window.location.assign(`${window.location.pathname}#/lap`);
  };

  render() {
    if (this.state.error) {
      const lap = /^#\/lap(?:\/|$|\?)/i.test(window.location.hash || "");
      const hideLapDetails = lap && import.meta.env.PROD;
      const message = this.state.error?.message ?? String(this.state.error);
      const stack = this.state.error?.stack ?? "";
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: lap
              ? "radial-gradient(circle at 15% 0%, #6E1F2B 0%, #3B111A 44%, #18090D 100%)"
              : "#0f1729",
            color: lap ? "#F8E7E2" : "#e2e8f0",
            padding: 24,
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div
            style={lap ? {
              maxWidth: 640,
              width: "100%",
              border: "1px solid rgba(232,184,190,0.22)",
              borderRadius: 20,
              padding: 28,
              background: "rgba(24,9,13,0.76)",
              boxShadow: "0 28px 80px rgba(0,0,0,0.36)",
            } : { maxWidth: 720, width: "100%" }}
          >
            {lap && (
              <p style={{
                margin: "0 0 12px",
                color: "#E8B8BE",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}>
                LO Assistant Portal
              </p>
            )}
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
              {lap ? "LAP needs a quick reload." : "Something went wrong."}
            </h1>
            <p style={{ fontSize: 14, color: lap ? "#D7BDC1" : "#94a3b8", marginBottom: 16, lineHeight: 1.6 }}>
              {lap
                ? "The LO Assistant Portal hit an unexpected error. Reload this page, or return to the LAP home screen."
                : "The app hit an unexpected error. Reload to try again. If the problem persists, contact support."}
            </p>
            {!hideLapDetails && (
              <pre
                style={{
                  background: lap ? "rgba(0,0,0,0.24)" : "#1e293b",
                  padding: 12,
                  borderRadius: 8,
                  fontSize: 12,
                  color: lap ? "#F1B7BE" : "#fca5a5",
                  overflow: "auto",
                  maxHeight: 240,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {message}
                {stack ? `\n\n${stack}` : ""}
              </pre>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
              <button
                onClick={this.handleReload}
                style={{
                  padding: "8px 16px",
                  background: lap ? "#8B2F3F" : "#3b82f6",
                  color: "white",
                  border: "none",
                  borderRadius: lap ? 10 : 6,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {lap ? "Reload LAP" : "Reload app"}
              </button>
              {lap && (
                <button
                  onClick={this.handleLapHome}
                  style={{
                    padding: "8px 16px",
                    background: "transparent",
                    color: "#E8B8BE",
                    border: "1px solid rgba(232,184,190,0.34)",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Return to LAP home
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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

  render() {
    if (this.state.error) {
      const message = this.state.error?.message ?? String(this.state.error);
      const stack = this.state.error?.stack ?? "";
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0f1729",
            color: "#e2e8f0",
            padding: 24,
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div style={{ maxWidth: 720, width: "100%" }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
              Something went wrong.
            </h1>
            <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 16 }}>
              The app hit an unexpected error. Reload to try again. If the problem persists, contact support.
            </p>
            <pre
              style={{
                background: "#1e293b",
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
                color: "#fca5a5",
                overflow: "auto",
                maxHeight: 240,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {message}
              {stack ? `\n\n${stack}` : ""}
            </pre>
            <button
              onClick={this.handleReload}
              style={{
                marginTop: 16,
                padding: "8px 16px",
                background: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

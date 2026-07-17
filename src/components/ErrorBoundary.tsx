import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          height: "100%", color: "#e0e0e0",
          background: "#0d0d1a",
          padding: 40, textAlign: "center",
        }}>
          <h2 style={{ marginBottom: 12, color: "#ff4444" }}>3D Viewer Error</h2>
          <p style={{ marginBottom: 16, color: "#8888aa", fontSize: 13, maxWidth: 400 }}>
            {this.state.error?.message || "An unexpected error occurred in the 3D scene."}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              padding: "8px 20px", border: "1px solid #4a7aff", borderRadius: 6,
              background: "#4a7aff", color: "#fff", cursor: "pointer", fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

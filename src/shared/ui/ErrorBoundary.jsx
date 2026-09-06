import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error("Market workspace could not render", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-shell-page" role="alert">
        <h1>The market workspace could not load</h1>
        <p>Reload to try again. Your saved settings and strategies are kept.</p>
        <button onClick={() => window.location.reload()}>Reload page</button>
      </main>
    );
  }
}

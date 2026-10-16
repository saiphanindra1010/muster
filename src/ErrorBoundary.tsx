import React from "react";

/** Isolates panel crashes so one bad render can't blank the whole app. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose?: () => void; label: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}] crashed:`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="drawer-veil" onClick={this.props.onClose}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Something broke in {this.props.label}</h3>
            <p><code>{String(this.state.error.message || this.state.error).slice(0, 300)}</code></p>
            <div className="row">
              <button className="btn-ghost" onClick={this.props.onClose}>Close</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

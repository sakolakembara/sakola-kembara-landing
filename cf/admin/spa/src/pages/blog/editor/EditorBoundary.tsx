import { Component, type ReactNode } from "react";

/**
 * Shows `fallback` when what is inside could not be drawn: here, when the editor's file could not be loaded (offline, a
 * deploy replaced it) or the editor itself failed. The text is Markdown, so a plain box still lets the person write
 * and save; nothing is lost and nothing is blocked.
 */
export class EditorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

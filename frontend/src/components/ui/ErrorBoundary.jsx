import { Component } from "react";

import { Button } from "./Button.jsx";
import styles from "./ErrorBoundary.module.css";

/**
 * The floor, not a feature. Without a boundary anywhere in the tree, one bad
 * render unmounts the React root and the user is left staring at a white page
 * with their composer draft gone — a reload button is a strictly better story.
 *
 * Class component because error boundaries have no hook equivalent.
 */
export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // No telemetry here yet; the console is what an operator actually reads.
    console.error("Unhandled render error", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className={styles.panel} role="alert">
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.body}>
          Zentro hit an error it could not recover from. Reloading usually fixes it.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
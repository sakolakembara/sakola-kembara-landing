import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

async function start() {
  // Local development without the Worker: `pnpm dev:spa:mock` sets this. A
  // production build never has it, so the mock is not part of the bundle.
  if (import.meta.env.VITE_ADMIN_MOCK === "true") {
    const { installMockApi } = await import("./mock/install");
    installMockApi();
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <ErrorBoundary variant="app">
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </StrictMode>,
  );
}

void start();

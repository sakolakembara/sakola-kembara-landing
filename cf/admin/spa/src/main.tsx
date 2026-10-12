import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
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

  // A data router (one splat route that renders <App />, which keeps its own <Routes>): the forms' unsaved-changes
  // guard needs `useBlocker`, which only exists under one (docs/cloudflare/admin-crud.md#15-the-spa-kit).
  const router = createBrowserRouter([
    {
      path: "*",
      element: (
        <ErrorBoundary variant="app">
          <App />
        </ErrorBoundary>
      ),
    },
  ]);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

void start();

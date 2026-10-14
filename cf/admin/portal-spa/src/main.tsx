import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BASE } from "./lib/paths";
import "./styles.css";

async function start() {
  // Local development without the Worker: `pnpm dev:portal-spa:mock` sets this. A production build never has it,
  // so the mock is not part of the bundle (scripts/check-portal-spa-bundle.mjs fails the build check if it is).
  if (import.meta.env.VITE_PORTAL_MOCK === "true") {
    const { installMockApi } = await import("./mock/install");
    installMockApi();
  }

  // A data router (one splat route that renders <App />, which keeps its own <Routes>), as the admin's: the wizard's
  // unsaved-changes guard needs `useBlocker`, which only exists under one. The basename is where the Worker serves
  // the SPA: every path in the pages is relative to it (`/status` is /portal/status).
  const router = createBrowserRouter(
    [
      {
        path: "*",
        element: (
          <ErrorBoundary variant="app">
            <App />
          </ErrorBoundary>
        ),
      },
    ],
    { basename: BASE },
  );

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

void start();

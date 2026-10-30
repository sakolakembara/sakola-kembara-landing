import { Route, Routes } from "react-router";
import { ProgressBar } from "./components/ProgressBar";
import { RequireAuth, RequireSection } from "./components/RequireAuth";
import { Shell } from "./components/Shell";
import { NAV_ITEMS, type NavItem } from "./lib/nav";
import { AuthErrorPage } from "./pages/auth/AuthError";
import { ForgotPasswordPage } from "./pages/auth/ForgotPassword";
import { LoginPage } from "./pages/auth/Login";
import { ResetPasswordPage } from "./pages/auth/ResetPassword";
import { VerifyEmailPage } from "./pages/auth/VerifyEmail";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { NotFoundPage } from "./pages/NotFound";
import { PlaceholderPage } from "./pages/Placeholder";
import { SCREENS } from "./pages/screens";

// Pages that exist, by menu path (lib/nav.ts), registered per area in pages/screens/. A menu entry not
// registered there gets the placeholder. Everything below a menu entry ("/blog/new", "/blog/<id>/edit") that is
// not registered either also gets the placeholder until its page is built.

/** The menu entries that share one area, as they appear in lib/nav.ts. */
function itemsBySection(): [NavItem["section"], NavItem[]][] {
  const groups = new Map<NavItem["section"], NavItem[]>();
  for (const item of NAV_ITEMS) {
    if (item.section === "umum") continue; // the dashboard is the index route
    groups.set(item.section, [...(groups.get(item.section) ?? []), item]);
  }
  return [...groups];
}

function AppRoutes() {
  return (
    <Routes>
      {/* Open to anyone. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/auth/error" element={<AuthErrorPage />} />

      {/* Signed-in admins only: not signed in goes to /login?from=<this page>. */}
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          {itemsBySection().map(([section, items]) => (
            // Not allowed to open the area: the 403 page, same shell.
            <Route key={section} element={<RequireSection section={section} />}>
              {items.flatMap((item) => {
                const screen = SCREENS[item.path];
                const Page = screen?.index;
                const path = item.path.slice(1);
                return [
                  <Route key={item.path} path={path} element={Page ? <Page /> : <PlaceholderPage item={item} />} />,
                  ...(screen?.routes ?? []).map(({ path: below, Page: Below }) => (
                    <Route key={`${item.path}/${below}`} path={`${path}/${below}`} element={<Below />} />
                  )),
                  <Route key={`${item.path}/*`} path={`${path}/*`} element={<PlaceholderPage item={item} />} />,
                ];
              })}
            </Route>
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <>
      <ProgressBar />
      <AppRoutes />
    </>
  );
}

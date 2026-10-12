import { Navigate, Route, Routes } from "react-router";
import { AnnouncementsPage } from "./pages/Announcements";
import { AuthErrorPage } from "./pages/AuthError";
import { LoginPage } from "./pages/Login";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/error" element={<AuthErrorPage />} />
      <Route path="/announcements" element={<AnnouncementsPage />} />
      <Route path="*" element={<Navigate to="/announcements" replace />} />
    </Routes>
  );
}

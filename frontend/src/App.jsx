import React, { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import AppLayout from "./layout/AppLayout";
import Login from "./Login";
import WebsiteDocuments from "./Documents";
import { ToastProvider } from "./components/common/Toast";
import { logout, requestOtp, verifyOtp } from "./services/authApi";
import { SESSION_EXPIRED_EVENT, getSessionToken } from "./services/session";

import "./App.css";

const AppShell = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const pathname = location.pathname;
  const signedIn = Boolean(getSessionToken());

  // An expired or revoked session (any 401 from the API) sends the user back to login.
  useEffect(() => {
    const handleExpired = () => navigate("/login", { replace: true, state: { from: pathname } });
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
  }, [navigate, pathname]);

  if (pathname === "/login") {
    if (signedIn) return <Navigate to="/" replace />;

    return (
      <Login
        onSendOtp={requestOtp}
        onResendOtp={requestOtp}
        onVerifyOtp={async (credentials) => {
          await verifyOtp(credentials);
          navigate(location.state?.from || "/", { replace: true });
        }}
      />
    );
  }

  if (!signedIn) {
    return <Navigate to="/login" replace state={{ from: pathname }} />;
  }

  const handleNavigation = (item) => {
    if (!item?.id) return;

    switch (item.id) {
      case "documents":
        navigate("/");
        break;

      case "logout":
        // Ends the server session and clears the stored token/user.
        logout().finally(() => navigate("/login", { replace: true }));
        break;

      default:
        break;
    }
  };

  return (
    <AppLayout
      activeItem="documents"
      pageTitle="Website documents"
      pageSubtitle="PDFs published on the corporate website."
      onNavigate={handleNavigation}
    >
      <Routes>
        {/* The portal is a single page: website documents */}
        <Route path="/" element={<WebsiteDocuments />} />

        {/* Old links (/documents, /dashboard, /folders/…) and unknown routes land on it */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
};

const App = () => {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </BrowserRouter>
  );
};

export default App;

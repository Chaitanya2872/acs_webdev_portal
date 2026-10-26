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
import Dashboard from "./Dashboard";
import Profile from "./Profile";
import FolderPage from "./Folders/FolderPage";
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

  const getPageMeta = () => {
    if (pathname.startsWith("/folders/")) {
      return {
        activeItem: "dashboard",
        title: "Folder documents",
        subtitle: "Browse and organize documents in this folder.",
      };
    }

    switch (pathname) {
      case "/documents":
        return {
          activeItem: "documents",
          title: "Website documents",
          subtitle: "PDFs published on the corporate website.",
        };

      case "/profile":
        return {
          activeItem: "profile",
          title: "Profile",
          subtitle: "Manage your profile information.",
        };

      case "/dashboard":
      case "/":
      default:
        return {
          activeItem: "dashboard",
          title: "",
          subtitle: "",
        };
    }
  };

  const meta = getPageMeta();
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
      case "dashboard":
        navigate("/");
        break;

      case "documents":
        navigate("/documents");
        break;

      case "profile":
        navigate("/profile");
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
      activeItem={meta.activeItem}
      pageTitle={meta.title}
      pageSubtitle={meta.subtitle}
      onNavigate={handleNavigation}
    >
      <Routes>
        {/* Dashboard */}
        <Route path="/" element={<Dashboard />} />

        <Route
          path="/dashboard"
          element={<Navigate to="/" replace />}
        />

        {/* Profile */}
        <Route
          path="/profile"
          element={<Profile />}
        />

        <Route
          path="/documents"
          element={<WebsiteDocuments />}
        />

        <Route
          path="/folders/:folderId"
          element={<FolderPage />}
        />

        {/* Any unwanted/unknown route goes to Dashboard */}
        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />
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

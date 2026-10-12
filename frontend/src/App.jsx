import React from "react";
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
import { ToastProvider } from "./components/common/Toast";

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

  if (pathname === "/login") {
    return <Login />;
  }

  const handleNavigation = (item) => {
    if (!item?.id) return;

    switch (item.id) {
      case "dashboard":
        navigate("/");
        break;

      case "profile":
        navigate("/profile");
        break;

      case "logout":
        // Clear frontend-only login/session data.
        localStorage.removeItem("fawnix_logged_in");

        // Go back to login.
        navigate("/login", { replace: true });
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

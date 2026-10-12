import React, { useState } from "react";
import Sidebar from "../Sidebar";
import Header from "../Header";
import MobileNavigation from "../MobileNavigation";
import "./index.css";

const AppLayout = ({
  children,
  activeItem = "dashboard",
  pageTitle = "",
  pageSubtitle = "",
  onNavigate,
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavigation = (item) => {
    onNavigate?.(item);
    setMobileMenuOpen(false);
  };

  return (
    <div className={`fawnix-app-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        activeItem={activeItem}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onNavigate={handleNavigation}
      />

      <MobileNavigation
        isOpen={mobileMenuOpen}
        activeItem={activeItem}
        onClose={() => setMobileMenuOpen(false)}
        onNavigate={handleNavigation}
      />

      <div className="fawnix-main-area">
        <Header
          title={pageTitle}
          subtitle={pageSubtitle}
          onMenuClick={() => setMobileMenuOpen(true)}
        />
        <main className="fawnix-page-content">{children}</main>
      </div>
    </div>
  );
};

export default AppLayout;

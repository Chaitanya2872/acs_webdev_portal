import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
} from "lucide-react";

import "./index.css";

const menuItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
];

const readUser = () => {
  try {
    const storedUser = JSON.parse(localStorage.getItem("fawnix_user") || "null") || {};
    return {
      name: localStorage.getItem("fawnix_user_name") || storedUser.name || storedUser.displayName || "User",
      email: localStorage.getItem("fawnix_user_email") || storedUser.email || "",
      image: storedUser.image || storedUser.avatar || storedUser.photoURL || "",
    };
  } catch {
    return { name: localStorage.getItem("fawnix_user_name") || "User", email: "", image: "" };
  }
};

const Sidebar = ({ activeItem = "dashboard", onNavigate, collapsed = false, onToggle }) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(readUser);
  const profileWrapRef = useRef(null);

  useEffect(() => {
    const syncUser = () => setCurrentUser(readUser());
    window.addEventListener("storage", syncUser);
    window.addEventListener("fawnix-user-updated", syncUser);
    return () => {
      window.removeEventListener("storage", syncUser);
      window.removeEventListener("fawnix-user-updated", syncUser);
    };
  }, []);

  // Close the profile menu on outside click / touch or Escape
  useEffect(() => {
    if (!profileOpen) return undefined;
    const handlePointer = (event) => {
      if (profileWrapRef.current && !profileWrapRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [profileOpen]);

  const initials = currentUser.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";

  return (
    <aside className={`fawnix-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-brand-row">
        <div className="sidebar-brand-mark"><ShieldCheck size={25} strokeWidth={2.2} /></div>
        {!collapsed && <span className="sidebar-brand-name">FAWNIX</span>}
        <button type="button" className="sidebar-collapse-button" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>

      <nav className="sidebar-navigation" aria-label="Main navigation">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" className={`sidebar-menu-item ${activeItem === item.id ? "active" : ""}`} onClick={() => onNavigate?.(item)} title={collapsed ? item.label : undefined}>
              <Icon size={20} strokeWidth={1.9} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-profile-wrap" ref={profileWrapRef}>
          <button type="button" className="sidebar-profile" aria-expanded={profileOpen} aria-haspopup="menu" onClick={() => setProfileOpen((open) => !open)} title={collapsed ? currentUser.name : undefined}>
            {currentUser.image ? <img className="profile-avatar-small" src={currentUser.image} alt="" /> : <span className="profile-avatar-small">{initials}</span>}
            {!collapsed && <span className="sidebar-profile-copy"><strong>{currentUser.name}</strong><span>{currentUser.email || "Signed in"}</span></span>}
            <ChevronDown className="profile-arrow" size={17} />
          </button>

          {profileOpen && (
            <div className="sidebar-profile-menu" role="menu">
              <div className="sidebar-profile-menu-user"><strong>{currentUser.name}</strong><span>{currentUser.email}</span></div>
              <button type="button" role="menuitem" className="sidebar-profile-logout" onClick={() => { setProfileOpen(false); onNavigate?.({ id: "logout" }); }}>
                <LogOut size={16} /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
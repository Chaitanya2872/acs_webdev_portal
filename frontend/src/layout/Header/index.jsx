import React from "react";
import { Bell, Search, Command } from "lucide-react";
import "./index.css";

const Header = ({ onMenuClick }) => (
  <header className="fawnix-header">
    <button
      type="button"
      className="header-mobile-menu"
      onClick={onMenuClick}
      aria-label="Open navigation"
    >
      <span />
      <span />
      <span />
    </button>

    <div className="header-search">
      <Search size={18} />
      <input
        type="search"
        placeholder="Search files, folders and documents..."
        aria-label="Search files, folders and documents"
      />
      <span className="header-shortcut"><Command size={12} /> K</span>
    </div>

    <div className="header-actions">
      <button type="button" className="header-notification" aria-label="Notifications">
        <Bell size={21} />
        <i />
      </button>

    </div>
  </header>
);

export default Header;

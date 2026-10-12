import React from "react";
import {
  X,
  LayoutDashboard,
  FolderOpen,
  Clock3,
  Star,
  UsersRound,
  CloudUpload,
  Trash2,
  HardDrive,
} from "lucide-react";
import "./index.css";

const items = [
  ["dashboard", "Dashboard", LayoutDashboard],
  ["my-files", "My Files", FolderOpen],
  ["recent", "Recent", Clock3],
  ["starred", "Starred", Star],
  ["shared", "Shared With Me", UsersRound],
  ["upload-center", "Upload Center", CloudUpload],
  ["trash", "Trash", Trash2],
  ["storage", "Storage", HardDrive],
];

const MobileNavigation = ({ isOpen, onClose, activeItem, onNavigate }) => {
  if (!isOpen) return null;

  return (
    <>
      <div className="mobile-navigation-overlay" onClick={onClose} />
      <aside className="mobile-navigation">
        <div className="mobile-navigation-header">
          <div className="mobile-brand">
            <div className="mobile-brand-logo">F</div>
            <strong>FAWNIX</strong>
          </div>
          <button type="button" onClick={onClose} className="mobile-close-button">
            <X size={20} />
          </button>
        </div>

        <nav className="mobile-navigation-menu">
          {items.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              className={`mobile-navigation-item ${activeItem === id ? "active" : ""}`}
              onClick={() => onNavigate?.({ id, label })}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
};

export default MobileNavigation;

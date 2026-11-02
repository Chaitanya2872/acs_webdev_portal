import React from "react";
import { X, FileText, LogOut } from "lucide-react";
import logo from "../../assets/fawnix-logo.png";
import "./index.css";

const items = [
  ["documents", "Website Documents", FileText],
];

const MobileNavigation = ({ isOpen, onClose, activeItem, onNavigate }) => {
  if (!isOpen) return null;

  return (
    <>
      <div className="mobile-navigation-overlay" onClick={onClose} />
      <aside className="mobile-navigation">
        <div className="mobile-navigation-header">
          <div className="mobile-brand">
            <img className="mobile-brand-logo" src={logo} width={30} height={34} alt="Fawnix" />
            <strong>FAWNIX</strong>
          </div>
          <button type="button" onClick={onClose} className="mobile-close-button" aria-label="Close navigation">
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

        <button
          type="button"
          className="mobile-navigation-item mobile-navigation-logout"
          onClick={() => onNavigate?.({ id: "logout" })}
        >
          <LogOut size={19} />
          <span>Logout</span>
        </button>
      </aside>
    </>
  );
};

export default MobileNavigation;

import React from "react";
import logo from "../../assets/fawnix-logo.png";
import "./index.css";

/* Mobile-only top bar; on desktop the sidebar carries the brand and navigation. */
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

    <div className="header-brand">
      <img src={logo} width={26} height={30} alt="" />
      <span>FAWNIX</span>
    </div>
  </header>
);

export default Header;

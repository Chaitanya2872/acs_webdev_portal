import React, { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

// Small confirmation card for status changes and deletion.
const ConfirmDialog = ({ title, message, confirmLabel, danger = false, requireTyping, onConfirm, onClose }) => {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = requireTyping && typed.trim() !== requireTyping;

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fp-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="fp-modal" role="alertdialog" aria-modal="true" aria-labelledby="wd-confirm-title">
        <div className="fp-modal-header-row">
          <div className="fp-modal-title">
            <div className={`fp-icon-box ${danger ? "" : "fp-icon-view"}`}><AlertTriangle size={18} /></div>
            <div>
              <h2 id="wd-confirm-title">{title}</h2>
            </div>
          </div>
          <button type="button" className="fp-modal-close" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <div className="fp-modal-body">
          <p className="wd-confirm-text">{message}</p>
          {requireTyping && (
            <>
              <label className="fp-label wd-confirm-label" htmlFor="wd-confirm-input">Type <strong>{requireTyping}</strong> to confirm</label>
              <input id="wd-confirm-input" className="fp-input" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
            </>
          )}
        </div>
        <div className="fp-modal-footer">
          <button type="button" className="fp-btn fp-btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`fp-btn ${danger ? "wd-btn-danger" : "fp-btn-primary"}`} onClick={confirm} disabled={busy || blocked}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;

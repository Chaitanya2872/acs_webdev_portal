import React, { useRef, useState } from "react";
import { FileText, RefreshCw, UploadCloud, X } from "lucide-react";

import { checkPdfFile, replaceDocumentFile, uploadPdf } from "../services/documentApi";
import { formatBytes } from "./documentUtils";

/** Uploads a corrected PDF as a new version. The website link stays the same and serves the new file. */
const ReplaceFileDialog = ({ document, onClose, onSaved }) => {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [keepName, setKeepName] = useState(true);
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState(null);
  const busy = phase !== "idle";

  const choose = async (selected) => {
    setError("");
    if (!selected) return;
    const problem = await checkPdfFile(selected);
    if (problem) setError(problem);
    else {
      setFile(selected);
      setUploaded(null);
    }
  };

  const submit = async () => {
    if (!file) {
      setError("Choose the replacement PDF.");
      return;
    }
    setError("");
    try {
      let uploadId = uploaded?.file === file ? uploaded.uploadId : null;
      if (!uploadId) {
        setPhase("uploading");
        uploadId = await uploadPdf(file, setProgress);
        setUploaded({ file, uploadId });
      }
      setPhase("saving");
      onSaved(await replaceDocumentFile(document.id, uploadId, keepName));
    } catch (submitError) {
      if (["INVALID_PDF", "UPLOAD_SIZE_MISMATCH", "UPLOAD_ALREADY_USED", "UPLOAD_EXPIRED", "FILE_TOO_LARGE"].includes(submitError.code)) setUploaded(null);
      setError(submitError.message || "The file could not be replaced.");
      setPhase("idle");
    }
  };

  return (
    <div className="fp-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="fp-modal" role="dialog" aria-modal="true" aria-labelledby="wd-replace-title">
        <div className="fp-modal-header-row">
          <div className="fp-modal-title">
            <div className="fp-icon-box fp-icon-view"><RefreshCw size={18} /></div>
            <div>
              <h2 id="wd-replace-title">Replace file</h2>
              <p>{document.title} · currently version {document.currentVersion?.version}</p>
            </div>
          </div>
          <button type="button" className="fp-modal-close" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <div className="fp-modal-body">
          <div className={`wd-dropzone${file ? " has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files?.[0]); }}>
            {file ? (
              <div className="wd-dropzone-file">
                <FileText size={22} />
                <div><strong>{file.name}</strong><span>{formatBytes(file.size)}</span></div>
                <button type="button" className="fp-btn fp-btn-cancel" onClick={() => inputRef.current?.click()} disabled={busy}>Change</button>
              </div>
            ) : (
              <button type="button" className="wd-dropzone-empty" onClick={() => inputRef.current?.click()}>
                <UploadCloud size={26} />
                <strong>Choose the replacement PDF</strong>
                <span>The previous version is kept and can be restored.</span>
              </button>
            )}
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
          <label className="fp-confirm-row">
            <input type="checkbox" checked={keepName} onChange={(event) => setKeepName(event.target.checked)} disabled={busy} />
            <span>Keep the download file name “{document.displayFilename}”</span>
          </label>
          {phase === "uploading" && (
            <div className="wd-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${progress}%` }} />
              <span>Uploading… {progress}%</span>
            </div>
          )}
          {phase === "saving" && <p className="wd-hint" role="status">Checking the file and saving…</p>}
          {error && <p className="fp-error" role="alert">{error}</p>}
        </div>
        <div className="fp-modal-footer">
          <button type="button" className="fp-btn fp-btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="fp-btn fp-btn-primary" onClick={submit} disabled={busy || !file}>{busy ? "Replacing…" : "Replace file"}</button>
        </div>
      </div>
    </div>
  );
};

export default ReplaceFileDialog;

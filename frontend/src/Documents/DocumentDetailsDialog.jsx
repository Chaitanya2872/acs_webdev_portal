import React, { useEffect, useState } from "react";
import { Download, ExternalLink, Eye, FileText, History, Loader2, RotateCcw, X } from "lucide-react";

import { getDocument, getDocumentAudit, getDocumentFileUrl, restoreDocumentVersion } from "../services/documentApi";
import { AUDIT_LABELS, STATUS_LABELS, formatBytes, formatDate, websitePageUrl } from "./documentUtils";

/** Full record of one document: metadata, website placements, file versions and change history. */
const DocumentDetailsDialog = ({ documentId, categories, canEdit, onClose, onChanged, notify }) => {
  const [document, setDocument] = useState(null);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState("");
  const [busyVersion, setBusyVersion] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getDocument(documentId), getDocumentAudit(documentId)])
      .then(([doc, entries]) => {
        if (!active) return;
        setDocument(doc);
        setAudit(entries);
      })
      .catch((loadError) => active && setError(loadError.message));
    return () => { active = false; };
  }, [documentId]);

  const openVersion = async (versionId, download = false) => {
    const tab = download ? null : window.open("about:blank", "_blank");
    try {
      const { downloadUrl } = await getDocumentFileUrl(documentId, { versionId, download });
      if (tab) tab.location.href = downloadUrl;
      else window.location.assign(downloadUrl);
    } catch (openError) {
      tab?.close();
      notify(openError.message);
    }
  };

  const restore = async (version) => {
    setBusyVersion(version.id);
    try {
      const updated = await restoreDocumentVersion(documentId, version.id);
      setDocument(updated);
      setAudit(await getDocumentAudit(documentId));
      onChanged(updated);
      notify(`Version ${version.version} is now the live file.`, "success");
    } catch (restoreError) {
      notify(restoreError.message);
    } finally {
      setBusyVersion("");
    }
  };

  return (
    <div className="fp-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="fp-modal wd-details-modal" role="dialog" aria-modal="true" aria-labelledby="wd-details-title">
        <div className="fp-modal-header-row">
          <div className="fp-modal-title">
            <div className="fp-icon-box fp-icon-view"><FileText size={18} /></div>
            <div>
              <h2 id="wd-details-title">{document?.title ?? "Document"}</h2>
              {document && <p>{document.categoryPath} · <span className={`wd-status wd-status-${document.status}`}>{STATUS_LABELS[document.status]}</span></p>}
            </div>
          </div>
          <button type="button" className="fp-modal-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="fp-modal-body wd-details-body">
          {error && <p className="fp-error" role="alert">{error}</p>}
          {!document && !error && <p className="wd-hint"><Loader2 size={14} className="wd-spin" /> Loading…</p>}
          {document && (
            <>
              <dl className="wd-meta">
                <div><dt>Financial year</dt><dd>{document.financialYear ? `FY ${document.financialYear}` : "—"}</dd></div>
                <div><dt>Document date</dt><dd>{formatDate(document.documentDate)}</dd></div>
                <div><dt>Reporting period</dt><dd>{document.reportingPeriod || "—"}</dd></div>
                <div><dt>Download name</dt><dd>{document.displayFilename}</dd></div>
                <div><dt>Original file</dt><dd>{document.originalFilename}</dd></div>
                <div><dt>Published</dt><dd>{formatDate(document.publishedAt, true)}</dd></div>
                {document.legacyPath && <div className="wd-meta-wide"><dt>Old website URL</dt><dd className="wd-mono">{document.legacyPath}</dd></div>}
                <div className="wd-meta-wide"><dt>Storage key</dt><dd className="wd-mono">{document.currentVersion?.s3ObjectKey}</dd></div>
              </dl>

              <h3 className="wd-section-title">Listed on</h3>
              <ul className="wd-placement-list">
                {document.placements.map((placement) => {
                  const url = websitePageUrl(categories.byId.get(placement.categoryId));
                  return (
                    <li key={placement.categoryId}>
                      <span>{placement.path}{placement.isPrimary && <em> (main)</em>}{placement.titleOverride && <small> as “{placement.titleOverride}”</small>}</span>
                      {url && <a href={url} target="_blank" rel="noreferrer" className="wd-link-button">View page <ExternalLink size={13} /></a>}
                    </li>
                  );
                })}
              </ul>

              <h3 className="wd-section-title">File versions</h3>
              <ul className="wd-version-list">
                {document.versions.map((version) => (
                  <li key={version.id} className={version.id === document.currentVersion?.id ? "is-current" : ""}>
                    <div>
                      <strong>v{version.version}{version.id === document.currentVersion?.id && " · live"}</strong>
                      <span>{version.originalFilename} · {formatBytes(version.fileSize)} · {formatDate(version.createdAt, true)}{version.uploadedBy ? ` · ${version.uploadedBy}` : ""}</span>
                    </div>
                    <div className="wd-version-actions">
                      <button type="button" className="wd-icon-button" title="Preview" aria-label={`Preview version ${version.version}`} onClick={() => openVersion(version.id)}><Eye size={15} /></button>
                      <button type="button" className="wd-icon-button" title="Download" aria-label={`Download version ${version.version}`} onClick={() => openVersion(version.id, true)}><Download size={15} /></button>
                      {canEdit && version.id !== document.currentVersion?.id && document.status !== "archived" && (
                        <button type="button" className="wd-link-button" onClick={() => restore(version)} disabled={Boolean(busyVersion)}>
                          <RotateCcw size={13} /> {busyVersion === version.id ? "Restoring…" : "Make live"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              <h3 className="wd-section-title"><History size={14} /> History</h3>
              <ul className="wd-audit-list">
                {audit.map((entry) => (
                  <li key={entry.id}>
                    <span>{AUDIT_LABELS[entry.action] ?? entry.action}</span>
                    <small>{entry.actor} · {formatDate(entry.createdAt, true)}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="fp-modal-footer">
          <button type="button" className="fp-btn fp-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default DocumentDetailsDialog;

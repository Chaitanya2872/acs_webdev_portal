export const WEBSITE_URL = (import.meta.env.VITE_WEBSITE_URL || "https://www.acstechnologies.co.in").replace(/\/+$/, "");

export const STATUS_LABELS = {
  draft: "Draft",
  published: "Published",
  unpublished: "Unpublished",
  archived: "Archived",
};

/** Flattens the category tree into { id → node } and lists leaf categories (website pages) with their parent. */
export function indexCategories(tree = []) {
  const byId = new Map();
  const leaves = [];
  const walk = (nodes, parent = null) => {
    nodes.forEach((node) => {
      byId.set(node.id, { ...node, parent });
      if (node.isLeaf) leaves.push({ ...node, parent });
      if (node.children?.length) walk(node.children, node);
    });
  };
  walk(tree);
  return { byId, leaves };
}

/** Indian financial years (April–March), newest first, e.g. 2026-27 … */
export function financialYearOptions(extra = []) {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const years = [];
  for (let year = start + 1; year >= 2015; year -= 1) {
    years.push(`${year}-${String((year + 1) % 100).padStart(2, "0")}`);
  }
  return [...new Set([...years, ...extra.filter(Boolean)])].sort().reverse();
}

export function financialYearForDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || "")) return "";
  const [year, month] = isoDate.split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function titleFromFileName(name = "") {
  return name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

export const websitePageUrl = (category) => (category?.websitePath ? `${WEBSITE_URL}${category.websitePath}` : null);

export const AUDIT_LABELS = {
  "document.created": "Uploaded",
  "document.migrated": "Imported from the old website",
  "document.updated": "Details edited",
  "document.published": "Published",
  "document.unpublished": "Unpublished",
  "document.archived": "Archived",
  "document.restored": "Restored from archive",
  "document.file_replaced": "File replaced",
  "document.version_restored": "Earlier version restored",
  "document.deleted": "Deleted",
};

const PROJECTS = [
  {
    id: "MSReportChecker",
    name: "MSReportChecker",
    path: "/MSReportChecker/",
    summary:
      "Microsoft Word add-in to validate HRMS reports and enforce consistency with minimal friction.",
    status: "stable",
    keywords: [],
  },
  {
    id: "NMReportChecker",
    name: "NMReportChecker",
    path: "/NMReportChecker/",
    summary:
      "Instant visualization of 1D-NMR reports into spectra with multiplicities, integrals, J-couplings, etc.",
    status: "stable",
    keywords: [],
  },
  {
    id: "GelStack",
    name: "GelStack",
    path: "/GelStack/",
    summary:
      "Layer-based image overlay for gels: stack, reorder, and export clean composites.",
    status: "experimental",
    keywords: [],
  },
  {
    id: "LocAlign",
    name: "LocAlign",
    path: "/LocAlign/",
    summary:
      "Local Alignment of multiple biological sequences.",
    status: "stable",
    keywords: [],
  },
];

const elGrid = document.getElementById("cardGrid");
const elSearch = document.getElementById("searchInput");
const elCount = document.getElementById("resultCount");
const elYear = document.getElementById("year");

function norm(s) {
  return (s || "").toString().toLowerCase().trim();
}

function matches(p, q) {
  if (!q) return true;
  const hay = [p.id, p.name, p.path, p.summary, p.status, ...(p.keywords || [])]
    .map(norm)
    .join(" ");
  return hay.includes(norm(q));
}

function escapeHtml(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function card(p) {
  const pills = [
    p.status ? `<span class="pill">${escapeHtml(p.status)}</span>` : "",
    ...(p.keywords || [])
      .slice(0, 3)
      .map((k) => `<span class="pill">${escapeHtml(k)}</span>`),
  ]
    .filter(Boolean)
    .join("");

  return `
    <a class="card" href="${p.path}" aria-label="Open ${escapeHtml(p.name)}">
      <div class="card-top">
        <div>
          <h3>${escapeHtml(p.name)}</h3>
          <div class="path">${escapeHtml(p.path)}</div>
        </div>
      </div>
      <p>${escapeHtml(p.summary)}</p>
      <div class="meta">${pills}</div>
    </a>
  `;
}

function render() {
  const q = norm(elSearch.value);
  const filtered = PROJECTS.filter((p) => matches(p, q));
  elGrid.innerHTML = filtered.map(card).join("");
  elCount.textContent = `${filtered.length}/${PROJECTS.length}`;

  if (filtered.length === 0) {
    elGrid.innerHTML = `
      <div class="card" style="pointer-events:none;">
        <h3>No matches</h3>
        <p>Try a different keyword. Press <span class="mono">Esc</span> to clear search.</p>
      </div>
    `;
  }
}

function init() {
  elYear.textContent = new Date().getFullYear();
  render();

  elSearch.addEventListener("input", render);
  elSearch.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      elSearch.value = "";
      render();
      elSearch.blur();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== elSearch) {
      e.preventDefault();
      elSearch.focus();
    }
  });
}

init();

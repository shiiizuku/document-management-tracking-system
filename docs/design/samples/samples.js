/* global document */

const systems = [
  {
    id: 'apple',
    name: 'Apple',
    cue: 'Content first',
    description: 'A quiet workspace that gives document titles and the next task room to breathe.',
    takeaway: 'Use when a calm, low-chrome registry helps people stay focused on one record at a time.',
  },
  {
    id: 'material',
    name: 'Material Design 3',
    cue: 'Tonal and adaptive',
    description: 'Semantic surface layers and rounded controls make states and actions easy to scan.',
    takeaway: 'Closest to the current DTS token foundation, with a stronger hierarchy between page, panel, and action.',
  },
  {
    id: 'atlassian',
    name: 'Atlassian',
    cue: 'Work at scale',
    description: 'A compact registry that emphasizes queues, ownership, and fast comparison across rows.',
    takeaway: 'Useful for high-volume operators who spend most of their day triaging and routing documents.',
  },
  {
    id: 'fluent',
    name: 'Fluent UI',
    cue: 'Command workspace',
    description: 'Grouped commands, fine separators, and layered surfaces support a desktop work rhythm.',
    takeaway: 'Useful where users switch often between records, actions, and filtered views.',
  },
  {
    id: 'ebay',
    name: 'eBay Evo',
    cue: 'Find and browse',
    description: 'Search leads, filters stay visible, and each record is a self-contained summary.',
    takeaway: 'Useful when people arrive to locate a record quickly and compare a small set of results.',
  },
];

const records = [
  {
    title: 'Regional operations summary',
    number: 'DTS-2026-000184',
    direction: 'Incoming',
    status: 'In process',
    tone: 'moving',
    custody: 'Planning Division',
    date: '4 Oct 2026',
    priority: 'Normal',
  },
  {
    title: 'Quarterly resource request',
    number: 'DTS-2026-000183',
    direction: 'Outgoing',
    status: 'For signature',
    tone: 'waiting',
    custody: 'Office of the Director',
    date: '3 Oct 2026',
    priority: 'High',
  },
  {
    title: 'Field activity memorandum',
    number: 'DTS-2026-000182',
    direction: 'Incoming',
    status: 'Signed',
    tone: 'done',
    custody: 'Records Section',
    date: '2 Oct 2026',
    priority: 'Normal',
  },
  {
    title: 'Interagency correspondence',
    number: 'DTS-2026-000181',
    direction: 'Outgoing',
    status: 'Archived',
    tone: 'closed',
    custody: 'Records Section',
    date: '1 Oct 2026',
    priority: 'Normal',
  },
];

const active = systems.find((system) => system.id === document.body.dataset.system);
const app = document.querySelector('#app');

if (active && app) {
  app.innerHTML = `
    <div class="draft-strip">DTS DESIGN EXPLORATION · Fictional data · Static sample</div>
    <nav class="study-nav" aria-label="Design samples">
      <a class="study-home" href="./index.html">← All samples</a>
      ${systems.map((system) => `<a href="./${system.id}.html"${system.id === active.id ? ' aria-current="page"' : ''}>${system.name}</a>`).join('')}
    </nav>
    <div class="workspace">
      <aside class="sidebar" aria-label="Illustrative DTS navigation">
        <div class="brand"><span class="brand-mark">D</span><span>DTS<small>Records workspace</small></span></div>
        <div class="sidebar-group"><span class="sidebar-label">Workspace</span>
          <div class="nav-item"><span aria-hidden="true">▦</span> Dashboard</div>
          <div class="nav-item is-active"><span aria-hidden="true">▤</span> Documents</div>
          <div class="nav-item"><span aria-hidden="true">▣</span> My work</div>
          <div class="nav-item"><span aria-hidden="true">▥</span> Reports</div>
        </div>
        <div class="sidebar-group"><span class="sidebar-label">Administration</span>
          <div class="nav-item"><span aria-hidden="true">≡</span> Audit trail</div>
        </div>
        <div class="sidebar-bottom">Design concept<br /><strong>${active.name}</strong></div>
      </aside>
      <div class="stage">
        <header class="topbar">
          <div class="topbar-brand">DTS <span>Document registry</span></div>
          <div class="topbar-end"><span class="topbar-context">Workspace / Documents</span><span class="avatar" aria-hidden="true">IA</span></div>
        </header>
        <main>
          <div class="concept-line"><span>${active.name} inspired sample</span><span>${active.cue}</span></div>
          <section class="hero" aria-labelledby="page-title">
            <div><p class="eyebrow">Registry</p><h1 id="page-title">Documents</h1><p class="subtitle">${active.description}</p></div>
            <span class="primary-action">+ Register document</span>
          </section>
          <section class="metrics" aria-label="Illustrative summary">
            <div class="metric"><span>In your scope</span><strong>24</strong><small>Visible records</small></div>
            <div class="metric"><span>Awaiting action</span><strong>6</strong><small>Needs a next step</small></div>
            <div class="metric"><span>Moving today</span><strong>9</strong><small>Active routes</small></div>
          </section>
          <section class="filters" aria-label="Illustrative search and filters">
            <div class="search-label">Search documents</div>
            <div class="search-field"><span aria-hidden="true">⌕</span><span>Search title, tracking number, sender</span></div>
            <div class="filter-controls"><span class="filter-chip selected">Status <b>2</b> ▾</span><span class="filter-chip">Currently with ▾</span><span class="filter-chip">More filters ▾</span></div>
            <div class="applied"><span>Applied</span><span class="applied-chip">In process ×</span><span class="applied-chip">For signature ×</span><span class="clear-label">Clear all</span></div>
          </section>
          <section class="results" aria-labelledby="results-title">
            <div class="results-top"><div><p class="eyebrow">Authorized scope</p><h2 id="results-title">Records <span>24</span></h2><p>Sorted by most recently registered</p></div><div class="view-switch">${active.id === 'ebay' ? '<strong>Cards</strong><span>Table</span>' : '<span>Cards</span><strong>Table</strong>'}<span>Lines</span></div></div>
            <div class="records">
              <div class="table-head"><span>Document</span><span>Status</span><span>Currently with</span><span>Registered</span></div>
              ${records.map((record) => `<article class="record">
                <div class="record-main"><strong>${record.title}</strong><small>${record.number} · ${record.direction}${record.priority === 'High' ? ' · <em>High priority</em>' : ''}</small></div>
                <span class="status ${record.tone}">${record.status}</span>
                <span class="custody">${record.custody}</span>
                <time class="date">${record.date}</time>
              </article>`).join('')}
              <div class="pagination"><span>Showing 1–4 of 24 fictional records</span><span>Page 1 of 6 · ‹ ›</span></div>
            </div>
          </section>
          <p class="concept-note"><strong>Design intent:</strong> ${active.takeaway} This is a visual sample; controls do not change app data.</p>
        </main>
      </div>
    </div>`;
}

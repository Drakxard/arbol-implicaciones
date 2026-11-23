const paths: Record<string, string> = {
  bullets: '<circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/><path d="M9 6h12M9 12h12M9 18h12"/>',
  numbered: '<path d="M3 3h1v6M2 9h4M2 14c3-2 5 0 2 2l-2 3h4M10 6h11M10 12h11M10 18h11"/>',
  focus: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  walk: '<path d="M4 4h7v16H4m7-8h9M4 4h.01M4 20h.01"/><circle cx="20" cy="12" r="2"/>',
  hand: '<path d="M8 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v9c0 4-3 7-7 7h-1c-2 0-4-1-5-3l-4-6a2 2 0 0 1 3-2l2 2Z"/>',
  home: '<path d="m3 10 9-7 9 7v11H3Zm6 11v-8h6v8"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7" cy="7" r="1"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  settings: '<path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3Z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  undo: '<path d="M3 10h11a6 6 0 0 1 0 12M3 10l6-6M3 10l6 6" transform="translate(0 -2)"/>',
  redo: '<path d="M21 10H10a6 6 0 0 0 0 12M21 10l-6-6M21 10l-6 6" transform="translate(0 -2)"/>',
  full: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',
  center: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/><rect x="7" y="8" width="10" height="8" rx="2"/>',
  minus: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M7 10.5h7"/>',
  plus: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M7 10.5h7m-3.5-3.5v7"/>',
  right: '<rect x="3" y="3" width="8" height="6" rx="1"/><rect x="3" y="15" width="8" height="6" rx="1"/><path d="M11 6h3l3 6-3 6h-3m6-6h5"/>',
  left: '<rect x="13" y="3" width="8" height="6" rx="1"/><rect x="13" y="15" width="8" height="6" rx="1"/><path d="M13 6h-3l-3 6 3 6h3M7 12H2"/>',
  side: '<path d="M2 5c5 0 3 14 8 14h4c5 0 3-14 8-14M2 19c5 0 3-14 8-14h4c5 0 3 14 8 14"/><rect x="7" y="8" width="10" height="8" rx="2" fill="var(--surface, #f6f6f6)"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  outline: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16m6-14v16"/>',
  keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  link: '<path d="M10 7H7a5 5 0 0 0 0 10h3m4-10h3a5 5 0 0 1 0 10h-3M8 12h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
}
export function icon(name: string) {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.folder}</svg>`
}
export function iconButton(id: string, label: string, name: string, extra = '') {
  return `<button type="button" class="icon-button" id="${id}" title="${label}" aria-label="${label}" ${extra}>${icon(name)}</button>`
}

import type { PieceType } from '../core/components';

const svg = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICON = {
  play: svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'),
  pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  rotate: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  up: svg('<path d="m6 15 6-6 6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  flip: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  sound: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  mute: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>'),
  hint: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'),
  camera: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><circle cx="12" cy="12" r="2.5"/>'),
  fast: svg('<path d="M4 6v12l8-6zM12 6v12l8-6z" fill="currentColor" stroke="none"/>'),
  star: svg('<path d="m12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z" fill="currentColor" stroke="none"/>'),
  starOutline: svg('<path d="m12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z" stroke-width="1.6"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  replay: svg('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>'),
  grid: svg('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
};

/** Toolbar glyphs: top-down sketches of each component. */
export const PIECE_ICON: Record<PieceType, string> = {
  track: svg('<path d="M3 9h18M3 15h18"/><path d="M7 9v6M12 9v6M17 9v6" stroke-width="1.4" opacity=".6"/>'),
  ramp: svg('<path d="M3 19h18M3 19 21 7"/><path d="M21 7v12" opacity=".5"/>'),
  curve: svg('<path d="M3 8h4a10 10 0 0 1 10 10v3"/><path d="M3 14h1a6 6 0 0 1 6 6v1" opacity=".7"/>'),
  drop: svg('<path d="M3 5h7v14h11"/><path d="M14 9v4" opacity=".5"/><path d="m12 11 2 2 2-2" opacity=".7"/>'),
  kicker: svg('<path d="M3 18h9c4 0 6-3 8-8"/><path d="M19 4l2 3-3 1" opacity=".8"/>'),
  splitter: svg('<path d="M3 12h6"/><path d="M9 12c4 0 6-3 7-7M9 12c4 0 6 3 7 7"/><circle cx="9" cy="12" r="1.6" fill="currentColor"/>'),
  booster: svg('<path d="M5 7l5 5-5 5M12 7l5 5-5 5"/>'),
  brake: svg('<path d="M3 12h18"/><path d="M8 7v10M12 7v10M16 7v10" stroke-width="2.4"/>'),
  gate: svg('<path d="M3 12h18"/><path d="M8 5v14M16 5v14"/><path d="M8 9h8" stroke-width="3"/>'),
  switch: svg('<path d="M3 12h18"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  timer: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>'),
  teleporter: svg('<ellipse cx="12" cy="12" rx="5" ry="9"/><ellipse cx="12" cy="12" rx="2" ry="5" opacity=".6"/>'),
  launcher: svg('<path d="M4 18h8l7-11"/><path d="M15 5l5 1-1 5"/><circle cx="8" cy="18" r="2"/>'),
  magnet: svg('<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h3M15 8h3" stroke-width="3"/>'),
  collector: svg('<path d="M3 6h18l-6 8v6H9v-6z"/>'),
  start: svg('<circle cx="12" cy="12" r="5" fill="currentColor"/>'),
  goal: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'),
  block: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
};

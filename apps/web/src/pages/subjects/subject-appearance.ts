// A small curated set, not a full colour-picker/emoji-picker library (avoids an extra
// dependency for a cosmetic feature) — Subject.colour/icon are just free-text columns (§6.3), so
// any string works; this is only the UI's suggested palette.
export const SUBJECT_COLOURS: readonly string[] = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#a855f7', // purple
  '#f97316', // orange
  '#ec4899', // pink
  '#64748b', // slate
  '#ef4444', // red
  '#eab308', // yellow
];

export const SUBJECT_ICONS: readonly string[] = ['📘', '🧪', '🌍', '🔢', '💻', '🎵', '⚖️', '🩺', '🏛️', '🎨'];

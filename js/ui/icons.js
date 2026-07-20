/**
 * icons.js — inline SVG icon set.
 * Kept as code (not files) so icons work offline with zero extra requests.
 * All icons are 24×24 stroke-style paths.
 */
const PATHS = {
  dashboard: "M3 3h8v10H3zM13 3h8v6h-8zM13 11h8v10h-8zM3 15h8v6H3z",
  quests: "M9 2h6v3H9zM6 4H4v18h16V4h-2M8 11h8M8 15h8M8 19h5",
  loot: "M4 8h16l-1.5 12h-13zM8 8V6a4 4 0 0 1 8 0v2",
  hideout: "M3 11l9-8 9 8M5 10v10h14V10M9 20v-6h6v6",
  maps: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  traders: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-4 3.6-7 8-7s8 3 8 7",
  ammo: "M10 3h4v8l2 3v7h-8v-7l2-3zM10 17h4",
  inventory: "M4 7h16v13H4zM4 7l2-4h12l2 4M10 11h4",
  progress: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  graph: "M4 5h5v4H4zM4 15h5v4H4zM15 10h5v4h-5zM9 7h3v5h3M9 17h3v-5",
  coach: "M12 3a5 5 0 0 1 5 5c0 2-1 3-2 4l-1 2h-4l-1-2c-1-1-2-2-2-4a5 5 0 0 1 5-5zM10 17h4M10 20h4",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z",
  raidlog: "M12 2v6M12 16v6M2 12h6M16 12h6M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
};

export function icon(name, size = 16) {
  const d = PATHS[name] ?? PATHS.dashboard;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">
    <path d="${d}"/></svg>`;
}

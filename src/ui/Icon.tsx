import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  cube: "M12 2 3 7v10l9 5 9-5V7L12 2Zm0 10v10M3 7l9 5 9-5M7.5 4.5l9 5v5",
  drone:
    "M9 9l-5-5m11 5 5-5M9 15l-5 5m11-5 5 5M8 8h8v8H8zM1 4h6M4 1v6m13-3h6M20 1v6M1 20h6m-3-3v6m13-3h6m-3-3v6",
  cursor: "m5 3 14 10-7 1-3 7L5 3Z",
  move: "M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4",
  rotate: "M20 8a9 9 0 1 0 1 7M20 2v6h-6",
  scale: "M14 3h7v7M21 3l-8 8M3 10h7v11H3z",
  plus: "M12 4v16M4 12h16",
  minus: "M5 12h14",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  hidden:
    "m3 3 18 18M10 5h2c6 0 10 7 10 7s-1 2-3 4M6 6c-3 2-4 6-4 6s4 7 10 7c2 0 4-1 5-2",
  lock: "M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4",
  unlock: "M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0",
  play: "m8 4 13 8-13 8V4Z",
  pause: "M8 4v16M16 4v16",
  stop: "M6 6h12v12H6z",
  save: "M5 3h12l4 4v14H3V3h2Zm2 0v7h10V3M7 21v-7h10v7",
  open: "M3 7h7l2 3h10l-3 10H3V7Zm0 0V4h7l2 3h7v3",
  undo: "M8 4 3 9l5 5M3 9h12a6 6 0 0 1 0 12",
  redo: "m16 4 5 5-5 5m5-5H9a6 6 0 0 0 0 12",
  close: "m6 6 12 12M6 18 18 6",
  menu: "M4 6h16M4 12h16M4 18h16",
  panel: "M3 4h18v16H3zM9 4v16",
  target: "M12 2v4m0 12v4M2 12h4m12 0h4M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12",
  point:
    "M12 22s8-8 8-13a8 8 0 1 0-16 0c0 5 8 13 8 13Zm0-16a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  camera: "M3 7h4l2-3h6l2 3h4v13H3V7Zm9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  layers: "m12 3 10 6-10 6L2 9l10-6ZM2 13l10 6 10-6M2 17l10 6 10-6",
  grid: "M3 3h18v18H3zM9 3v18m6-18v18M3 9h18M3 15h18",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  copy: "M9 9h12v12H9zM15 9V3H3v12h6",
  search: "M16 16l6 6M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16",
  cylinder: "M4 6c0-5 16-5 16 0v12c0 5-16 5-16 0V6Zm0 0c0 5 16 5 16 0",
  building: "M4 21V3h12v18M16 9h4v12M8 7h4M8 11h4M8 15h4M8 19h4",
  upload: "M12 16V2m-5 5 5-5 5 5M3 16v6h18v-6",
  download: "M12 2v14m-5-5 5 5 5-5M3 16v6h18v-6",
  more: "M4 12h.01M12 12h.01M20 12h.01",
  check: "m4 12 5 5L20 6",
  home: "m2 11 10-9 10 9M5 9v12h14V9M9 21v-8h6v8",
  flask: "M9 2h6M10 2v7L3 20c-.3.5 0 2 1 2h16c1 0 1.3-1.5 1-2L14 9V2M6 15h12",
  help: "M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4m0 3h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20",
  up: "m6 15 6-6 6 6",
  frame: "M4 2v20M20 2v20M2 4h20M2 20h20",
};
export function Icon({
  name,
  size = 16,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name] ?? paths.cube} />
    </svg>
  );
}

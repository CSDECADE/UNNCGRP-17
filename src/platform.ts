const platform =
  window.p15Desktop?.platform ??
  (navigator.platform.includes("Mac") ? "darwin" : "win32");
const modifier = platform === "darwin" ? "⌘" : "Ctrl";
export const shortcuts = {
  save: `${modifier} S`,
  undo: `${modifier} Z`,
  redo: platform === "darwin" ? "⇧ ⌘ Z" : "Ctrl Shift Z",
};

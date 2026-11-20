export function downloadText(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.replace(/[\\/:*?"<>|]/g, "-");
  try { document.body.appendChild(anchor); anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

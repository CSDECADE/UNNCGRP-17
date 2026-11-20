// Plain OBJ text and project JSON have separate budgets. Project geometry remains
// subject to the existing 5 MB serialized-project limit after parsing.
export const MAX_OBJ_FILE_BYTES = 16_000_000;

export function objFileName(name: string): string {
  let base = name.replace(/\.obj$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 156).replace(/[\uD800-\uDBFF]$/, "");
  if (!base) base = "model";
  return `${base}.obj`;
}

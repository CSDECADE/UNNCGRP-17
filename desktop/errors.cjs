const knownCodes = new Set(["TOO_LARGE", "INVALID_JSON", "NOT_FILE", "EXPIRED"]);
function fileError(code) {
  const error = new Error(code === "TOO_LARGE" ? "文件不得超过 5 MB" : code);
  error.code = code;
  return error;
}
function publicErrorCode(error) {
  const code = error?.code;
  if (knownCodes.has(code)) return code;
  if (["EACCES", "EPERM"].includes(code)) return "PERMISSION";
  if (["ENOENT", "ENOTDIR"].includes(code)) return "NOT_FOUND";
  if (["ENOSPC", "EDQUOT"].includes(code)) return "NO_SPACE";
  if (code === "EROFS") return "READ_ONLY";
  if (code === "EISDIR") return "NOT_FILE";
  return "UNKNOWN";
}
module.exports = { fileError, publicErrorCode };

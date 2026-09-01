export function normalizeUnicode(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function normalizeFilename(value) {
  const raw = String(value ?? "");
  const decoded = looksLikeMojibake(raw)
    ? Buffer.from(raw, "latin1").toString("utf8")
    : raw;

  return normalizeUnicode(decoded).trim();
}

function looksLikeMojibake(value) {
  return /Ã.|Â.|â€|â€™|â€œ|â€\u009d|â€“|â€”/.test(value);
}

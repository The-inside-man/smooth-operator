function isModelLink(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'huggingface.co' && !url.username && !url.password && !url.port;
  } catch { return false; }
}
module.exports = { isModelLink };

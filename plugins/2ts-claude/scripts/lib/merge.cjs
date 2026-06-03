// merge.cjs — pure, fs-free transforms used by the apply engine.
// Marker-delimited block upsert for CLAUDE.md, array union for settings, and hashing.

const crypto = require('crypto');

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function beginMarker(id) {
  return `<!-- BEGIN 2ts-claude:${id} -->`;
}
function endMarker(id) {
  return `<!-- END 2ts-claude:${id} -->`;
}

// Insert or replace a marker-delimited block inside `fileContent`.
// Returns { content, action, existingBody } where action is
// 'create' | 'append' | 'replace' | 'noop' and existingBody is the current
// text between the markers (null when the markers are absent).
function upsertBlock(fileContent, id, blockBody) {
  const begin = beginMarker(id);
  const end = endMarker(id);
  const wrapped = `${begin}\n${blockBody.replace(/\n+$/, '')}\n${end}`;

  if (fileContent == null || fileContent === '') {
    return { content: `${wrapped}\n`, action: 'create', existingBody: null };
  }

  const beginIdx = fileContent.indexOf(begin);
  const endIdx = fileContent.indexOf(end);

  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    // No managed block yet — append, preserving the user's content untouched.
    const sep = fileContent.endsWith('\n') ? '\n' : '\n\n';
    return { content: `${fileContent}${sep}${wrapped}\n`, action: 'append', existingBody: null };
  }

  const existingBody = fileContent.slice(beginIdx + begin.length, endIdx).replace(/^\n/, '').replace(/\n$/, '');
  if (existingBody === blockBody.replace(/\n+$/, '')) {
    return { content: fileContent, action: 'noop', existingBody };
  }
  const before = fileContent.slice(0, beginIdx);
  const after = fileContent.slice(endIdx + end.length);
  return { content: `${before}${wrapped}${after}`, action: 'replace', existingBody };
}

// Read the current body between a block's markers, or null if absent.
function readBlockBody(fileContent, id) {
  if (!fileContent) return null;
  const begin = beginMarker(id);
  const end = endMarker(id);
  const beginIdx = fileContent.indexOf(begin);
  const endIdx = fileContent.indexOf(end);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return null;
  return fileContent.slice(beginIdx + begin.length, endIdx).replace(/^\n/, '').replace(/\n$/, '');
}

// Remove a marker-delimited block. Returns the content with the block (and a
// trailing blank line, if any) stripped; unchanged when the block is absent.
function removeBlock(fileContent, id) {
  if (!fileContent) return fileContent;
  const begin = beginMarker(id);
  const end = endMarker(id);
  const beginIdx = fileContent.indexOf(begin);
  const endIdx = fileContent.indexOf(end);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return fileContent;
  const before = fileContent.slice(0, beginIdx).replace(/\n+$/, '\n');
  const after = fileContent.slice(endIdx + end.length).replace(/^\n+/, '');
  return `${before}${after}`.replace(/\n{3,}/g, '\n\n');
}

// Union two arrays, preserving order and de-duplicating by JSON identity.
// Returns { result, added } where `added` is the items not already present.
function unionArray(existing, additions) {
  const base = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(base.map((v) => JSON.stringify(v)));
  const added = [];
  for (const item of additions || []) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      base.push(item);
      added.push(item);
    }
  }
  return { result: base, added };
}

module.exports = {
  sha256,
  beginMarker,
  endMarker,
  upsertBlock,
  readBlockBody,
  removeBlock,
  unionArray,
};

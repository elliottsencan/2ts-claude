// manifest.cjs — read/write .claude/.2ts-claude.json, the record of everything
// the engine added to a target repo. Drives idempotent re-apply, conflict
// detection, and clean removal.

const fs = require('fs');
const path = require('path');

const MANIFEST_REL = path.join('.claude', '.2ts-claude.json');
const SCHEMA_VERSION = 1;

function manifestPath(repoRoot) {
  return path.join(repoRoot, MANIFEST_REL);
}

function empty() {
  return {
    schema: SCHEMA_VERSION,
    pluginVersion: null, // plugin version recorded at last apply (drift detection)
    components: [],
    files: [], // { path, sha256 } — repo-relative
    settings: { allow: [], deny: [], hooks: [], scalars: {} }, // hooks: { event, command }
    claudeMd: {}, // { [blockId]: { sha256, file } } — file = where the block landed (CLAUDE.md or AGENTS.md)
    mcp: [], // server names we added
  };
}

function read(repoRoot) {
  const p = manifestPath(repoRoot);
  if (!fs.existsSync(p)) return empty(); // absent: fine, start fresh
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...empty(), ...parsed, settings: { ...empty().settings, ...(parsed.settings || {}) } };
  } catch (err) {
    // A present-but-unparseable manifest (e.g. committed git conflict markers)
    // is NOT the same as no manifest. Returning empty() would silently disable
    // conflict detection and could overwrite the user's edits, then overwrite
    // the file itself. Refuse instead.
    const e = new Error(
      `2ts-claude manifest at ${p} is present but unparseable (${err.message}). ` +
        `Refusing to proceed — this would disable conflict detection. Fix or delete the file, then re-run.`,
    );
    e.code = 'MANIFEST_CORRUPT';
    throw e;
  }
}

function write(repoRoot, manifest) {
  const p = manifestPath(repoRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
}

function fileEntry(manifest, relPath) {
  return manifest.files.find((f) => f.path === relPath) || null;
}

module.exports = {
  MANIFEST_REL,
  SCHEMA_VERSION,
  manifestPath,
  empty,
  read,
  write,
  fileEntry,
};

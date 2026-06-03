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
    claudeMd: {}, // { [blockId]: { sha256 } }
    mcp: [], // server names we added
  };
}

function read(repoRoot) {
  const p = manifestPath(repoRoot);
  if (!fs.existsSync(p)) return empty();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...empty(), ...parsed, settings: { ...empty().settings, ...(parsed.settings || {}) } };
  } catch {
    return empty();
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

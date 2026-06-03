// components.cjs — the registry of selectable components.
//
// Each component is a list of operations the engine executes against a target
// repo. `src` paths are relative to the plugin root (CLAUDE_PLUGIN_ROOT);
// `dest` paths are relative to the target repo root.
//
// Operation types (handled in apply.cjs):
//   vendorFile      { src, dest, executable? }   copy a file into the repo, hashed in the manifest
//   conventions     { id, src }                   upsert a marker block (AGENTS.md if present, else CLAUDE.md) + @AGENTS.md import
//   mergeSettings   { src }                       deep-merge a settings JSON (allow/deny union, scalars set-if-absent)
//   settingsScalar  { keyPath, value }            set a dotted settings key only if absent
//   hookWire        { event, matcher, command }   append a hook entry into .claude/settings.json
//   mergeMcp        { src }                       union mcpServers from a JSON file into <repo>/.mcp.json

function hookCommand(rel) {
  return `node "$\{CLAUDE_PROJECT_DIR}/${rel}"`;
}

function vendorHook(srcRel, destRel) {
  return { type: 'vendorFile', src: srcRel, dest: destRel };
}

const COMPONENTS = {
  'safety-hooks': {
    title: 'Safety hooks',
    description: 'Block destructive shell commands and protect secrets/.env files.',
    default: true,
    ops: [
      vendorHook('hooks/pre-tool-use/block-dangerous-commands.cjs', '.claude/hooks/pre-tool-use/block-dangerous-commands.cjs'),
      { type: 'hookWire', event: 'PreToolUse', matcher: 'Bash', command: hookCommand('.claude/hooks/pre-tool-use/block-dangerous-commands.cjs') },
      vendorHook('hooks/pre-tool-use/protect-secrets.cjs', '.claude/hooks/pre-tool-use/protect-secrets.cjs'),
      { type: 'hookWire', event: 'PreToolUse', matcher: 'Read|Edit|Write|Bash', command: hookCommand('.claude/hooks/pre-tool-use/protect-secrets.cjs') },
    ],
  },

  conventions: {
    title: 'Conventions block',
    description: 'Insert shared coding conventions as a managed block (AGENTS.md if present, else CLAUDE.md).',
    default: true,
    ops: [{ type: 'conventions', id: 'conventions', src: 'assets/claude-md.md' }],
  },

  settings: {
    title: 'Permission defaults',
    description: 'Merge a permission allow-list and a narrow secret-file deny-list into .claude/settings.json.',
    default: true,
    ops: [{ type: 'mergeSettings', src: 'assets/settings-defaults.json' }],
  },

  'workflow-hooks': {
    title: 'Workflow hooks',
    description: 'Format files with Prettier on edit, lint with ESLint --fix (where configured), and auto-stage assistant changes.',
    default: false,
    ops: [
      vendorHook('hooks/post-tool-use/format-on-edit.cjs', '.claude/hooks/post-tool-use/format-on-edit.cjs'),
      { type: 'hookWire', event: 'PostToolUse', matcher: 'Edit|Write', command: hookCommand('.claude/hooks/post-tool-use/format-on-edit.cjs') },
      vendorHook('hooks/post-tool-use/lint-on-edit.cjs', '.claude/hooks/post-tool-use/lint-on-edit.cjs'),
      { type: 'hookWire', event: 'PostToolUse', matcher: 'Edit|Write', command: hookCommand('.claude/hooks/post-tool-use/lint-on-edit.cjs') },
      vendorHook('hooks/post-tool-use/auto-stage.cjs', '.claude/hooks/post-tool-use/auto-stage.cjs'),
      { type: 'hookWire', event: 'PostToolUse', matcher: 'Edit|Write', command: hookCommand('.claude/hooks/post-tool-use/auto-stage.cjs') },
    ],
  },

  'notify-hook': {
    title: 'Permission notifications',
    description: 'Send a Slack message when the assistant needs input (requires CCH_SLA_WEBHOOK).',
    default: false,
    ops: [
      vendorHook('hooks/notification/notify-permission.cjs', '.claude/hooks/notification/notify-permission.cjs'),
      { type: 'hookWire', event: 'Notification', matcher: 'permission_prompt|idle_prompt|elicitation_dialog', command: hookCommand('.claude/hooks/notification/notify-permission.cjs') },
    ],
  },

  statusline: {
    title: 'Status line',
    description: 'Status line showing model, git branch, and a context-usage bar.',
    default: false,
    ops: [
      { type: 'vendorFile', src: 'assets/statusline.sh', dest: '.claude/statusline.sh', executable: true },
      { type: 'settingsScalar', keyPath: 'statusLine', value: { type: 'command', command: 'bash "$\{CLAUDE_PROJECT_DIR}/.claude/statusline.sh"' } },
    ],
  },

  mcp: {
    title: 'MCP servers',
    description: 'Add context7 and playwright MCP servers to .mcp.json.',
    default: false,
    ops: [{ type: 'mergeMcp', src: 'assets/mcp.json' }],
  },

  'ci-secret-scan': {
    title: 'CI secret scan',
    description: 'Add a gitleaks GitHub Action that scans for committed secrets on push/PR (runs in CI, no local friction).',
    default: false,
    ops: [{ type: 'vendorFile', src: 'assets/github/secret-scan.yml', dest: '.github/workflows/secret-scan.yml' }],
  },

  editorconfig: {
    title: 'EditorConfig',
    description: 'Add a portable .editorconfig (utf-8, lf, final newline, 2-space) every editor and agent honors.',
    default: false,
    ops: [{ type: 'vendorFile', src: 'assets/editorconfig', dest: '.editorconfig' }],
  },

  gitattributes: {
    title: 'Git attributes',
    description: 'Add a .gitattributes that normalizes line endings and keeps lockfiles out of diffs/language stats.',
    default: false,
    ops: [{ type: 'vendorFile', src: 'assets/gitattributes', dest: '.gitattributes' }],
  },

  'pr-template': {
    title: 'PR template',
    description: 'Add a short .github/pull_request_template.md (summary, changes, testing, risk/rollback, linked issues).',
    default: false,
    ops: [{ type: 'vendorFile', src: 'assets/github/pull_request_template.md', dest: '.github/pull_request_template.md' }],
  },

  dependabot: {
    title: 'Dependabot',
    description: 'Add a grouped, weekly Dependabot config for github-actions and npm (low PR noise).',
    default: false,
    ops: [{ type: 'vendorFile', src: 'assets/github/dependabot.yml', dest: '.github/dependabot.yml' }],
  },

  agents: {
    title: 'Review agents',
    description: 'Add the code-reviewer and bug-hunter subagents.',
    default: false,
    ops: [
      { type: 'vendorFile', src: 'agents/code-reviewer.md', dest: '.claude/agents/code-reviewer.md' },
      { type: 'vendorFile', src: 'agents/bug-hunter.md', dest: '.claude/agents/bug-hunter.md' },
    ],
  },

  'skill-code-standards': {
    title: 'code-standards skill',
    description: 'Add the code-standards skill (logging, comments, review, debugging).',
    default: false,
    ops: [{ type: 'vendorFile', src: 'skills/code-standards/SKILL.md', dest: '.claude/skills/code-standards/SKILL.md' }],
  },

  'command-handoff': {
    title: 'handoff command',
    description: 'Add the /handoff command for passing work to another session.',
    default: false,
    ops: [{ type: 'vendorFile', src: 'commands/handoff.md', dest: '.claude/commands/handoff.md' }],
  },

  'command-pr': {
    title: 'pr command',
    description: 'Add the /pr command that drafts a copy-ready PR title and body from the branch state.',
    default: false,
    ops: [{ type: 'vendorFile', src: 'commands/pr.md', dest: '.claude/commands/pr.md' }],
  },
};

function scopeOf(id) {
  return COMPONENTS[id].scope || 'shared';
}

function defaultComponents() {
  return Object.keys(COMPONENTS).filter((id) => COMPONENTS[id].default);
}

function allComponents() {
  return Object.keys(COMPONENTS);
}

function resolve(selection) {
  if (!selection || selection === 'default') return defaultComponents();
  if (selection === 'all' || (Array.isArray(selection) && selection.includes('all'))) return allComponents();
  const ids = Array.isArray(selection) ? selection : String(selection).split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !COMPONENTS[id]);
  if (unknown.length) throw new Error(`Unknown component(s): ${unknown.join(', ')}`);
  return ids;
}

module.exports = { COMPONENTS, scopeOf, defaultComponents, allComponents, resolve };

# Changelog

## [0.4.0](https://github.com/elliottsencan/2ts-claude/compare/v0.3.0...v0.4.0) (2026-06-03)


### Features

* add AGENTS.md interop, deny defaults, CI secret scan, drift reminder ([90c5b3b](https://github.com/elliottsencan/2ts-claude/commit/90c5b3bb870b1886506376a9721ed3b811b79dc5))
* AGENTS.md interop, deny defaults, CI secret scan, drift reminder ([241e867](https://github.com/elliottsencan/2ts-claude/commit/241e86779329a845fc2d08d08ff017e8f5dd7fd5))
* drift reminder also checks latest published version ([8950642](https://github.com/elliottsencan/2ts-claude/commit/89506425179e9a80ea8a61812a684b123b82b46d))


### Bug Fixes

* address PR review — AGENTS.md migration, corrupt-manifest safety, hook deadline ([9ae6201](https://github.com/elliottsencan/2ts-claude/commit/9ae62018d8066b8e9d2c6adb93106c921bccc6bb))

## [0.3.0](https://github.com/elliottsencan/2ts-claude/compare/v0.2.0...v0.3.0) (2026-06-03)


### Features

* /setup applier for durable, non-clobbering repo defaults ([55d4093](https://github.com/elliottsencan/2ts-claude/commit/55d4093f7b2fd3fb1aa5f241443a4d3ad920a0a5))
* add /setup applier that durably stamps defaults into a repo ([321d51b](https://github.com/elliottsencan/2ts-claude/commit/321d51bb01d413191d9255589647ce79a3e49632))

## [0.2.0](https://github.com/elliottsencan/2ts-claude/compare/v0.1.1...v0.2.0) (2026-06-02)


### Features

* add git acp + Claude commit-message helpers ([fdd157b](https://github.com/elliottsencan/2ts-claude/commit/fdd157ba935bbb78bc272ccc630ae406416af1cf))
* add git acp + Claude commit-message helpers ([3e1e538](https://github.com/elliottsencan/2ts-claude/commit/3e1e538e855da6c19f00e0df3fc412b5a58152a6))

## [0.1.1](https://github.com/elliottsencan/2ts-claude/compare/v0.1.0...v0.1.1) (2026-06-02)


### Bug Fixes

* write hook logs under CLAUDE_CONFIG_DIR when set ([70cd51d](https://github.com/elliottsencan/2ts-claude/commit/70cd51d370de4e7de319d8464edf7bfc264c77b7))

## 0.1.0

- Initial toolkit.
- Hooks: `block-dangerous-commands`, `protect-secrets`, `auto-stage`, `format-on-edit`, `notify-permission` (default safety level `high`).
- Agents: `code-reviewer`, `bug-hunter`.
- Skills: `code-standards`.
- Command: `handoff`.
- Templates: personal `CLAUDE.md`, `settings.json`, `.mcp.json`, `statusline.sh`.
- Scripts: `install.sh`, `sync.sh`, `migrate-repo.sh`.

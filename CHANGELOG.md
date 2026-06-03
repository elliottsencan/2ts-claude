# Changelog

## [0.7.0](https://github.com/elliottsencan/2ts-claude/compare/v0.6.0...v0.7.0) (2026-06-03)


### Features

* split vendor templates from ambient surface; interactive /setup ([8a402b6](https://github.com/elliottsencan/2ts-claude/commit/8a402b6af4e86643accc80904b4da48379095c0d))
* split vendor templates from the plugin's ambient surface; interactive /setup ([9f28163](https://github.com/elliottsencan/2ts-claude/commit/9f281638984f4fd80fdaf7c0df3fbb6b85349d31))

## [0.6.0](https://github.com/elliottsencan/2ts-claude/compare/v0.5.0...v0.6.0) (2026-06-03)


### Features

* add local component scope ([15bd7e7](https://github.com/elliottsencan/2ts-claude/commit/15bd7e789f72ffca97b8e2c6a24fb920162a47aa))
* add wiki scorer, /wiki command, and surface hook (local scope) ([d139b26](https://github.com/elliottsencan/2ts-claude/commit/d139b26b0c12a720f12664dbae19ccc154059657))
* local component scope + personal wiki query (/wiki + surface hook) ([962dd87](https://github.com/elliottsencan/2ts-claude/commit/962dd87199baaf21bf91000aeaa3d13d9c8ca270))

## [0.5.0](https://github.com/elliottsencan/2ts-claude/compare/v0.4.0...v0.5.0) (2026-06-03)


### Features

* add /pr command via command-pr component ([4d2c128](https://github.com/elliottsencan/2ts-claude/commit/4d2c12851f001d7cac01e3d06699aaf5c8f2150b))
* add dependabot component ([c5a7a08](https://github.com/elliottsencan/2ts-claude/commit/c5a7a08d225248d972bdd0ff85cc0d521a6a1eda))
* add durable repo-default components ([84bdce3](https://github.com/elliottsencan/2ts-claude/commit/84bdce35a0d14404b74039c9404348ef6679a4ba))
* add editorconfig component ([3c54049](https://github.com/elliottsencan/2ts-claude/commit/3c54049b080ba59232c3ab5129ef2dcef9abde3d))
* add gitattributes component ([290fc28](https://github.com/elliottsencan/2ts-claude/commit/290fc282948038f334e8f8e5a3f39966dea9db04))
* add lint-on-edit hook to workflow-hooks component ([a5bd657](https://github.com/elliottsencan/2ts-claude/commit/a5bd657538e795ee9c09ada1f932ab60033af296))
* add pr-template component ([25e1ab2](https://github.com/elliottsencan/2ts-claude/commit/25e1ab291424925092fb2b14d1e8af7a525b7888))
* allow typecheck and lint commands without a prompt ([bd6bc8f](https://github.com/elliottsencan/2ts-claude/commit/bd6bc8fab05f743534efe41847e0d11e8f1bb494))
* treat agent and MCP output as untrusted input ([c7423db](https://github.com/elliottsencan/2ts-claude/commit/c7423dba1c9c046f90de4dcb4b2a75a3a6c7ee89))

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

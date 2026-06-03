#!/usr/bin/env node
// Tests for the SessionStart drift reminder. Run: node --test

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { compareVersions, checkStale } = require('../../session-start/version-reminder.cjs');

describe('compareVersions', () => {
  it('orders versions correctly', () => {
    assert.equal(compareVersions('0.2.0', '0.5.0'), -1);
    assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
    assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
    assert.equal(compareVersions('0.2', '0.2.1'), -1);
  });
});

describe('checkStale', () => {
  let project, plugin;
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), '2ts-proj-'));
    plugin = fs.mkdtempSync(path.join(os.tmpdir(), '2ts-plugin-'));
    fs.writeFileSync(path.join(plugin, 'plugin.json'), JSON.stringify({ version: '0.5.0' }));
  });
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  });
  function writeManifest(version) {
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', '.2ts-claude.json'), JSON.stringify({ pluginVersion: version }));
  }

  it('returns a reminder when the repo is behind', () => {
    writeManifest('0.2.0');
    const r = checkStale(project, plugin);
    assert.match(r, /stale/);
    assert.match(r, /0\.2\.0/);
    assert.match(r, /0\.5\.0/);
  });

  it('is silent when up to date', () => {
    writeManifest('0.5.0');
    assert.equal(checkStale(project, plugin), null);
  });

  it('is silent when there is no manifest (repo never set up)', () => {
    assert.equal(checkStale(project, plugin), null);
  });

  it('is silent when the manifest has no recorded version', () => {
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', '.2ts-claude.json'), JSON.stringify({}));
    assert.equal(checkStale(project, plugin), null);
  });
});

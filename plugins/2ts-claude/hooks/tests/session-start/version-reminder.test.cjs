#!/usr/bin/env node
// Tests for the SessionStart drift reminder. Run: node --test

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { compareVersions, checkStale, getLatestPublished, buildPublishedReminder } = require('../../session-start/version-reminder.cjs');

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

describe('buildPublishedReminder', () => {
  it('nudges when the installed plugin is behind the latest published', () => {
    const msg = buildPublishedReminder('0.3.0', '0.5.0');
    assert.match(msg, /claude plugin update/);
    assert.match(msg, /0\.3\.0/);
    assert.match(msg, /0\.5\.0/);
  });
  it('is silent when installed is current or ahead', () => {
    assert.equal(buildPublishedReminder('0.5.0', '0.5.0'), null);
    assert.equal(buildPublishedReminder('0.6.0', '0.5.0'), null);
    assert.equal(buildPublishedReminder('0.5.0', null), null);
  });
});

describe('getLatestPublished (cache + timeout, no real network)', () => {
  let cfg;
  beforeEach(() => {
    cfg = fs.mkdtempSync(path.join(os.tmpdir(), '2ts-cfg-'));
    process.env.CLAUDE_CONFIG_DIR = cfg;
  });
  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(cfg, { recursive: true, force: true });
  });

  it('fetches, caches, and reuses the cache within the TTL', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return '0.9.0';
    };
    const now = 1_000_000;
    assert.equal(await getLatestPublished({ now, fetcher }), '0.9.0');
    assert.equal(calls, 1, 'fetched once');
    // Second call within TTL must hit the cache, not the fetcher.
    assert.equal(await getLatestPublished({ now: now + 1000, fetcher }), '0.9.0');
    assert.equal(calls, 1, 'served from cache');
  });

  it('refetches after the TTL expires', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return calls === 1 ? '0.9.0' : '1.0.0';
    };
    const now = 1_000_000;
    await getLatestPublished({ now, fetcher });
    const later = now + 25 * 60 * 60 * 1000; // > 24h
    assert.equal(await getLatestPublished({ now: later, fetcher }), '1.0.0');
    assert.equal(calls, 2);
  });

  it('falls back to a stale cache when the fetch fails', async () => {
    const now = 1_000_000;
    await getLatestPublished({ now, fetcher: async () => '0.9.0' });
    const later = now + 25 * 60 * 60 * 1000;
    const r = await getLatestPublished({ now: later, fetcher: async () => null });
    assert.equal(r, '0.9.0', 'stale cache used on failure');
  });

  it('returns null when there is no cache and the fetch fails', async () => {
    assert.equal(await getLatestPublished({ now: 1, fetcher: async () => null }), null);
  });
});

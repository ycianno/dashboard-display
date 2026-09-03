#!/usr/bin/env node
'use strict';

/*
 * Parse every JavaScript file in the project.
 *
 * There is no build step here — that is the point of the project — which also
 * means nothing catches a typo until the kiosk browser silently renders a
 * blank page behind a taskbar in another room. This is the cheapest thing
 * that would have caught it.
 *
 * `node --check` decides CommonJS or ESM from the file extension, and the
 * browser files are ES modules with a `.js` extension. So those are checked
 * through a temporary `.mjs` copy rather than by turning on the experimental
 * vm-modules flag: same parser, no flag, no warning.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'scripts']);

// Everything under these directories is browser-side ES modules.
const MODULE_DIRS = ['js'];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}

function check(file, asModule) {
  let target = file;
  let temp = null;

  if (asModule) {
    temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-check-')), 'mod.mjs');
    fs.copyFileSync(file, temp);
    target = temp;
  }

  const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (temp) fs.rmSync(path.dirname(temp), { recursive: true, force: true });

  return result.status === 0
    ? null
    : (result.stderr || '').split('\n').filter(Boolean).slice(0, 3).join(' ');
}

const files = walk(ROOT).sort();
const failures = [];

files.forEach((file) => {
  const relative = path.relative(ROOT, file);
  const asModule = MODULE_DIRS.some((dir) => relative.startsWith(dir + path.sep));
  const error = check(file, asModule);
  if (error) failures.push(`${relative}\n      ${error}`);
});

if (failures.length) {
  console.error(`✗ ${failures.length} file(s) failed to parse:\n`);
  failures.forEach((line) => console.error(`  ${line}\n`));
  process.exit(1);
}

console.log(`✓ ${files.length} JavaScript files parse cleanly.`);

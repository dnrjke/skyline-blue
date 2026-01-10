import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = ['src', 'public', 'docs', 'scripts'];
const EXT_ALLOW = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.txt', '.html']);

function isIgnoredDir(name) {
  return name === 'node_modules' || name === 'dist' || name === '.git';
}

function hasUtf8Bom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

function hasUtf16Bom(buf) {
  return buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff));
}

function looksUtf16Le(buf) {
  // heuristic: many NUL bytes at odd positions in the first 128 bytes
  const n = Math.min(buf.length, 128);
  if (n < 8) return false;
  let nulOdd = 0;
  let checked = 0;
  for (let i = 1; i < n; i += 2) {
    checked++;
    if (buf[i] === 0x00) nulOdd++;
  }
  return checked > 0 && nulOdd / checked > 0.6;
}

function containsNul(buf) {
  // any NUL in first 4KB is enough to treat as broken text encoding for this repo
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0x00) return true;
  }
  return false;
}

async function walk(dirAbs, outFiles) {
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (isIgnoredDir(e.name)) continue;
      await walk(path.join(dirAbs, e.name), outFiles);
      continue;
    }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!EXT_ALLOW.has(ext)) continue;
    outFiles.push(path.join(dirAbs, e.name));
  }
}

const files = [];
for (const d of TARGET_DIRS) {
  await walk(path.join(ROOT, d), files);
}

const bad = [];
for (const f of files) {
  const buf = await fs.readFile(f);
  if (hasUtf16Bom(buf) || looksUtf16Le(buf) || containsNul(buf)) {
    bad.push({ file: f, reason: 'UTF-16 / NUL bytes detected (must be UTF-8 no BOM)' });
    continue;
  }
  if (hasUtf8Bom(buf)) {
    bad.push({ file: f, reason: 'UTF-8 BOM detected (must be UTF-8 without BOM)' });
  }
}

if (bad.length > 0) {
  console.error('[EncodingCheck] FAILED');
  for (const b of bad) {
    console.error(`- ${path.relative(ROOT, b.file)} :: ${b.reason}`);
  }
  console.error('\nFix: 파일을 UTF-8 (BOM 없음)으로 다시 저장하세요.');
  process.exit(1);
}

console.log(`[EncodingCheck] OK (${files.length} files)`);
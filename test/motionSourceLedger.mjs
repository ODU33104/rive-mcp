import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const inventory = JSON.parse(readFileSync(new URL('../data/motion-recipes/source-candidates-2026.json', import.meta.url), 'utf8'));
const ledger = readFileSync(new URL('../docs/MOTION_SOURCE_LEDGER_2026.md', import.meta.url), 'utf8');
const required = ['id', 'title', 'workUrl', 'author', 'site', 'publishedAt', 'format', 'featureTags', 'referenceRole', 'licenseStatus', 'licenseName', 'licenseEvidenceUrl', 'allowedUses', 'provenanceConfidence', 'notes'];
const uses = new Set(['link', 'manual-study', 'attributed-adaptation']);
const licenses = new Set(['verified', 'unknown', 'restricted']);
const confidence = new Set(['high', 'medium', 'low']);

function workUrl(url, id) {
  assert.equal(typeof url, 'string', `${id}: work URL must be a string`);
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:', `${id}: require HTTPS`);
  assert.ok(parsed.hostname.includes('.'), `${id}: require host`);
  assert.ok(parsed.pathname.split('/').filter(Boolean).length >= 2, `${id}: index roots are not individual examples`);
  assert.equal(parsed.hash, '', `${id}: prefer canonical URL, no fragments`);
  return parsed.href;
}

assert.equal(inventory.schemaVersion, 1);
assert.equal(inventory.researchedAt, '2026-10-12');
assert.ok(Array.isArray(inventory.candidates) && inventory.candidates.length >= 30, 'at least 30 actual work-level references');
const ids = new Set();
const urls = new Set();
for (const row of inventory.candidates) {
  assert.deepEqual(Object.keys(row).sort(), [...required].sort(), `${row.id}: required fields`);
  assert.match(row.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(!ids.has(row.id), `duplicate ID: ${row.id}`);
  ids.add(row.id);
  const url = workUrl(row.workUrl, row.id);
  assert.ok(!urls.has(url), `duplicate work URL: ${url}`);
  urls.add(url);
  for (const field of ['title', 'site', 'format', 'referenceRole', 'notes']) {
    assert.ok(typeof row[field] === 'string' && row[field].trim(), `${row.id}: ${field}`);
  }
  assert.ok(row.author === null || (typeof row.author === 'string' && row.author.trim()), `${row.id}: author`);
  if (row.publishedAt !== null) {
    assert.match(row.publishedAt, /^\d{4}-\d{2}-\d{2}$/, `${row.id}: exact date or null`);
    assert.equal(new Date(`${row.publishedAt}T00:00:00Z`).toISOString().slice(0, 10), row.publishedAt, `${row.id}: real date`);
    assert.ok(row.publishedAt <= inventory.researchedAt, `${row.id}: no future publication`);
  }
  assert.ok(Array.isArray(row.featureTags) && row.featureTags.length >= 2 && row.featureTags.every(tag => /^[a-z0-9][a-z0-9-]*$/.test(tag)), `${row.id}: tags`);
  assert.ok(licenses.has(row.licenseStatus) && confidence.has(row.provenanceConfidence), `${row.id}: evidence classification`);
  assert.ok(Array.isArray(row.allowedUses) && row.allowedUses.includes('link') && row.allowedUses.every(v => uses.has(v)), `${row.id}: allowedUses`);
  assert.equal(new Set(row.allowedUses).size, row.allowedUses.length, `${row.id}: no repeated allowed uses`);
  if (row.licenseName !== null) {
    assert.ok(typeof row.licenseName === 'string' && row.licenseName.trim(), `${row.id}: license name`);
  }
  if (row.licenseEvidenceUrl !== null) {
    const evidence = new URL(row.licenseEvidenceUrl);
    assert.equal(evidence.protocol, 'https:', `${row.id}: license evidence HTTPS`);
    assert.ok(evidence.hostname.includes('.'), `${row.id}: license evidence host`);
  }
  if (row.licenseStatus === 'verified') {
    assert.ok(row.licenseName && row.licenseEvidenceUrl, `${row.id}: verified requires a named license and evidence`);
    assert.equal(row.licenseEvidenceUrl, row.workUrl, `${row.id}: work-level notice, not generic site license`);
  }
  if (row.licenseStatus === 'unknown') {
    assert.equal(row.licenseName, null, `${row.id}: don't guess a license`);
    assert.equal(row.licenseEvidenceUrl, null, `${row.id}: don't claim evidence absent`);
  }
  if (row.allowedUses.some(v => v !== 'link')) {
    assert.equal(row.licenseStatus, 'verified', `${row.id}: broader uses require work-level verification`);
    assert.equal(row.licenseName, 'CC BY 4.0', `${row.id}: adaptation only if work-level CC BY notice exists`);
  }
  if (row.licenseStatus !== 'verified') {
    assert.deepEqual(row.allowedUses, ['link'], `${row.id}: unresolved/restricted use remains link-only`);
  }
}
assert.ok(new Set(inventory.candidates.map(row => row.site)).size >= 5, 'at least five distinct research sites');
const shortlist = ['rive-interactive-hero', 'rive-floating-bot', 'rive-globe'];
assert.equal((ledger.match(/\*\*Priority [123] —/g) ?? []).length, 3, 'exactly three shortlist priorities');
for (const id of shortlist) {
  assert.ok(inventory.candidates.some(row => row.id === id && row.licenseStatus === 'verified'), `shortlist work-level rights: ${id}`);
  assert.ok(ledger.includes(`\`${id}\``), `shortlist references a real ID: ${id}`);
}
console.log(`motionSourceLedger: PASS — ${ids.size} unique example URLs; ${new Set(inventory.candidates.map(row => row.site)).size} sites; ${inventory.candidates.filter(row => row.licenseStatus === 'verified').length} work-level license notices; ${shortlist.length} shortlisted`);

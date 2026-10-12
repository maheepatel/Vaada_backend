import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { heuristic, normalizeDate, normalizeDraft } from '../src/extract.js';
import type { ExtractedDraft } from '../src/types.js';

const draft = (patch: Partial<ExtractedDraft> = {}): ExtractedDraft => ({
  title: 'Upgrade 50 schools', promiseText: 'The department will upgrade 50 schools.', sourceUrl: '',
  promisedOn: '', deadlineStart: '', deadlineEnd: '', deadlineLabel: '', state: '', district: '', category: 'Education',
  accountableOffice: '', confidence: {}, warnings: [], ...patch,
});

test('dates read from a press release become the YYYY-MM-DD the form and API require', () => {
  assert.equal(normalizeDate('12 March 2025'), '2025-03-12');
  assert.equal(normalizeDate('31 December 2025'), '2025-12-31');
  assert.equal(normalizeDate('March 12, 2025'), '2025-03-12');
  assert.equal(normalizeDate('1st Aug 2026'), '2026-08-01');
  assert.equal(normalizeDate('12/03/2025'), '2025-03-12');
  assert.equal(normalizeDate('2025-03-12'), '2025-03-12');
});

test('dates that are not one exact calendar day are cleared, never guessed', () => {
  assert.equal(normalizeDate('by the end of March'), '');
  assert.equal(normalizeDate('31 February 2025'), '');
  assert.equal(normalizeDate('2025-13-40'), '');
  assert.equal(normalizeDate('March 2025'), '');
  assert.equal(normalizeDate(''), '');
});

test('normalizeDraft cleans model output without inventing facts', () => {
  const out = normalizeDraft(draft({ promisedOn: '12 March 2025', deadlineEnd: '31 December 2025', deadlineLabel: 'by', district: 'Jaipur district', state: 'rajasthan' }));
  assert.equal(out.promisedOn, '2025-03-12');
  assert.equal(out.deadlineEnd, '2025-12-31');
  assert.equal(out.deadlineLabel, '');
  assert.equal(out.district, 'Jaipur');
  assert.equal(out.state, 'Rajasthan');
  assert.equal(out.deadlineStart, '');
});

test('an unreadable promise date is blanked and the reviewer is warned', () => {
  const out = normalizeDraft(draft({ promisedOn: 'sometime last year' }));
  assert.equal(out.promisedOn, '');
  assert.ok(out.warnings.some((item) => item.includes('sometime last year')));
});

test('a reversed completion window is cleared instead of failing submission later', () => {
  const out = normalizeDraft(draft({ deadlineStart: '2026-05-01', deadlineEnd: '2026-01-01' }));
  assert.equal(out.deadlineStart, '');
  assert.equal(out.deadlineEnd, '2026-01-01');
  assert.ok(out.warnings.length > 0);
});

test('heuristic extraction returns valid ISO dates and the same confidence keys as the AI path', () => {
  const out = heuristic('', 'On 12 March 2025 the Department of Education announced classrooms in Karnataka by next year.');
  assert.equal(out.promisedOn, '2025-03-12');
  assert.deepEqual(Object.keys(out.confidence).sort(), ['accountableOffice', 'category', 'deadlineEnd', 'deadlineLabel', 'deadlineStart', 'district', 'promiseText', 'promisedOn', 'state', 'title']);
});

test('service role grants and hardening migration closes the profile role escalation', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202608300008_service_role_grants_and_hardening.sql', import.meta.url), 'utf8');
  assert.match(sql, /grant all on all tables in schema public to service_role/);
  assert.match(sql, /revoke insert, update on public\.profiles from authenticated/);
  assert.match(sql, /revoke update on public\.media_assets from authenticated/);
});

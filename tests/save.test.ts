import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/engine';
import { parseSaveRecord } from '../src/save';

const record = (state: unknown) => JSON.stringify({ schema: 1, token: 'test', state });
test('legacy saves retain run progress and migrate depleted Guard exactly once', () => {
  const current = createGame(731);
  const legacy = { ...current, version: 1, round: 7, slot: 2 };
  legacy.enemies[0].guard = 1;
  legacy.enemies[0].maxGuard = 2;
  const parsed = parseSaveRecord(record(legacy))!;
  assert.equal(parsed.state.version, 2);
  assert.equal(parsed.state.round, 7);
  assert.equal(parsed.state.slot, 2);
  assert.equal(parsed.state.enemies[0].guard, 5);
  assert.equal(parsed.state.enemies[0].maxGuard, 10);
  assert.deepEqual(parseSaveRecord(record(parsed.state))!.state, parsed.state);
});
test('legacy frozen phases preserve interruption and clamp excess charge to 10', () => {
  const s = createGame(10);
  const legacy = { ...s, version: 1, phase: 'attack', resumePhase: 'resolve', slot: 3, charge: 25 };
  legacy.player.attunement = 11;
  const parsed = parseSaveRecord(record(legacy))!;
  assert.equal(parsed.state.charge, 10);
  assert.equal(parsed.state.player.attunement, 10);
  assert.equal(parsed.state.phase, 'attack');
  assert.equal(parsed.state.resumePhase, 'resolve');
  assert.equal(parsed.state.slot, 3);
});
test('new saves accept arbitrary integer Guard including 12 and 35', () => {
  const s = createGame(8);
  s.enemies[0].guard = 12;
  s.enemies[0].maxGuard = 35;
  assert.deepEqual(parseSaveRecord(record(s))!.state, s);
  s.enemies[0].guard = 12.5;
  assert.equal(parseSaveRecord(record(s)), null);
});
test('malformed saves and new saves above the attunement cap are rejected safely', () => {
  for (const raw of [null, '', '{', '{}', record({version: 1, enemies: [null]})]) assert.equal(parseSaveRecord(raw), null);
  const s = createGame(8);
  s.player.attunement = 11;
  assert.equal(parseSaveRecord(record(s)), null);
  s.player.attunement = 10; s.charge = 11;
  assert.equal(parseSaveRecord(record(s)), null);
});

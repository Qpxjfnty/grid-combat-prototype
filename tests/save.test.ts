import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, execute } from '../src/engine';
import { parseSaveRecord } from '../src/save';

const record = (state: unknown) => JSON.stringify({ schema: 1, token: 'test', state });
test('7x7 runs preserve progress and frozen time on reload', () => {
  const s = createGame(731);
  s.round = 7;
  s.player.attunement = 4;
  const frozen = execute(s, { type: 'beginAttack' });
  const parsed = parseSaveRecord(record(frozen))!;
  assert.deepEqual(parsed.state, frozen);
  assert.equal(parsed.state.version, 3);
  assert.equal(parsed.state.phase, 'attack');
  assert.equal(parsed.state.charge, 4);
  assert.equal(parsed.state.round, 7);
});
test('previous 9x9 and three-action saves cannot leak into the new rules', () => {
  for (const version of [1, 2]) assert.equal(parseSaveRecord(record({ ...createGame(1), version, slot: 2, resumePhase: 'normal' })), null);
  const s = createGame(1);
  s.player.x = 7;
  assert.equal(parseSaveRecord(record(s)), null);
  s.player.x = 3;
  s.walls.push({ x: 1, y: 8 });
  assert.equal(parseSaveRecord(record(s)), null);
});
test('new saves accept arbitrary integer Guard including 12 and 35', () => {
  const s = createGame(8);
  s.enemies[0].guard = 12;
  s.enemies[0].maxGuard = 35;
  assert.deepEqual(parseSaveRecord(record(s))!.state, s);
  s.enemies[0].guard = 12.5;
  assert.equal(parseSaveRecord(record(s)), null);
});
test('malformed saves and charge above the cap are rejected safely', () => {
  for (const raw of [null, '', '{', '{}', record({version: 3, enemies: [null]})]) assert.equal(parseSaveRecord(raw), null);
  const s = createGame(8);
  s.player.attunement = 11;
  assert.equal(parseSaveRecord(record(s)), null);
  s.player.attunement = 10; s.charge = 11;
  assert.equal(parseSaveRecord(record(s)), null);
});

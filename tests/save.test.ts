import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, execute, planEnemies } from '../src/engine';
import { PLAYER_MAX_HP, STATE_VERSION, type GameState } from '../src/model';
import { parseSaveRecord } from '../src/save';

const record = (state: unknown) => JSON.stringify({ schema: 1, token: 'test', state });
const legacy = (state: GameState = createGame(731), hp = 12, version: 3 | 4 = 3) => ({
  ...structuredClone(state), version, player: { ...state.player, hp, maxHp: version === 3 ? 12 : 3 },
  enemies: state.enemies.map(e => ({ ...structuredClone(e), intent: e.intent ? { destination: e.intent.destination, tiles: e.intent.tiles, heavy: e.intent.heavy, label: e.intent.label } : null })),
});

test('current 7x7 runs preserve progress and frozen time on reload', () => {
  const s = createGame(731);
  s.round = 7;
  s.player.attunement = 4;
  const frozen = execute(s, { type: 'beginAttack' });
  const parsed = parseSaveRecord(record(frozen))!;
  assert.deepEqual(parsed.state, frozen);
  assert.equal(parsed.state.version, STATE_VERSION);
  assert.equal(parsed.state.version, 5);
  assert.equal(parsed.state.phase, 'attack');
  assert.equal(parsed.state.charge, 4);
  assert.equal(parsed.state.round, 7);
  assert.equal(parsed.state.player.hp, PLAYER_MAX_HP);
  assert.equal(parsed.state.player.maxHp, PLAYER_MAX_HP);
});

test('compatible v3 saves clamp health to three while preserving injuries, death, and progress', () => {
  for (const hp of [12, 4, 3, 2, 1, 0]) {
    const original = legacy(createGame(731), hp);
    original.round = 19;
    original.player.attunement = 8;
    if (hp === 0) original.phase = 'lost';
    const parsed = parseSaveRecord(record(original))!;
    assert(parsed);
    assert.equal(parsed.schema, 1);
    assert.equal(parsed.token, 'test');
    assert.equal(parsed.state.version, 5);
    assert.equal(parsed.state.player.hp, Math.min(hp, 3));
    assert.equal(parsed.state.player.maxHp, 3);
    assert.equal(parsed.state.phase, hp === 0 ? 'lost' : 'normal');
    assert.equal(parsed.state.round, 19);
    assert.equal(parsed.state.player.attunement, 8);
    assert.equal(parsed.state.seed, original.seed);
    assert.equal(parsed.state.rng, original.rng);
    assert.deepEqual(parsed.state.walls, original.walls);
    assert.deepEqual(parseSaveRecord(JSON.stringify(parsed)), parsed, 'migration must be idempotent');
  }
});

test('legacy frozen migration refreshes plans but preserves time, budgets, vitals, and canceled intentions', () => {
  for (const version of [3, 4] as const) {
    const s = createGame(731);
    s.round = 7;
    s.player.attunement = 6;
    const frozen = execute(s, { type: 'beginAttack' });
    const original = legacy(frozen, version === 3 ? 9 : 2, version);
    const heavy = original.enemies.find(e => e.kind === 'heavy')!;
    assert(heavy.intent);
    heavy.intent.label = 'Heavy · 2 damage';
    const survivor = original.enemies.find(e => e.kind === 'sweep')!;
    survivor.removed = true;
    survivor.intent = null;
    const parsed = parseSaveRecord(record(original))!;
    assert(parsed);
    assert.equal(parsed.state.phase, 'attack');
    assert.equal(parsed.state.charge, 6);
    assert.equal(parsed.state.player.attunement, 0);
    assert.equal(parsed.state.player.hp, version === 3 ? 3 : 2);
    assert.equal(parsed.state.player.maxHp, 3);
    assert.equal(parsed.state.round, 7);
    assert.deepEqual(parsed.state.pulse, original.pulse);
    assert(parsed.state.enemies.find(e => e.kind === 'sweep')!.removed);
    assert.equal(parsed.state.enemies.find(e => e.kind === 'sweep')!.intent, null);
    const expected = structuredClone(parsed.state);
    expected.phase = 'normal';
    planEnemies(expected, new Set(original.enemies.filter(e => e.intent).map(e => e.id)));
    assert.deepEqual(parsed.state.enemies, expected.enemies);
    for (let i = 0; i < original.enemies.length; i++) {
      const { intent: before, opening: beforeOpening, ...vitalsBefore } = original.enemies[i];
      const { intent: after, opening: afterOpening, ...vitalsAfter } = parsed.state.enemies[i];
      assert.deepEqual(vitalsAfter, vitalsBefore, 'migration must not move, heal, or advance enemies');
      if (after) {
        assert(['none', 'dash', 'jump'].includes(after.movement));
        assert.equal(after.kind === 'attack', after.tiles.length > 0);
        assert(!after.label.includes('2 damage'));
      }
      if (!before) assert.equal(after, null, 'canceled intentions must stay canceled');
    }
    assert.deepEqual(parseSaveRecord(JSON.stringify(parsed)), parsed, 'new plans are not refreshed on each reload');
  }
});

test('v4 turning attacks are replaced with reachable forward attacks or approach moves', () => {
  const s = createGame(7);
  s.walls = [];
  s.player = { ...s.player, x: 3, y: 5, hp: 2, attunement: 7 };
  s.enemies = [{ ...s.enemies[0], x: 3, y: 0, kind: 'lunge', opening: false, cycle: 0 }];
  const original = legacy(s, 2, 4);
  original.enemies[0].intent = { destination: { x: 3, y: 6 }, tiles: [{ x: 3, y: 5 }], heavy: false, label: 'old turning lunge' };
  const parsed = parseSaveRecord(record(original))!.state;
  const intent = parsed.enemies[0].intent!;
  assert.equal(intent.kind, 'attack');
  assert.equal(intent.movement, 'dash');
  assert.equal(intent.direction, 4);
  assert.deepEqual(intent.destination, { x: 3, y: 3 });
  assert(intent.tiles.some(p => p.x === 3 && p.y === 5));
  assert.equal(parsed.player.hp, 2);
  assert.equal(parsed.player.attunement, 7);
});

test('malformed legacy health is rejected before migration can clamp it into range', () => {
  for (const fields of [
    { hp: 13, maxHp: 12 }, { hp: -1, maxHp: 12 }, { hp: 3.5, maxHp: 12 },
    { hp: null, maxHp: 12 }, { hp: '3', maxHp: 12 }, { hp: 0, maxHp: 0 },
    { hp: 3, maxHp: -1 }, { hp: 3, maxHp: 3.5 }, { hp: 3, maxHp: 101 },
  ]) {
    const s = legacy();
    assert.equal(parseSaveRecord(record({ ...s, player: { ...s.player, ...fields } })), null, JSON.stringify(fields));
  }
  const current = createGame(8);
  assert.equal(parseSaveRecord(record({ ...current, player: { ...current.player, hp: 4 } })), null);
  assert.equal(parseSaveRecord(record({ ...current, player: { ...current.player, hp: 3, maxHp: 12 } })), null);
});

test('previous 9x9 saves and unknown versions cannot leak into the current rules', () => {
  for (const version of [1, 2, 6]) assert.equal(parseSaveRecord(record({ ...createGame(1), version, slot: 2, resumePhase: 'normal' })), null);
  for (const version of [3, 4, 5]) {
    const s = { ...createGame(1), version };
    s.player.x = 7;
    assert.equal(parseSaveRecord(record(s)), null);
    s.player.x = 3;
    s.walls.push({ x: 1, y: 8 });
    assert.equal(parseSaveRecord(record(s)), null);
  }
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
  for (const version of [3, 4, 5]) {
    const s = { ...createGame(8), version };
    s.player.attunement = 11;
    assert.equal(parseSaveRecord(record(s)), null);
    s.player.attunement = 10; s.charge = 11;
    assert.equal(parseSaveRecord(record(s)), null);
  }
});

test('v5 rejects missing or malformed movement and attack metadata', () => {
  for (const fields of [
    { movement: undefined }, { movement: 'teleport' }, { direction: undefined },
    { direction: -1 }, { direction: 8 }, { direction: 1.5 }, { kind: 'unknown' },
    { kind: 'move', movement: 'none', tiles: [] }, { kind: 'move', tiles: [{ x: 3, y: 3 }] },
    { kind: 'attack', tiles: [] },
  ]) {
    const s = createGame(731);
    const e = s.enemies.find(e => e.intent)!;
    Object.assign(e.intent!, fields);
    assert.equal(parseSaveRecord(record(s)), null, JSON.stringify(fields));
  }
});

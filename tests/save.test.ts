import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, execute, planEnemies } from '../src/engine';
import { PLAYER_MAX_HP, STATE_VERSION, type GameState } from '../src/model';
import { parseSaveRecord } from '../src/save';

const record = (state: unknown) => JSON.stringify({ schema: 1, token: 'test', state });
const legacy = (state: GameState = createGame(731), hp = 12, version: 3 | 4 | 5 = 3) => ({
  ...structuredClone(state), version, player: { ...state.player, hp, maxHp: version === 3 ? 12 : 3 },
  enemies: state.enemies.map(e => {
    const { comboStep, ...oldEnemy } = structuredClone(e);
    const intent = e.intent ? { destination: e.intent.destination, tiles: e.intent.tiles, heavy: e.intent.heavy, label: e.intent.label } : null;
    return { ...oldEnemy, intent: intent && version === 5 ? { ...intent, movement: e.intent!.movement, kind: e.intent!.kind, direction: e.intent!.direction } : intent };
  }),
});

test('current 7x7 runs preserve progress and frozen time on reload', () => {
  const s = createGame(731);
  s.round = 7;
  s.player.attunement = 4;
  const frozen = execute(s, { type: 'beginAttack' });
  const parsed = parseSaveRecord(record(frozen))!;
  assert.deepEqual(parsed.state, frozen);
  assert.equal(parsed.state.version, STATE_VERSION);
  assert.equal(parsed.state.version, 6);
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
    assert.equal(parsed.state.version, 6);
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
    s.enemies.find(e => e.kind === 'heavy')!.opening = false; // Legacy Heavy was not always open on its first plan.
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
      assert.deepEqual(vitalsAfter, { ...vitalsBefore, comboStep: 0 }, 'migration must not move, heal, or advance enemies');
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
  for (const version of [1, 2, 7]) assert.equal(parseSaveRecord(record({ ...createGame(1), version, slot: 2, resumePhase: 'normal' })), null);
  for (const version of [3, 4, 5, 6]) {
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
  for (const version of [3, 4, 5, 6]) {
    const s = { ...createGame(8), version };
    s.player.attunement = 11;
    assert.equal(parseSaveRecord(record(s)), null);
    s.player.attunement = 10; s.charge = 11;
    assert.equal(parseSaveRecord(record(s)), null);
  }
});

test('v6 rejects missing or malformed movement and attack metadata', () => {
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

test('v5 migration refreshes Heavy alone while preserving frozen ground commitments and canceled plans', () => {
  for (const phase of ['normal', 'attack'] as const) {
    const s = createGame(731);
    s.round = 12;
    s.phase = phase;
    s.player.hp = 2;
    s.player.attunement = phase === 'normal' ? 4 : 0;
    s.charge = phase === 'attack' ? 4 : 0;
    const original = legacy(s, 2, 5);
    const heavy = original.enemies.find(e => e.kind === 'heavy')!;
    heavy.intent = { destination: { x: heavy.x, y: heavy.y }, tiles: [{ x: s.player.x, y: s.player.y }], heavy: true, label: 'Legacy Heavy', movement: 'none', kind: 'attack', direction: 0 };
    const canceled = original.enemies.find(e => e.kind === 'sweep')!;
    canceled.intent = null;
    const ground = original.enemies.find(e => e.kind === 'lunge')!;
    const parsed = parseSaveRecord(record(original))!.state;
    assert.equal(parsed.version, 6);
    assert.equal(parsed.phase, phase);
    assert.equal(parsed.round, 12);
    assert.equal(parsed.charge, original.charge);
    assert.deepEqual(parsed.player, original.player);
    assert.deepEqual(parsed.walls, original.walls);
    assert.deepEqual(parsed.enemies.find(e => e.id === ground.id), { ...ground, comboStep: 0 });
    assert.deepEqual(parsed.enemies.find(e => e.id === canceled.id), { ...canceled, comboStep: 0 });
    const currentHeavy = parsed.enemies.find(e => e.id === heavy.id)!;
    assert.equal(currentHeavy.comboStep, 0);
    assert.equal(currentHeavy.intent?.comboStep, 0);
    assert.equal(currentHeavy.x, heavy.x);
    assert.equal(currentHeavy.y, heavy.y);
    assert.equal(currentHeavy.guard, heavy.guard);
    assert.equal(currentHeavy.hp, heavy.hp);
    assert.notEqual(currentHeavy.intent?.label, 'Legacy Heavy');
    assert.deepEqual(parseSaveRecord(record(parsed))!.state, parsed);
  }
});

test('v5 frozen migration preserves ground corridors when replanning an earlier Heavy', () => {
  const s = createGame(1);
  s.room = 3; s.round = 19; s.phase = 'attack'; s.charge = 10;
  s.player = { ...s.player, x: 5, y: 6 };
  s.walls = [{ x: 4, y: 5 }, { x: 5, y: 1 }, { x: 5, y: 3 }, { x: 5, y: 4 }];
  s.enemies = [
    { ...s.enemies.find(e => e.kind === 'heavy')!, id: 31, x: 3, y: 4, opening: false, intent: { destination: { x: 3, y: 6 }, tiles: [], direction: 4, movement: 'jump', kind: 'move', heavy: true, label: 'Jump approach' } },
    { ...s.enemies.find(e => e.kind === 'lunge')!, id: 32, x: 4, y: 4, opening: false, intent: { destination: { x: 6, y: 6 }, tiles: [], direction: 3, movement: 'dash', kind: 'move', heavy: false, label: 'Dash approach' } },
  ];
  const original = legacy(s, 3, 5);
  const migrated = parseSaveRecord(record(original))!.state;
  const heavy = migrated.enemies[0];
  assert.notDeepEqual(heavy.intent?.destination, { x: 5, y: 5 }, 'Heavy cannot reserve the middle of the preserved E5 → G7 dash');
  assert.deepEqual(migrated.enemies[1].intent, original.enemies[1].intent);
  assert.equal(migrated.round, 19);
  assert.equal(migrated.phase, 'attack');
  const resumed = execute(migrated, { type: 'endAttack' });
  const resolved = execute(resumed, { type: 'act', ability: 'light', target: { x: 5, y: 5 } });
  assert.deepEqual({ x: resolved.enemies[1].x, y: resolved.enemies[1].y }, { x: 6, y: 6 }, 'preserved ground commitment still resolves');
});

test('v6 saves preserve each Heavy combo step, impact, recovery, and frozen commitment exactly', () => {
  for (const comboStep of [0, 1, 2, 3] as const) {
    const s = createGame(731);
    s.walls = [];
    s.player = { ...s.player, x: 3, y: 3 };
    s.enemies = s.enemies.filter(e => e.kind === 'heavy');
    Object.assign(s.enemies[0], { x: 1, y: 3, comboStep });
    planEnemies(s);
    assert.equal(s.enemies[0].intent?.comboStep, comboStep);
    if (comboStep === 2) assert(s.enemies[0].intent?.impact);
    if (comboStep === 3) assert.equal(s.enemies[0].intent?.kind, 'wait');
    for (const phase of ['normal', 'attack'] as const) {
      const saved = { ...structuredClone(s), phase, charge: phase === 'attack' ? 4 : 0 };
      assert.deepEqual(parseSaveRecord(record(saved))!.state, saved);
    }
  }
});

test('v6 rejects invalid combo progression, impact, and parry target metadata', () => {
  for (const comboStep of [-1, 4, 0.5, undefined]) {
    const s = createGame(731);
    Object.assign(s.enemies.find(e => e.kind === 'heavy')!, { comboStep });
    assert.equal(parseSaveRecord(record(s)), null);
  }
  for (const fields of [{ comboStep: 1 }, { impact: { x: 7, y: 0 } }, { comboStep: 2 }]) {
    const s = createGame(731);
    Object.assign(s.enemies.find(e => e.kind === 'heavy')!.intent!, fields);
    assert.equal(parseSaveRecord(record(s)), null);
  }
  const s = createGame(731);
  s.enemies.find(e => e.kind !== 'heavy')!.comboStep = 1;
  assert.equal(parseSaveRecord(record(s)), null);
  s.enemies.find(e => e.kind !== 'heavy')!.comboStep = 0;
  s.defenses = [{ kind: 'light', direction: 0, parryEnemyId: Number.NaN }];
  assert.equal(parseSaveRecord(record(s)), null);
});

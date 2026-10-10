import test from 'node:test';
import assert from 'node:assert/strict';
import { arc, clearPath, directionTo, distance, inside, pulse, same } from '../src/geometry';
import { availableAbilities, canBeginAttack, createGame, execute, planEnemies, previewAction, validTargets } from '../src/engine';
import { DIRS, SIZE, THRESHOLD, TOTAL_ROOMS, type Ability, type Command, type Direction, type Enemy, type GameState, type Point } from '../src/model';

const p = (x: number, y: number): Point => ({ x, y });
const enemy = (id: number, x: number, y: number, fields: Partial<Enemy> = {}): Enemy => ({
  id, x, y, kind: 'lunge', hp: 3, maxHp: 3, guard: 4, maxGuard: 4,
  breached: false, stun: 0, removed: false, opening: false, cycle: 0, intent: null, ...fields,
});
const fixture = (fields: Partial<GameState> = {}): GameState => ({
  version: 1, seed: 123, rng: 123, room: 1, round: 1, slot: 0,
  phase: 'normal', resumePhase: 'normal', player: { x: 4, y: 4, hp: 12, maxHp: 12, attunement: 0 },
  charge: 0, walls: [], enemies: [enemy(99, 0, 0)], defenses: [], log: [], pulse: null, ...fields,
});
const act = (s: GameState, ability: Ability, target?: Point) => execute(s, { type: 'act', ability, ...(target ? { target } : {}) });
const ids = (values: number[]) => [...values].sort((a, b) => a - b);
const points = (values: Point[]) => values.map(({ x, y }) => `${x},${y}`).sort();
const get = (s: GameState, id: number) => s.enemies.find(e => e.id === id)!;
const incoming = (id: number, origin: Point, heavy = false, guard = 2): Enemy => enemy(id, origin.x, origin.y, {
  kind: heavy ? 'heavy' : 'lunge', guard, maxGuard: guard,
  intent: { destination: origin, tiles: [p(4, 4)], heavy, label: 'test' },
});

test('grid geometry preserves the eight directions and three-cell arcs', () => {
  DIRS.forEach((d, i) => {
    const target = p(4 + d.x, 4 + d.y);
    assert.equal(directionTo(p(4, 4), target), i);
    assert.equal(distance(p(4, 4), target), 1);
    assert.equal(arc(p(4, 4), i as Direction).length, 3);
    assert(arc(p(4, 4), i as Direction).some(t => same(t, target)));
  });
  assert.deepEqual(points(arc(p(4, 4), 0)), ['3,3', '4,3', '5,3']);
  assert(arc(p(0, 0), 0).every(inside));
  assert(!inside(p(-1, 0)) && !inside(p(SIZE, 0)) && !inside(p(0.5, 1)));
});

test('queen movement validates endpoints, complete paths, and blocked diagonal corners', () => {
  const s = fixture();
  assert(clearPath(s, s.player, p(4, 0)));
  assert(clearPath(s, s.player, p(8, 8)));
  assert(!clearPath(s, s.player, p(7, 2)));
  assert(!clearPath(s, s.player, p(4, 4)));
  assert(!clearPath(s, s.player, p(9, 4)));
  s.walls = [p(4, 2)];
  assert(!clearPath(s, s.player, p(4, 0)));
  s.walls = [p(5, 4)];
  assert(!clearPath(s, s.player, p(5, 5)));
  s.walls = [];
  s.enemies = [enemy(1, 4, 2)];
  assert(!clearPath(s, s.player, p(4, 2)));
  assert(!clearPath(s, s.player, p(4, 0)));
  get(s, 1).removed = true;
  assert(clearPath(s, s.player, p(4, 0)));
  get(s, 1).removed = false;
  get(s, 1).hp = 0;
  assert(clearPath(s, s.player, p(4, 0)));
});

test('Quickstep can enter every open adjacent square even beside blocked diagonal corners', () => {
  const s = fixture({ walls: [p(5, 4), p(4, 5)] });
  assert(validTargets(s, 'quickstep').some(t => same(t, p(5, 5))));
  const moved = act(s, 'quickstep', p(5, 5));
  assert(same(moved.player, p(5, 5)));
  assert.equal(moved.slot, 1);
  assert.equal(moved.player.attunement, 0);
  assert(!clearPath(s, s.player, p(5, 5)));
  const occupied = fixture({ enemies: [enemy(1, 5, 5)] });
  assert.equal(act(occupied, 'quickstep', p(5, 5)), occupied);
});

test('pulse reaches non-queen bearings and damages each shell only once', () => {
  const s = fixture({ enemies: [enemy(1, 7, 2), enemy(2, 1, 6)] });
  const result = pulse(s, true);
  assert.deepEqual(ids(result.hitIds), [1, 2]);
  assert.equal(get(s, 1).guard, 3);
  assert.equal(get(s, 2).guard, 3);
  assert.equal(get(s, 1).hp, 3);
});

test('surviving shell casts a full silhouette shadow', () => {
  const s = fixture({ enemies: [enemy(1, 4, 2), enemy(2, 4, 0)] });
  const result = pulse(s, true);
  assert.deepEqual(result.hitIds, [1]);
  assert.equal(get(s, 2).guard, 4);
  assert(result.shadowTiles.some(t => same(t, p(4, 0))));
});

test('pulse reaches partial exposure even when the target center is shadowed', () => {
  const s = fixture({ enemies: [enemy(1, 4, 2), enemy(2, 5, 0)] });
  assert.deepEqual(ids(pulse(s, true).hitIds), [1, 2]);
  assert.equal(get(s, 2).guard, 3);
});

test('new breaches transmit through a chain during the same pulse', () => {
  const s = fixture({ enemies: [enemy(1, 4, 3, { guard: 1 }), enemy(2, 4, 2, { guard: 1 }), enemy(3, 4, 0)] });
  const result = pulse(s, true);
  assert.deepEqual(ids(result.hitIds), [1, 2, 3]);
  assert.deepEqual(ids(result.breachedIds), [1, 2]);
  assert.equal(get(s, 3).guard, 3);
  assert(get(s, 1).breached && get(s, 2).breached);
  assert.equal(get(s, 1).stun, 1);
});

test('existing breaches transmit pulse without core damage', () => {
  const s = fixture({ enemies: [enemy(1, 4, 2, { guard: 0, breached: true, stun: 1 }), enemy(2, 4, 0)] });
  pulse(s, true);
  assert.equal(get(s, 1).hp, 3);
  assert.equal(get(s, 2).guard, 3);
});

test('visible Opening breaches any Guard and cancels its intent', () => {
  const front = incoming(1, p(4, 2), true, 50);
  front.opening = true;
  const s = fixture({ enemies: [front, enemy(2, 4, 0)] });
  pulse(s, true);
  assert(get(s, 1).breached);
  assert.equal(get(s, 1).guard, 0);
  assert.equal(get(s, 1).intent, null);
  assert.equal(get(s, 1).opening, false);
  assert.equal(get(s, 2).guard, 3);
});

test('shadowed Opening stays protected; walls never transmit', () => {
  const s = fixture({ enemies: [enemy(1, 4, 2), enemy(2, 4, 0, { opening: true })] });
  pulse(s, true);
  assert(!get(s, 2).breached);
  assert.equal(get(s, 2).guard, 4);
  const w = fixture({ walls: [p(4, 2)], enemies: [enemy(2, 4, 0, { opening: true })] });
  assert.deepEqual(pulse(w, true).hitIds, []);
  assert(!get(w, 2).breached);
});

test('zero-width corner contact cannot leak through touching wall silhouettes', () => {
  const s = fixture({ walls: [p(5, 4), p(4, 3)], enemies: [enemy(1, 5, 3)] });
  assert.deepEqual(pulse(s, true).hitIds, []);
});

test('removed and dead units do not cast pulse shadows', () => {
  for (const fields of [{ removed: true }, { hp: 0 }]) {
    const s = fixture({ enemies: [enemy(1, 4, 2, fields), enemy(2, 4, 0)] });
    assert.deepEqual(pulse(s, true).hitIds, [2]);
  }
});

test('pulse preview is pure and predicts the applied result', () => {
  const s = fixture({ enemies: [enemy(1, 4, 2, { opening: true }), enemy(2, 4, 0)] });
  const before = structuredClone(s);
  const preview = pulse(s, false);
  assert.deepEqual(s, before);
  assert.deepEqual(pulse(s, true), preview);
});

test('pulse shadows and breaches are invariant under quarter turns', () => {
  const source = fixture({ walls: [p(2, 3), p(5, 6)], enemies: [enemy(1, 4, 2), enemy(2, 5, 0), enemy(3, 1, 5, { guard: 1 }), enemy(4, 0, 5)] });
  const rotate = (t: Point) => p(SIZE - 1 - t.y, t.x);
  let s = source;
  let expected = pulse(s, false);
  for (let i = 0; i < 4; i++) {
    s = { ...structuredClone(s), player: { ...s.player, ...rotate(s.player) }, walls: s.walls.map(rotate), enemies: s.enemies.map(e => ({ ...e, ...rotate(e) })) };
    const actual = pulse(s, false);
    assert.deepEqual(ids(actual.hitIds), ids(expected.hitIds));
    assert.deepEqual(ids(actual.breachedIds), ids(expected.breachedIds));
    assert.deepEqual(points(actual.visibleTiles), points(expected.visibleTiles.map(rotate)));
    expected = actual;
  }
});

test('the three slots expose only their specified normal abilities', () => {
  const expected = [['quickstep', 'focus'], ['dash', 'strike', 'focus'], ['deflect', 'strike', 'focus']];
  expected.forEach((abilities, index) => {
    assert.deepEqual([...availableAbilities(fixture({ slot: index as 0|1|2 }))].sort(), [...abilities].sort());
  });
});

test('three actions never move or attack enemies until explicit resolution', () => {
  const e = incoming(1, p(4, 2));
  e.intent!.destination = p(4, 3);
  let s = fixture({ enemies: [e] });
  for (let slot = 0; slot < 3; slot++) {
    s = act(s, 'focus');
    assert.equal(s.player.hp, 12);
    assert.equal(s.player.attunement, slot + 1);
    assert.equal(s.round, 1);
    assert.deepEqual(p(get(s, 1).x, get(s, 1).y), p(4, 2));
  }
  assert.equal(s.phase, 'resolve');
  assert.equal(s.slot, 3);
  s = execute(s, { type: 'resolve' });
  assert(s.player.hp < 12);
  assert.equal(s.round, 2);
  assert.equal(s.slot, 0);
  assert.equal(s.phase, 'normal');
  assert.deepEqual(p(get(s, 1).x, get(s, 1).y), p(4, 3));
});

test('Focus does nothing beyond attunement and slot progression', () => {
  const s = fixture({ enemies: [enemy(1, 4, 2, { guard: 1 })] });
  const before = structuredClone(s);
  const after = act(s, 'focus');
  assert.deepEqual(s, before);
  assert.deepEqual(after.enemies, before.enemies);
  assert.deepEqual(after.walls, before.walls);
  assert.equal(after.player.hp, before.player.hp);
  assert.equal(after.player.x, before.player.x);
  assert.equal(after.player.y, before.player.y);
  assert.equal(after.player.attunement, 1);
});

for (const slot of [0, 1, 2, 3] as const) {
  test(`Offensive can interrupt and resume slot ${slot}, including the resolution boundary`, () => {
    const s = fixture({ slot, phase: slot === 3 ? 'resolve' : 'normal', defenses: [{ kind: 'strike', direction: 2 }], enemies: [incoming(1, p(1, 1), false, 5)] });
    s.player.attunement = THRESHOLD + 3;
    assert(canBeginAttack(s));
    const offensive = execute(s, { type: 'beginAttack' });
    assert.equal(offensive.phase, 'attack');
    assert.equal(offensive.charge, THRESHOLD + 3);
    assert.equal(offensive.player.attunement, 0);
    assert.equal(offensive.slot, slot);
    assert.deepEqual(offensive.enemies[0].intent, s.enemies[0].intent);
    assert.equal(offensive.enemies[0].cycle, s.enemies[0].cycle);
    const ended = execute(offensive, { type: 'endAttack' });
    assert.equal(ended.phase, slot === 3 ? 'resolve' : 'normal');
    assert.equal(ended.slot, slot);
    assert.equal(ended.round, s.round);
    assert.equal(ended.charge, 0);
    assert.equal(ended.player.attunement, 0);
    assert.deepEqual(ended.defenses, s.defenses);
    assert.equal(ended.player.hp, s.player.hp);
  });
}

test('Offensive threshold is exact and phase restrictions cannot be bypassed', () => {
  for (const attunement of [0, THRESHOLD - 1, THRESHOLD, 100]) {
    const s = fixture(); s.player.attunement = attunement;
    assert.equal(canBeginAttack(s), attunement >= THRESHOLD);
    if (attunement < THRESHOLD) assert.equal(execute(s, { type: 'beginAttack' }), s);
  }
  for (const phase of ['attack', 'cleared', 'won', 'lost'] as const) {
    const s = fixture({ phase }); s.player.attunement = 100;
    assert(!canBeginAttack(s));
  }
});

test('offensive time freezes Guard, stun, enemy positions, and intents', () => {
  let s = fixture({ phase: 'attack', charge: 6, enemies: [enemy(1, 4, 1, { guard: 0, breached: true, stun: 1 }), incoming(2, p(0, 0))] });
  const frozen = structuredClone(s.enemies);
  s = act(s, 'shift', p(5, 4));
  s = act(s, 'shift', p(5, 5));
  assert.deepEqual(s.enemies, frozen);
  assert.equal(s.round, 1);
  assert.equal(s.slot, 0);
  assert.equal(s.charge, 4);
});

test('Strike damages only the three-cell arc and stores only the center counter', () => {
  const s = fixture({ slot: 1, enemies: [enemy(1, 4, 3), enemy(2, 3, 3), enemy(3, 5, 3), enemy(4, 5, 4)] });
  const result = act(s, 'strike', p(4, 3));
  for (const id of [1, 2, 3]) assert.equal(get(result, id).guard, 2);
  assert.equal(get(result, 4).guard, 4);
  assert.deepEqual(result.defenses, [{ kind: 'strike', direction: 0 }]);
  assert(result.enemies.every(e => e.hp === 3));
});

test('Deflect adds arc coverage without proactive Guard or life damage', () => {
  const s = fixture({ slot: 2, enemies: [enemy(1, 4, 3)] });
  const result = act(s, 'deflect', p(4, 3));
  assert.equal(get(result, 1).guard, 4);
  assert.equal(get(result, 1).hp, 3);
  assert.deepEqual(result.defenses, [{ kind: 'deflect', direction: 0 }]);
});

for (const heavy of [false, true]) {
  test(`Deflect counters every covered ${heavy ? 'Heavy' : 'normal'} attack`, () => {
    const s = fixture({ phase: 'resolve', slot: 3, defenses: [{ kind: 'deflect', direction: 0 }], enemies: [incoming(1, p(4, 3), heavy), incoming(2, p(3, 3), heavy), incoming(3, p(5, 3), heavy)] });
    const result = execute(s, { type: 'resolve' });
    assert.equal(result.player.hp, 12);
    for (const e of result.enemies) {
      assert(e.breached);
      assert.equal(e.intent, null);
    }
    assert.deepEqual(result.defenses, []);
  });
}

test('Deflect does not protect the opposite direction', () => {
  const s = fixture({ phase: 'resolve', slot: 3, defenses: [{ kind: 'deflect', direction: 0 }], enemies: [incoming(1, p(4, 5), true)] });
  assert(execute(s, { type: 'resolve' }).player.hp < 12);
});

test('Strike counter stops only its center direction and never Heavy', () => {
  const covered = fixture({ phase: 'resolve', slot: 3, defenses: [{ kind: 'strike', direction: 0 }], enemies: [incoming(1, p(4, 3))] });
  assert.equal(execute(covered, { type: 'resolve' }).player.hp, 12);
  for (const [origin, heavy] of [[p(3, 3), false], [p(4, 3), true]] as const) {
    const s = fixture({ phase: 'resolve', slot: 3, defenses: [{ kind: 'strike', direction: 0 }], enemies: [incoming(1, origin, heavy)] });
    assert(execute(s, { type: 'resolve' }).player.hp < 12);
  }
});

test('counter direction uses the gap closer destination', () => {
  const e = incoming(1, p(4, 1));
  e.intent!.destination = p(7, 4);
  const s = fixture({ phase: 'resolve', slot: 3, defenses: [{ kind: 'strike', direction: 2 }], enemies: [e] });
  const result = execute(s, { type: 'resolve' });
  assert(same(get(result, 1), p(7, 4)));
  assert.equal(result.player.hp, 12);
  assert(get(result, 1).breached);
});

test('blocked gap closers cancel without moving, attacking, or retargeting', () => {
  for (const blockedBy of ['wall', 'enemy', 'player-path', 'player-destination']) {
    const e = incoming(1, p(4, 1));
    e.intent!.destination = blockedBy === 'player-path' ? p(4, 5) : blockedBy === 'player-destination' ? p(4, 4) : p(4, 3);
    const s = fixture({ phase: 'resolve', slot: 3, enemies: [e] });
    if (blockedBy === 'wall') s.walls = [p(4, 2)];
    if (blockedBy === 'enemy') s.enemies.push(enemy(2, 4, 2));
    const result = execute(s, { type: 'resolve' });
    assert(same(get(result, 1), p(4, 1)), blockedBy);
    assert.equal(result.player.hp, 12, blockedBy);
  }
});

test('enemy attack footprints stay fixed when the player dodges', () => {
  const s = fixture({ slot: 2, enemies: [incoming(1, p(4, 3))] });
  s.player.x = 5;
  const before = structuredClone(s.enemies[0].intent);
  const ready = act(s, 'focus');
  assert.deepEqual(ready.enemies[0].intent, before);
  assert.equal(execute(ready, { type: 'resolve' }).player.hp, 12);
});

test('two Strikes retain both center counter directions through enemy resolution', () => {
  let s = fixture({ slot: 1, enemies: [incoming(1, p(3, 4), false, 4), incoming(2, p(5, 4), false, 4)] });
  s = act(s, 'strike', p(3, 4));
  s = act(s, 'strike', p(5, 4));
  assert.deepEqual(s.defenses, [{ kind: 'strike', direction: 6 }, { kind: 'strike', direction: 2 }]);
  const result = execute(s, { type: 'resolve' });
  assert.equal(result.player.hp, 12);
  assert(result.enemies.every(e => e.breached));
});

test('unbreached armor regenerates rapidly, while breach skips one resolution and restores armor', () => {
  const s = fixture({ phase: 'resolve', slot: 3, enemies: [enemy(1, 0, 0, { guard: 1, maxGuard: 5 }), incoming(2, p(4, 3), true)] });
  get(s, 2).breached = true; get(s, 2).guard = 0; get(s, 2).stun = 1; get(s, 2).intent = null;
  const result = execute(s, { type: 'resolve' });
  assert.equal(result.player.hp, 12);
  assert.equal(get(result, 1).guard, 3);
  assert.equal(get(result, 2).guard, get(result, 2).maxGuard);
  assert(!get(result, 2).breached);
  assert.equal(get(result, 2).stun, 0);
});

test('a Strike breach cancels an incoming Heavy without taking life', () => {
  const s = fixture({ slot: 2, enemies: [incoming(1, p(4, 3), true, 2)] });
  const struck = act(s, 'strike', p(4, 3));
  assert(get(struck, 1).breached);
  assert.equal(get(struck, 1).intent, null);
  assert.equal(get(struck, 1).hp, 3);
  assert.equal(execute(struck, { type: 'resolve' }).player.hp, 12);
});

for (const ability of ['core', 'core2'] as const) {
  test(`${ability} removes a surviving target until Offensive ends and restores its shell`, () => {
    const s = fixture({ phase: 'attack', charge: 7, enemies: [enemy(1, 4, 3, { guard: 0, breached: true, stun: 1 }), enemy(2, 0, 0)] });
    const hit = act(s, ability, p(4, 3));
    const target = get(hit, 1);
    assert.equal(target.hp, ability === 'core' ? 2 : 1);
    assert.equal(target.guard, target.maxGuard);
    assert(target.removed);
    assert(!validTargets(hit, ability).some(t => same(t, p(4, 3))));
    assert.equal(act(hit, ability, p(4, 3)), hit);
    assert(clearPath(hit, hit.player, p(4, 2)));
    assert.equal(hit.charge, ability === 'core' ? 6 : 4);
    const ended = execute(hit, { type: 'endAttack' });
    assert(!get(ended, 1).removed);
    assert(!get(ended, 1).breached);
    assert.equal(get(ended, 1).intent, null);
    assert.equal(ended.charge, 0);
  });
}

test('core-hit survivors respawn safely if the player occupies their original tile', () => {
  let s = fixture({ phase: 'attack', charge: 6, enemies: [enemy(1, 4, 3, { guard: 0, breached: true, stun: 1 }), enemy(2, 0, 0)] });
  s = act(s, 'core', p(4, 3));
  s = act(s, 'shift', p(4, 3));
  assert(same(s.player, p(4, 3)));
  const ended = execute(s, { type: 'endAttack' });
  assert(!same(get(ended, 1), ended.player));
  assert(!ended.walls.some(w => same(w, get(ended, 1))));
  assert(!same(get(ended, 1), get(ended, 2)));
  assert.equal(distance(get(ended, 1), p(4, 3)), 1);
  assert.equal(get(ended, 1).intent, null);
});

test('dead core targets never return; the final kill clears the arena', () => {
  const s = fixture({ phase: 'attack', charge: 4, enemies: [enemy(1, 4, 3, { hp: 1, guard: 0, breached: true, stun: 1 })] });
  const killed = act(s, 'core', p(4, 3));
  assert.equal(killed.phase, 'cleared');
  assert.equal(killed.charge, 0);
  assert(killed.enemies.every(e => e.hp <= 0));
  const advanced = execute(killed, { type: 'nextRoom' });
  assert.equal(advanced.room, s.room + 1);
  assert.equal(advanced.phase, 'normal');
});

test('all invalid commands preserve object identity and every field', () => {
  const cases: [GameState, Command][] = [
    [fixture(), { type: 'resolve' }], [fixture(), { type: 'endAttack' }], [fixture(), { type: 'nextRoom' }],
    [fixture(), { type: 'act', ability: 'strike', target: p(4, 3) }],
    [fixture(), { type: 'act', ability: 'quickstep', target: p(4, 1) }],
    [fixture(), { type: 'act', ability: 'quickstep', target: p(4, 4) }],
    [fixture({ slot: 1 }), { type: 'act', ability: 'dash', target: p(7, 2) }],
    [fixture({ slot: 2 }), { type: 'act', ability: 'deflect', target: p(-1, 0) }],
    [fixture({ phase: 'resolve', slot: 3 }), { type: 'act', ability: 'focus' }],
    [fixture({ phase: 'attack', charge: 0 }), { type: 'act', ability: 'shift', target: p(5, 4) }],
    [fixture({ phase: 'attack', charge: 5 }), { type: 'act', ability: 'focus' }],
    [fixture({ phase: 'attack', charge: 5 }), { type: 'act', ability: 'core', target: p(0, 0) }],
    [fixture({ phase: 'lost' }), { type: 'act', ability: 'focus' }],
    [fixture({ phase: 'won' }), { type: 'beginAttack' }],
  ];
  for (const [s, command] of cases) {
    const before = structuredClone(s);
    assert.equal(execute(s, command), s, JSON.stringify(command));
    assert.deepEqual(s, before);
  }
});

test('action previews and target inspection never advance simulation', () => {
  const s = fixture({ slot: 1, enemies: [enemy(1, 4, 3)] });
  const before = structuredClone(s);
  validTargets(s, 'dash'); validTargets(s, 'strike'); availableAbilities(s);
  const preview = previewAction(s, 'strike', p(4, 3));
  assert(preview.some(t => same(t, p(4, 3))));
  assert.deepEqual(s, before);
});

function checkLayout(s: GameState) {
  assert(inside(s.player));
  const walls = new Set(points(s.walls));
  assert.equal(walls.size, s.walls.length);
  assert(!walls.has(`${s.player.x},${s.player.y}`));
  const occupied = new Set([`${s.player.x},${s.player.y}`]);
  for (const e of s.enemies.filter(e => e.hp > 0 && !e.removed)) {
    assert(inside(e));
    const key = `${e.x},${e.y}`;
    assert(!occupied.has(key), `overlap in seed ${s.seed}`);
    assert(!walls.has(key)); occupied.add(key);
  }
  const reached = new Set([`${s.player.x},${s.player.y}`]);
  const queue: Point[] = [s.player];
  for (let i = 0; i < queue.length; i++) {
    for (const d of [p(0, 1), p(1, 0), p(0, -1), p(-1, 0)]) {
      const t = p(queue[i].x + d.x, queue[i].y + d.y); const key = `${t.x},${t.y}`;
      if (inside(t) && !walls.has(key) && !reached.has(key)) { reached.add(key); queue.push(t); }
    }
  }
  assert.equal(reached.size, SIZE * SIZE - walls.size, `disconnected seed ${s.seed}`);
}

test('seeded generation is deterministic, connected, and collision-free across all arenas', () => {
  for (let seed = 1; seed <= 48; seed++) {
    let s = createGame(seed);
    assert.deepEqual(s, createGame(seed));
    for (let i = 0; i < TOTAL_ROOMS; i++) {
      checkLayout(s);
      if (i < TOTAL_ROOMS - 1) {
        s = execute({ ...s, phase: 'cleared', enemies: [] }, { type: 'nextRoom' });
      }
    }
  }
});

test('enemy planning is deterministic and reserves legal, distinct destinations', () => {
  for (let seed = 1; seed <= 32; seed++) {
    const a = createGame(seed), b = structuredClone(a);
    planEnemies(a); planEnemies(b);
    assert.deepEqual(a, b);
    const destinations = new Set<string>();
    for (const e of a.enemies) {
      if (!e.intent) continue;
      assert(inside(e.intent.destination));
      assert(!same(e.intent.destination, a.player));
      assert(!a.walls.some(w => same(w, e.intent!.destination)));
      const key = `${e.intent.destination.x},${e.intent.destination.y}`;
      assert(!destinations.has(key)); destinations.add(key);
      assert(e.intent.tiles.every(inside));
    }
  }
});

test('the fifth arena final kill wins and restart creates a clean seeded run', () => {
  const s = fixture({ room: TOTAL_ROOMS, phase: 'attack', charge: 4, enemies: [enemy(1, 4, 3, { hp: 1, guard: 0, breached: true })] });
  assert.equal(act(s, 'core', p(4, 3)).phase, 'won');
  const reset = createGame(987);
  assert.equal(reset.phase, 'normal');
  assert.equal(reset.room, 1);
  assert.equal(reset.player.attunement, 0);
  assert.equal(reset.player.hp, reset.player.maxHp);
});

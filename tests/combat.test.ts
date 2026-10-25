import test from 'node:test';
import assert from 'node:assert/strict';
import { arc, clearPath, directionTo, distance, inside, pulse, same } from '../src/geometry';
import { availableAbilities, canBeginAttack, createGame, execute, planEnemies, previewAction, validTargets } from '../src/engine';
import { COSTS, DIRS, ENEMY_DAMAGE, GUARD, MAX_ATTUNEMENT, PLAYER_MAX_HP, SIZE, STATE_VERSION, THRESHOLD, TOTAL_ROOMS, type Ability, type Command, type Direction, type Enemy, type GameState, type Point } from '../src/model';

const p = (x: number, y: number): Point => ({ x, y });
const enemy = (id: number, x: number, y: number, fields: Partial<Enemy> = {}): Enemy => ({
  id, x, y, kind: 'sweep', hp: 3, maxHp: 3, guard: 20, maxGuard: 20,
  breached: false, stun: 0, removed: false, opening: false, cycle: 0, intent: null, ...fields,
});
const fixture = (fields: Partial<GameState> = {}): GameState => ({
  version: STATE_VERSION, seed: 123, rng: 123, room: 1, round: 1,
  phase: 'normal', player: { x: 3, y: 3, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, attunement: 0 },
  charge: 0, walls: [], enemies: [enemy(99, 0, 0)], defenses: [], log: [], pulse: null, ...fields,
});
const act = (s: GameState, ability: Ability, target?: Point) => execute(s, { type: 'act', ability, ...(target ? { target } : {}) });
const ids = (values: number[]) => [...values].sort((a, b) => a - b);
const points = (values: Point[]) => values.map(({ x, y }) => `${x},${y}`).sort();
const get = (s: GameState, id: number) => s.enemies.find(e => e.id === id)!;
const incoming = (id: number, origin: Point, heavy = false): Enemy => enemy(id, origin.x, origin.y, {
  kind: heavy ? 'heavy' : 'sweep', guard: 20, maxGuard: 50,
  intent: { destination: origin, tiles: [p(3, 3)], heavy, label: 'test', movement: 'none', kind: 'attack', direction: directionTo(origin, p(3, 3)) },
});
const bank = (s: GameState, value: number) => { s.player.attunement = value; return s; };

test('seven-square grid exposes eight directions and clipped three- or five-neighbor arcs', () => {
  assert.equal(SIZE, 7);
  DIRS.forEach((d, i) => {
    const target = p(3 + d.x, 3 + d.y);
    assert.equal(directionTo(p(3, 3), target), i);
    assert.equal(distance(p(3, 3), target), 1);
    assert.equal(arc(p(3, 3), i as Direction).length, 3);
    assert.equal(arc(p(3, 3), i as Direction, 5).length, 5);
  });
  assert.deepEqual(points(arc(p(3, 3), 0, 5)), ['2,2', '2,3', '3,2', '4,2', '4,3']);
  assert(arc(p(0, 0), 0, 5).every(inside));
  assert(!inside(p(-1, 0)) && !inside(p(7, 0)) && !inside(p(0.5, 1)));
});

test('queen movement checks endpoints and traversed tiles while allowing off-path diagonal flanks', () => {
  const s = fixture();
  assert(clearPath(s, s.player, p(3, 0)));
  assert(clearPath(s, s.player, p(6, 6)));
  assert(!clearPath(s, s.player, p(6, 1)));
  assert(!clearPath(s, s.player, s.player));
  assert(!clearPath(s, s.player, p(7, 3)));
  for (const wall of [p(3, 1), p(3, 2)]) {
    s.walls = [wall]; assert(!clearPath(s, s.player, p(3, 0)));
  }
  for (const wall of [p(4, 3), p(3, 4)]) {
    s.walls = [wall]; assert(clearPath(s, s.player, p(4, 4)));
  }
  s.walls = []; s.enemies = [enemy(1, 3, 1)];
  assert(!clearPath(s, s.player, p(3, 1)));
  assert(!clearPath(s, s.player, p(3, 0)));
  get(s, 1).removed = true; assert(clearPath(s, s.player, p(3, 0)));
  get(s, 1).removed = false; get(s, 1).hp = 0; assert(clearPath(s, s.player, p(3, 0)));
});

test('the reported E7 to A3 diagonal Dash passes beside the enemy on D7', () => {
  const s = fixture({
    walls: [p(3, 1), p(5, 1), p(5, 2)],
    enemies: [
      enemy(1, 3, 6, { kind: 'lunge', hp: 1, maxHp: 1, guard: 5, maxGuard: 5 }),
      enemy(2, 4, 4, { kind: 'sweep', hp: 2, maxHp: 2, guard: 15, maxGuard: 15 }),
      enemy(3, 4, 2, { kind: 'heavy' }),
    ],
  });
  s.player.x = 4; s.player.y = 6;
  planEnemies(s);
  const destination = p(0, 2);
  assert(clearPath(s, s.player, destination));
  assert(validTargets(s, 'dash').some(point => same(point, destination)));
  const moved = act(s, 'dash', destination);
  assert.notEqual(moved, s);
  assert(same(moved.player, destination));
  assert.equal(moved.player.hp, 3);
  assert.equal(moved.round, s.round + 1);

  const frozen = { ...structuredClone(s), phase: 'attack' as const, charge: 2 };
  assert(validTargets(frozen, 'dashAttack').some(point => same(point, destination)));
  const attacked = act(frozen, 'dashAttack', destination);
  assert(same(attacked.player, destination));
  assert.equal(attacked.charge, 1);
  assert.equal(attacked.player.hp, 3);
  assert.equal(attacked.round, frozen.round);
  assert.deepEqual(attacked.enemies, frozen.enemies);
});

test('rotated and reflected diagonals ignore flank walls and units but reject every on-path blocker', () => {
  for (const reflected of [false, true]) for (let turns = 0; turns < 4; turns++) {
    const transform = (point: Point): Point => {
      let result = reflected ? p(SIZE - 1 - point.x, point.y) : { ...point };
      for (let turn = 0; turn < turns; turn++) result = p(SIZE - 1 - result.y, result.x);
      return result;
    };
    const origin = transform(p(3, 3));
    const destination = transform(p(6, 6));
    const s = fixture({
      walls: [p(4, 3), p(5, 4), p(6, 5)].map(transform),
      enemies: [p(3, 4), p(4, 5), p(5, 6)].map(transform).map((point, i) => enemy(i + 1, point.x, point.y)),
    });
    s.player.x = origin.x; s.player.y = origin.y;
    for (const ability of ['dash', 'dashAttack'] as const) {
      const state = ability === 'dash' ? s : { ...structuredClone(s), phase: 'attack' as const, charge: 2 };
      assert(clearPath(state, origin, destination));
      assert(validTargets(state, ability).some(point => same(point, destination)));
      assert(same(act(state, ability, destination).player, destination));
      for (const step of [1, 2, 3]) for (const blocker of ['wall', 'enemy']) {
        const blocked = structuredClone(state);
        const point = transform(p(3 + step, 3 + step));
        if (blocker === 'wall') blocked.walls.push(point);
        else blocked.enemies.push(enemy(99, point.x, point.y));
        assert(!clearPath(blocked, origin, destination));
        assert(!validTargets(blocked, ability).some(target => same(target, destination)));
        assert.equal(act(blocked, ability, destination), blocked);
      }
    }
  }
});

test('enemy ground dashes use the same queen-line rule for flank walls and units', () => {
  for (const flank of ['wall', 'enemy']) {
    const s = fixture({ enemies: [enemy(1, 1, 1, { kind: 'lunge' })] });
    s.player.x = 4; s.player.y = 4;
    if (flank === 'wall') s.walls.push(p(2, 1));
    else s.enemies.push(enemy(2, 2, 1));
    planEnemies(s, new Set([1]));
    assert.equal(get(s, 1).intent!.movement, 'dash');
    assert(same(get(s, 1).intent!.destination, p(3, 3)));
    const resolved = act(s, 'light', p(4, 5));
    assert(same(get(resolved, 1), p(3, 3)), flank);
    assert.equal(resolved.player.hp, 2);
  }
});

test('reserved landings block a later ground dash only when they lie on its actual path', () => {
  for (const landing of [p(2, 1), p(2, 2)]) {
    const jumper = enemy(2, 0, landing.y, { kind: 'heavy' });
    jumper.intent = { destination: landing, tiles: [], heavy: true, label: 'Jump approach', movement: 'jump', kind: 'move', direction: 2 };
    const s = fixture({ enemies: [jumper, enemy(1, 1, 1, { kind: 'lunge' })] });
    s.player.x = 4; s.player.y = 4;
    planEnemies(s, new Set([1]));
    const planned = structuredClone(get(s, 1).intent);
    if (landing.y === 1) {
      assert(planned && same(planned.destination, p(3, 3)), 'off-path landing must not block the diagonal');
    } else {
      assert(!planned || !same(planned.destination, p(3, 3)), 'reserved crossed tile must block the diagonal');
      if (planned?.movement === 'dash') {
        const step = DIRS[planned.direction];
        for (let i = 1; i <= distance(get(s, 1), planned.destination); i++) assert(!same(p(1 + step.x * i, 1 + step.y * i), landing));
      }
    }
    const resolved = act(s, 'light', p(4, 5));
    assert(same(get(resolved, 2), landing));
    assert(same(get(resolved, 1), planned?.destination ?? p(1, 1)));
  }
});

test('normal and frozen abilities are distinct and unaffordable abilities have no targets', () => {
  const s = fixture();
  assert.deepEqual(availableAbilities(s), ['dash', 'light', 'deflect']);
  assert.deepEqual(validTargets(s, 'deflect'), []);
  assert.equal(act(s, 'deflect', p(3, 2)), s);
  const frozen = fixture({ phase: 'attack', charge: 0 });
  assert.deepEqual(availableAbilities(frozen), ['dashAttack']);
  assert.deepEqual(validTargets(frozen, 'dashAttack'), []);
  assert.equal(act(frozen, 'dashAttack', p(4, 3)), frozen);
  for (const phase of ['cleared', 'won', 'lost'] as const) assert.deepEqual(availableAbilities(fixture({ phase })), []);
});

test('normal Dash costs and generates no charge and immediately resolves enemy intentions', () => {
  const e = incoming(1, p(3, 0));
  e.kind = 'lunge';
  e.intent!.destination = p(3, 1);
  e.intent!.movement = 'dash';
  e.intent!.direction = 4;
  e.intent!.tiles = [p(3, 2), p(3, 3)];
  const s = bank(fixture({ enemies: [e] }), 4);
  const before = structuredClone(s);
  const moved = act(s, 'dash', p(3, 2));
  assert(same(moved.player, p(3, 2)));
  assert(same(get(moved, 1), p(3, 1)));
  assert.equal(moved.round, 2);
  assert.equal(moved.phase, 'normal');
  assert.equal(moved.player.hp, 2);
  assert.equal(moved.player.attunement, 4);
  assert.equal(get(moved, 1).cycle, 1);
  assert.deepEqual(s, before);
});

test('Light deals two Guard to center and one to sides before automatic regeneration', () => {
  const s = fixture({ enemies: [enemy(1, 3, 2, { maxGuard: 50 }), enemy(2, 2, 2, { maxGuard: 50 }), enemy(3, 4, 2, { maxGuard: 50 }), enemy(4, 4, 3, { maxGuard: 50 })] });
  const hit = act(s, 'light', p(3, 2));
  assert.equal(get(hit, 1).guard, 20 - 2 + 10);
  assert.equal(get(hit, 2).guard, 20 - 1 + 10);
  assert.equal(get(hit, 3).guard, 20 - 1 + 10);
  assert.equal(get(hit, 4).guard, 20 + 10);
  assert.equal(hit.player.attunement, 2);
  assert.equal(hit.round, 2);
  assert(hit.enemies.every(e => e.hp === 3));
});

test('Light gains two charge once for any number of active targets and caps at ten', () => {
  for (const count of [1, 2, 3]) {
    const locations = [p(3, 2), p(2, 2), p(4, 2)];
    const s = fixture({ enemies: locations.slice(0, count).map((point, i) => enemy(i + 1, point.x, point.y)) });
    assert.equal(act(s, 'light', p(3, 2)).player.attunement, 2);
    assert.equal(act(bank(s, 9), 'light', p(3, 2)).player.attunement, 10);
    assert.equal(act(bank(s, 10), 'light', p(3, 2)).player.attunement, 10);
  }
});

test('Light miss or removed and dead targets grant no charge', () => {
  for (const fields of [{ removed: true }, { hp: 0 }]) {
    const s = bank(fixture({ enemies: [enemy(1, 3, 2, fields), enemy(99, 0, 0)] }), 2);
    assert.equal(act(s, 'light', p(3, 2)).player.attunement, 2);
  }
  assert.equal(act(fixture(), 'light', p(3, 2)).player.attunement, 0);
});

test('Light can charge from a breached enemy without harming its core', () => {
  const s = fixture({ enemies: [enemy(1, 3, 2, { guard: 0, breached: true, stun: 1 })] });
  const hit = act(s, 'light', p(3, 2));
  assert.equal(hit.player.attunement, 2);
  assert.equal(get(hit, 1).hp, 3);
  assert.equal(get(hit, 1).guard, 20);
  assert.equal(get(hit, 1).stun, 0);
});

test('Light center parries a normal attack without extra counter damage', () => {
  const s = fixture({ enemies: [incoming(1, p(3, 2))] });
  const hit = act(s, 'light', p(3, 2));
  assert.equal(hit.player.hp, PLAYER_MAX_HP);
  assert.equal(get(hit, 1).guard, 20 - 2 + 10);
  assert.deepEqual(hit.defenses, []);
});

test('Light side direction does not parry and center never parries Heavy', () => {
  for (const [origin, heavy, damage] of [[p(2, 2), false, 1], [p(3, 2), true, 1]] as const) {
    const s = fixture({ enemies: [incoming(1, origin, heavy)] });
    const hit = act(s, 'light', p(3, 2));
    assert.equal(hit.player.hp, PLAYER_MAX_HP - damage);
  }
});

test('every unblocked enemy hit costs exactly one of the player three HP', () => {
  assert.equal(PLAYER_MAX_HP, 3);
  assert.equal(ENEMY_DAMAGE, 1);
  for (const kind of ['lunge', 'sweep', 'heavy'] as const) {
    const e = incoming(1, p(3, 2), kind === 'heavy');
    e.kind = kind;
    const hit = act(fixture({ enemies: [e] }), 'light', p(3, 4));
    assert.equal(hit.player.hp, 2, kind);
    assert.equal(hit.player.maxHp, 3);
    assert.equal(hit.phase, 'normal');
  }
});

test('three unblocked incoming attacks are fatal and further hits never make HP negative', () => {
  for (const count of [3, 4]) {
    const attackers = [p(3, 2), p(2, 2), p(4, 2), p(4, 3)].slice(0, count).map((point, i) => incoming(i, point, i === 0));
    const s = fixture({ enemies: attackers });
    const lost = act(s, 'light', p(3, 4));
    assert.equal(lost.player.hp, 0);
    assert.equal(lost.phase, 'lost');
    assert.deepEqual(availableAbilities(lost), []);
    assert.equal(act(lost, 'light', p(3, 2)), lost);
    assert.equal(s.player.hp, 3);
  }
});

test('Light parry direction uses an attacker location after its gap closer', () => {
  const e = incoming(1, p(0, 2));
  e.intent!.destination = p(2, 2);
  e.intent!.movement = 'dash';
  e.intent!.direction = 2;
  e.intent!.tiles = [p(3, 1), p(3, 2), p(3, 3)];
  const hit = act(fixture({ enemies: [e] }), 'light', p(2, 2));
  assert(same(get(hit, 1), p(2, 2)));
  assert.equal(hit.player.hp, PLAYER_MAX_HP);
  assert.equal(hit.player.attunement, 0);
  assert.equal(get(hit, 1).guard, 30);
});

test('a Light breach interrupts Heavy and skips this immediate enemy resolution', () => {
  const e = incoming(1, p(3, 2), true); e.guard = 2;
  const hit = act(fixture({ enemies: [e] }), 'light', p(3, 2));
  assert.equal(hit.player.hp, PLAYER_MAX_HP);
  assert.equal(get(hit, 1).hp, 3);
  assert.equal(get(hit, 1).guard, 50);
  assert.equal(get(hit, 1).stun, 0);
  assert(hit.log.some(message => message.includes('breached')));
});

for (const heavy of [false, true]) {
  test(`Deflect blocks all five covered ${heavy ? 'Heavy' : 'normal'} directions without damage or charge gain`, () => {
    const s = bank(fixture({ enemies: arc(p(3, 3), 0, 5).map((point, i) => incoming(i + 1, point, heavy)) }), 4);
    const result = act(s, 'deflect', p(3, 2));
    assert.equal(result.player.hp, PLAYER_MAX_HP);
    assert.equal(result.player.attunement, 3);
    assert.equal(result.round, 2);
    assert(result.enemies.every(e => e.guard === 30 && e.hp === 3 && !e.breached));
    assert.deepEqual(result.defenses, []);
  });
}

test('Deflect spends its final charge and does not cover the rear three directions', () => {
  const s = bank(fixture({ enemies: [incoming(1, p(3, 4), true)] }), 1);
  const result = act(s, 'deflect', p(3, 2));
  assert.equal(result.player.attunement, 0);
  assert.equal(result.player.hp, 2);
  assert.equal(act(result, 'deflect', p(3, 2)), result);
});

test('blocked gap closers cancel without moving, hitting, or retargeting', () => {
  for (const blockedBy of ['wall', 'enemy', 'player-path', 'player-destination']) {
    const e = incoming(1, p(3, 0));
    e.intent!.destination = blockedBy === 'player-path' ? p(3, 4) : blockedBy === 'player-destination' ? p(3, 3) : p(3, 2);
    e.intent!.movement = 'dash';
    e.intent!.direction = 4;
    const s = fixture({ enemies: [e] });
    if (blockedBy === 'wall') s.walls = [p(3, 1)];
    if (blockedBy === 'enemy') s.enemies.push(enemy(2, 3, 1));
    const result = act(s, 'light', p(4, 3));
    assert(same(get(result, 1), p(3, 0)), blockedBy);
    assert.equal(result.player.hp, PLAYER_MAX_HP, blockedBy);
  }
});

test('enemy attack footprints stay fixed when the player dashes away', () => {
  const s = fixture({ enemies: [incoming(1, p(3, 2))] });
  const hit = act(s, 'dash', p(5, 3));
  assert.equal(hit.player.hp, PLAYER_MAX_HP);
  assert.equal(hit.round, 2);
});

test('out-of-range enemies only approach and never advertise an empty attack', () => {
  const s = fixture({ enemies: [enemy(1, 0, 0)] });
  s.player.x = 6; s.player.y = 5;
  planEnemies(s);
  const intent = structuredClone(get(s, 1).intent!);
  assert.equal(intent.kind, 'move');
  assert.equal(intent.movement, 'dash');
  assert.equal(intent.label, 'Dash approach');
  assert.deepEqual(intent.tiles, []);
  assert(distance(intent.destination, s.player) < distance(get(s, 1), s.player));
  const moved = act(s, 'light', p(6, 4));
  assert(same(get(moved, 1), intent.destination));
  assert.equal(moved.player.hp, 3);
});

test('an immobile enemy outside attack range waits instead of inventing an attack', () => {
  const s = fixture({ walls: [p(1, 0), p(0, 1), p(1, 1)], enemies: [enemy(1, 0, 0)] });
  planEnemies(s);
  assert.equal(get(s, 1).intent, null);
});

test('ground approach takes a lateral wall detour that reduces the route to a firing position', () => {
  let s = fixture({ walls: [1, 2, 3, 4, 5].map(y => p(2, y)), enemies: [enemy(1, 1, 3, { kind: 'lunge' })] });
  s.player.x = 5; s.player.y = 3;
  planEnemies(s);
  const first = get(s, 1).intent!;
  assert.equal(first.kind, 'move');
  assert.equal(first.movement, 'dash');
  assert.equal(distance(first.destination, s.player), distance(get(s, 1), s.player), 'first detour is lateral, not geometrically closer');
  assert.deepEqual(first.tiles, []);
  let moves = 0;
  while (get(s, 1).intent?.kind === 'move' && moves < 8) {
    const planned = get(s, 1).intent!.destination;
    s = act(s, 'light', p(5, 2));
    assert(same(get(s, 1), planned));
    moves++;
  }
  assert(moves > 0 && moves < 8);
  assert.equal(get(s, 1).intent?.kind, 'attack');
  assert(get(s, 1).intent!.tiles.some(point => same(point, s.player)));
});

test('a stationary enemy in range attacks toward the player', () => {
  const s = fixture({ enemies: [enemy(1, 3, 2, { kind: 'lunge' })] });
  planEnemies(s);
  const intent = get(s, 1).intent!;
  assert.equal(intent.kind, 'attack'); assert.equal(intent.movement, 'none');
  assert(same(intent.destination, get(s, 1)));
  assert.equal(intent.direction, 4);
  assert(intent.tiles.some(point => same(point, s.player)));
  assert.equal(intent.label, 'Lunge · 1 damage');
});

test('Heavy jumps cross walls and units while ground dashes cannot', () => {
  for (const obstacle of ['walls', 'unit']) {
    const s = fixture({ enemies: [enemy(1, 0, 0, { kind: 'heavy' })] });
    if (obstacle === 'walls') s.walls = [p(1, 0), p(0, 1), p(1, 1)];
    else s.enemies.push(enemy(2, 1, 1, { breached: true, guard: 0, stun: 1 }));
    planEnemies(s);
    const intent = get(s, 1).intent!;
    assert.equal(intent.movement, 'jump'); assert.equal(intent.kind, 'attack');
    assert.equal(intent.direction, 3); assert(same(intent.destination, p(2, 2)));
    assert.equal(intent.label, 'Jump heavy · 1 damage');
    assert(!clearPath(s, get(s, 1), intent.destination, 1));
    const moved = act(s, 'light', p(3, 4));
    assert(same(get(moved, 1), p(2, 2))); assert.equal(moved.player.hp, 2);
  }
});

test('a Heavy jump can cross a dodging player without turning back to hit them', () => {
  const s = fixture({ enemies: [enemy(1, 0, 0, { kind: 'heavy' })] });
  planEnemies(s);
  const forecast = structuredClone(get(s, 1).intent!);
  assert.equal(forecast.movement, 'jump'); assert(same(forecast.destination, p(2, 2)));
  assert(forecast.tiles.some(point => same(point, p(3, 3))));
  assert(!forecast.tiles.some(point => same(point, p(1, 1))));
  const dodged = act(s, 'dash', p(1, 1));
  assert(same(get(dodged, 1), p(2, 2)));
  assert.equal(dodged.player.hp, 3);
  assert.deepEqual(get(s, 1).intent, forecast);
});

test('a blocked or out-of-bounds jump landing cancels the entire advertised action', () => {
  for (const obstruction of ['wall', 'enemy', 'player', 'outside']) {
    const s = fixture({ enemies: [enemy(1, 0, 0, { kind: 'heavy' })] });
    planEnemies(s);
    assert(same(get(s, 1).intent!.destination, p(2, 2)));
    if (obstruction === 'wall') s.walls.push(p(2, 2));
    if (obstruction === 'enemy') s.enemies.push(enemy(2, 2, 2, { breached: true, guard: 0, stun: 1 }));
    if (obstruction === 'outside') get(s, 1).intent!.destination = p(7, 7);
    const resolved = obstruction === 'player' ? act(s, 'dash', p(2, 2)) : act(s, 'light', p(3, 4));
    assert(same(get(resolved, 1), p(0, 0)), obstruction);
    assert.equal(resolved.player.hp, 3, obstruction);
  }
});

test('Sweep cannot attack diagonally through a blocked wall corner', () => {
  const s = fixture({ walls: [p(3, 2), p(2, 3)], enemies: [enemy(1, 2, 2)] });
  planEnemies(s);
  assert.equal(get(s, 1).intent?.kind, 'move');
  assert.deepEqual(get(s, 1).intent!.tiles, []);
});

test('move-only intentions never cause damage even if supplied attack tiles', () => {
  const s = fixture({ enemies: [enemy(1, 0, 0)] });
  s.player.x = 6; s.player.y = 5;
  planEnemies(s);
  assert.equal(get(s, 1).intent!.kind, 'move');
  get(s, 1).intent!.tiles = [{ ...s.player }];
  const resolved = act(s, 'light', p(6, 4));
  assert.equal(resolved.player.hp, 3);
});

test('selective replanning preserves canceled and unselected intentions and respects frozen time', () => {
  const s = createGame(13);
  s.enemies[0].intent = null;
  s.enemies[0].opening = true;
  const protectedEnemies = structuredClone([s.enemies[0], s.enemies[2]]);
  planEnemies(s, new Set([s.enemies[1].id]));
  assert.deepEqual([s.enemies[0], s.enemies[2]], protectedEnemies);
  const destinations = s.enemies.flatMap(e => e.intent ? [e.intent.destination] : []);
  assert.equal(new Set(points(destinations)).size, destinations.length);
  const before = structuredClone(s);
  planEnemies(s, new Set()); assert.deepEqual(s, before);
  s.phase = 'attack';
  const frozen = structuredClone(s);
  planEnemies(s); planEnemies(s, new Set(s.enemies.map(e => e.id)));
  assert.deepEqual(s, frozen);
});

test('earlier planned landings cannot unexpectedly obstruct later advertised ground dashes', () => {
  for (const seed of [8, 1, 2, 3, 13, 24, 37]) {
    let s = createGame(seed);
    for (let room = 1; room <= TOTAL_ROOMS; room++) {
      const plans = s.enemies.filter(e => e.intent).map(e => ({ id: e.id, destination: { ...e.intent!.destination } }));
      assert(!s.enemies.some(e => distance(e, s.player) <= 1), 'Light is a guaranteed miss in fresh arenas');
      const resolved = act(s, 'light', p(s.player.x, s.player.y - 1));
      for (const plan of plans) assert(same(get(resolved, plan.id), plan.destination), `seed ${seed}, arena ${room}, enemy ${plan.id}`);
      if (room < TOTAL_ROOMS) s = execute({ ...s, phase: 'cleared', enemies: [] }, { type: 'nextRoom' });
    }
  }
});

test('surrounded players always retain Light Attack and never need a skipped slot', () => {
  const s = fixture({ enemies: DIRS.map((d, i) => enemy(i, 3 + d.x, 3 + d.y)) });
  assert.deepEqual(validTargets(s, 'dash'), []);
  assert.equal(validTargets(s, 'light').length, 8);
  const hit = act(s, 'light', p(3, 2));
  assert.notEqual(hit, s);
  assert.equal(hit.round, 2);
  assert.equal(hit.player.attunement, 2);
  assert(!('slot' in hit));
});

test('entry threshold is three, budget caps at ten, and pulse remains active', () => {
  assert.equal(THRESHOLD, 3); assert.equal(MAX_ATTUNEMENT, 10);
  assert.equal(COSTS.dashAttack, 1); assert.equal(COSTS.deflect, 1);
  for (const value of [2, 3, 10, 100, Infinity]) {
    const s = bank(fixture({ enemies: [enemy(1, 3, 1, { guard: 5 })] }), value);
    const result = execute(s, { type: 'beginAttack' });
    if (value < 3) assert.equal(result, s);
    else {
      assert.equal(result.phase, 'attack');
      assert.equal(result.charge, Math.min(value, 10));
      assert.equal(result.player.attunement, 0);
      assert(get(result, 1).breached);
      assert.equal(result.round, s.round);
      assert.equal(s.player.attunement, value);
    }
  }
  for (const phase of ['attack', 'cleared', 'won', 'lost'] as const) assert(!canBeginAttack(bank(fixture({ phase }), 10)));
});

test('beginning and ending frozen time preserve every unhit enemy intention and cycle', () => {
  const s = bank(fixture({ enemies: [incoming(1, p(0, 0))] }), 6);
  const frozen = execute(s, { type: 'beginAttack' });
  assert.deepEqual(frozen.enemies[0].intent, s.enemies[0].intent);
  const before = structuredClone(frozen.enemies);
  const ended = execute(frozen, { type: 'endAttack' });
  assert.equal(ended.phase, 'normal');
  assert.equal(ended.charge, 0);
  assert.equal(ended.player.attunement, 0);
  assert.equal(ended.round, s.round);
  assert.deepEqual(ended.enemies, before);
});

test('Dash Attack moves on a queen line and strikes forward from its destination', () => {
  for (let direction = 0; direction < DIRS.length; direction++) {
    const d = DIRS[direction];
    const destination = p(3 + d.x, 3 + d.y);
    const target = p(3 + d.x * 2, 3 + d.y * 2);
    const s = fixture({ phase: 'attack', charge: 3, enemies: [enemy(1, target.x, target.y)] });
    const preview = previewAction(s, 'dashAttack', destination);
    assert.deepEqual(points(preview), points(arc(destination, direction as Direction)));
    const hit = act(s, 'dashAttack', destination);
    assert(same(hit.player, destination));
    assert.equal(get(hit, 1).guard, 15);
    assert.equal(get(hit, 1).hp, 3);
    assert.equal(hit.charge, 2);
    assert.equal(hit.round, 1);
    assert.equal(hit.player.attunement, 0);
  }
});

test('Dash Attack hits all three arc neighbors equally and leaves side-adjacent units untouched', () => {
  const s = fixture({ phase: 'attack', charge: 2, enemies: [enemy(1, 3, 1), enemy(2, 2, 1), enemy(3, 4, 1), enemy(4, 4, 2)] });
  const hit = act(s, 'dashAttack', p(3, 2));
  for (const id of [1, 2, 3]) assert.equal(get(hit, id).guard, 15);
  assert.equal(get(hit, 4).guard, 20);
  assert.equal(hit.charge, 1);
});

test('Dash Attack newly breaches armor without spilling into life or removing the target', () => {
  const s = fixture({ phase: 'attack', charge: 3, enemies: [enemy(1, 3, 1, { guard: 5, maxGuard: 5, hp: 1, maxHp: 1 })] });
  const hit = act(s, 'dashAttack', p(3, 2));
  const e = get(hit, 1);
  assert.equal(e.guard, 0); assert(e.breached); assert.equal(e.stun, 1);
  assert.equal(e.hp, 1); assert(!e.removed);
  assert.equal(hit.phase, 'attack');
});

test('Dash Attack resolves each enemy armor or core layer independently', () => {
  const s = fixture({ phase: 'attack', charge: 3, enemies: [enemy(1, 3, 1, { guard: 5 }), enemy(2, 2, 1, { guard: 0, breached: true, stun: 1 }), enemy(3, 4, 1)] });
  const hit = act(s, 'dashAttack', p(3, 2));
  assert(get(hit, 1).breached); assert.equal(get(hit, 1).hp, 3);
  assert.equal(get(hit, 2).hp, 2); assert(get(hit, 2).removed); assert.equal(get(hit, 2).guard, 20);
  assert.equal(get(hit, 3).guard, 15); assert.equal(get(hit, 3).hp, 3);
  assert.equal(hit.charge, 2);
});

test('core-hit survivors leave until frozen time ends and cannot be hit again in that phase', () => {
  let s = fixture({ phase: 'attack', charge: 5, enemies: [enemy(1, 3, 1, { guard: 0, breached: true, stun: 1 }), enemy(2, 0, 6)] });
  s = act(s, 'dashAttack', p(3, 2));
  assert(get(s, 1).removed);
  assert.equal(get(s, 1).hp, 2);
  assert(clearPath(s, s.player, p(3, 0)));
  s = act(s, 'dashAttack', p(3, 3));
  s = act(s, 'dashAttack', p(3, 2));
  assert.equal(get(s, 1).hp, 2);
  const ended = execute(s, { type: 'endAttack' });
  assert(!get(ended, 1).removed); assert(!get(ended, 1).breached);
  assert.equal(get(ended, 1).guard, 20); assert.equal(get(ended, 1).intent, null);
  assert.equal(ended.charge, 0); assert.equal(ended.round, 1);
});

test('core survivors return safely if the player dashes onto their old tile', () => {
  let s = fixture({ phase: 'attack', charge: 3, enemies: [enemy(1, 3, 1, { guard: 0, breached: true }), enemy(2, 0, 6)] });
  s = act(s, 'dashAttack', p(3, 2));
  s = act(s, 'dashAttack', p(3, 1));
  const ended = execute(s, { type: 'endAttack' });
  assert(!same(get(ended, 1), ended.player));
  assert(!same(get(ended, 1), get(ended, 2)));
  assert(!ended.walls.some(w => same(w, get(ended, 1))));
  assert.equal(distance(get(ended, 1), p(3, 1)), 1);
});

test('frozen actions never advance enemy positions, cycles, stun, Guard recovery, or player damage', () => {
  const s = fixture({ phase: 'attack', charge: 3, enemies: [enemy(1, 0, 0, { guard: 0, breached: true, stun: 1 }), incoming(2, p(0, 6))] });
  const before = structuredClone(s.enemies);
  const moved = act(s, 'dashAttack', p(4, 3));
  assert.deepEqual(moved.enemies, before);
  assert.equal(moved.round, 1); assert.equal(moved.player.hp, PLAYER_MAX_HP); assert.equal(moved.charge, 2);
  planEnemies(moved); assert.deepEqual(moved.enemies, before);
});

test('a zero-budget frozen phase remains frozen until explicitly ended', () => {
  const s = fixture({ phase: 'attack', charge: 1 });
  const moved = act(s, 'dashAttack', p(4, 3));
  assert.equal(moved.phase, 'attack'); assert.equal(moved.charge, 0); assert.equal(moved.round, 1);
  assert.deepEqual(validTargets(moved, 'dashAttack'), []);
  assert.equal(act(moved, 'dashAttack', p(5, 3)), moved);
  const ended = execute(moved, { type: 'endAttack' });
  assert.equal(ended.phase, 'normal'); assert.equal(ended.round, 1);
});

test('dead core targets never return; final kills clear arenas and the fifth wins', () => {
  for (const room of [1, TOTAL_ROOMS]) {
    const s = fixture({ room, phase: 'attack', charge: 3, enemies: [enemy(1, 3, 1, { hp: 1, guard: 0, breached: true })] });
    const killed = act(s, 'dashAttack', p(3, 2));
    assert.equal(killed.phase, room === TOTAL_ROOMS ? 'won' : 'cleared');
    assert.equal(killed.charge, 0); assert.equal(get(killed, 1).hp, 0);
    if (room === 1) {
      killed.player.hp = 1;
      const advanced = execute(killed, { type: 'nextRoom' });
      assert.equal(advanced.room, 2); assert.equal(advanced.phase, 'normal'); assert.equal(advanced.player.hp, 3);
    }
  }
});

test('pulse reaches non-queen bearings and damages each shell only once', () => {
  const s = fixture({ enemies: [enemy(1, 6, 1), enemy(2, 0, 5)] });
  const result = pulse(s, true);
  assert.deepEqual(ids(result.hitIds), [1, 2]);
  assert.equal(get(s, 1).guard, 15); assert.equal(get(s, 2).guard, 15); assert.equal(get(s, 1).hp, 3);
});

test('a surviving shell shadows its full silhouette while partial exposure stays reachable', () => {
  const blocked = fixture({ enemies: [enemy(1, 3, 1), enemy(2, 3, 0)] });
  const result = pulse(blocked, true);
  assert.deepEqual(result.hitIds, [1]); assert.equal(get(blocked, 2).guard, 20);
  assert(result.shadowTiles.some(t => same(t, p(3, 0))));
  const exposed = fixture({ enemies: [enemy(1, 3, 1), enemy(2, 4, 0)] });
  assert.deepEqual(ids(pulse(exposed, true).hitIds), [1, 2]);
});

test('new and existing breaches transmit through a chain during the same pulse', () => {
  const s = fixture({ enemies: [enemy(1, 3, 2, { guard: 5 }), enemy(2, 3, 1, { guard: 0, breached: true, stun: 1 }), enemy(3, 3, 0)] });
  const result = pulse(s, true);
  assert.deepEqual(ids(result.hitIds), [1, 3]); assert.deepEqual(result.breachedIds, [1]);
  assert.equal(get(s, 3).guard, 15); assert.equal(get(s, 2).hp, 3);
});

test('visible Opening breaches any Guard and cancels its intent', () => {
  const front = incoming(1, p(3, 1), true); front.guard = 250; front.maxGuard = 250; front.opening = true;
  const s = fixture({ enemies: [front, enemy(2, 3, 0)] });
  pulse(s, true);
  assert(get(s, 1).breached); assert.equal(get(s, 1).guard, 0); assert.equal(get(s, 1).intent, null);
  assert.equal(get(s, 1).opening, false); assert.equal(get(s, 2).guard, 15);
});

test('shadowed Opening stays protected and walls never transmit', () => {
  const s = fixture({ enemies: [enemy(1, 3, 1), enemy(2, 3, 0, { opening: true })] });
  pulse(s, true); assert(!get(s, 2).breached);
  const w = fixture({ walls: [p(3, 1)], enemies: [enemy(2, 3, 0, { opening: true })] });
  assert.deepEqual(pulse(w, true).hitIds, []); assert(!get(w, 2).breached);
});

test('zero-width corner contact cannot leak between touching wall silhouettes', () => {
  const s = fixture({ walls: [p(4, 3), p(3, 2)], enemies: [enemy(1, 4, 2)] });
  assert.deepEqual(pulse(s, true).hitIds, []);
});

test('removed and dead units do not cast pulse shadows', () => {
  for (const fields of [{ removed: true }, { hp: 0 }]) {
    const s = fixture({ enemies: [enemy(1, 3, 1, fields), enemy(2, 3, 0)] });
    assert.deepEqual(pulse(s, true).hitIds, [2]);
  }
});

test('pulse preview is pure and predicts the applied result', () => {
  const s = fixture({ enemies: [enemy(1, 3, 1, { opening: true }), enemy(2, 3, 0)] });
  const before = structuredClone(s); const preview = pulse(s, false);
  assert.deepEqual(s, before); assert.deepEqual(pulse(s, true), preview);
});

test('pulse visibility and breaches remain invariant under quarter turns', () => {
  const source = fixture({ walls: [p(1, 2), p(4, 5)], enemies: [enemy(1, 3, 1), enemy(2, 4, 0), enemy(3, 0, 4, { guard: 5 }), enemy(4, 0, 6)] });
  const rotate = (t: Point) => p(SIZE - 1 - t.y, t.x);
  let s = source; let expected = pulse(s, false);
  for (let i = 0; i < 4; i++) {
    s = { ...structuredClone(s), player: { ...s.player, ...rotate(s.player) }, walls: s.walls.map(rotate), enemies: s.enemies.map(e => ({ ...e, ...rotate(e) })) };
    const actual = pulse(s, false);
    assert.deepEqual(ids(actual.hitIds), ids(expected.hitIds)); assert.deepEqual(ids(actual.breachedIds), ids(expected.breachedIds));
    assert.deepEqual(points(actual.visibleTiles), points(expected.visibleTiles.map(rotate))); expected = actual;
  }
});

test('invalid commands preserve identity and every field, including removed legacy actions', () => {
  const cases: [GameState, unknown][] = [
    [fixture(), { type: 'resolve' }], [fixture(), { type: 'skipStep' }], [fixture(), { type: 'endAttack' }], [fixture(), { type: 'nextRoom' }],
    [fixture(), { type: 'act', ability: 'focus' }], [fixture(), { type: 'act', ability: 'quickstep', target: p(4, 3) }],
    [fixture(), { type: 'act', ability: 'light' }], [fixture(), { type: 'act', ability: 'dash', target: p(3, 3) }],
    [fixture(), { type: 'act', ability: 'dash', target: p(6, 1) }], [fixture(), { type: 'act', ability: 'dash', target: p(7, 3) }],
    [fixture(), { type: 'act', ability: 'deflect', target: p(3, 2) }],
    [fixture({ phase: 'attack', charge: 3 }), { type: 'act', ability: 'light', target: p(3, 2) }],
    [fixture({ phase: 'attack', charge: 3 }), { type: 'act', ability: 'dash', target: p(4, 3) }],
    [fixture({ phase: 'attack', charge: 0 }), { type: 'act', ability: 'dashAttack', target: p(4, 3) }],
    [fixture({ phase: 'lost' }), { type: 'act', ability: 'light', target: p(3, 2) }],
  ];
  for (const [s, command] of cases) {
    const before = structuredClone(s); assert.equal(execute(s, command as Command), s, JSON.stringify(command)); assert.deepEqual(s, before);
  }
});

test('target and preview inspection never advances simulation', () => {
  for (const s of [bank(fixture(), 3), fixture({ phase: 'attack', charge: 3 })]) {
    const before = structuredClone(s);
    for (const ability of availableAbilities(s)) for (const target of validTargets(s, ability)) previewAction(s, ability, target);
    pulse(s, false); assert.deepEqual(s, before);
  }
});

function checkLayout(s: GameState) {
  assert(inside(s.player));
  const walls = new Set(points(s.walls)); assert.equal(walls.size, s.walls.length);
  assert(!walls.has(`${s.player.x},${s.player.y}`));
  assert(!s.walls.some(wall => distance(wall, s.player) <= 1), `blocked start space in seed ${s.seed}`);
  assert(!s.enemies.some(e => distance(e, s.player) <= 1), `enemy in start space in seed ${s.seed}`);
  const occupied = new Set([`${s.player.x},${s.player.y}`]);
  for (const e of s.enemies.filter(e => e.hp > 0 && !e.removed)) {
    assert(inside(e)); const key = `${e.x},${e.y}`;
    assert(!occupied.has(key), `overlap in seed ${s.seed}`); assert(!walls.has(key)); occupied.add(key);
    assert.equal(e.guard, GUARD[e.kind]);
    if (e.kind === 'lunge') { assert.equal(e.guard, 5); assert.equal(e.hp, 1); }
  }
  const reached = new Set([`${s.player.x},${s.player.y}`]); const queue: Point[] = [s.player];
  for (let i = 0; i < queue.length; i++) for (const d of [p(0, 1), p(1, 0), p(0, -1), p(-1, 0)]) {
    const t = p(queue[i].x + d.x, queue[i].y + d.y); const key = `${t.x},${t.y}`;
    if (inside(t) && !walls.has(key) && !reached.has(key)) { reached.add(key); queue.push(t); }
  }
  assert.equal(reached.size, SIZE * SIZE - walls.size, `disconnected seed ${s.seed}`);
}

test('all five arenas remain deterministic, connected, and collision-free in the smaller board', () => {
  for (let seed = 1; seed <= 48; seed++) {
    let s = createGame(seed); assert.deepEqual(s, createGame(seed)); assert.equal(s.version, 5);
    for (let room = 1; room <= TOTAL_ROOMS; room++) {
      checkLayout(s); assert(same(s.player, p(3, 3))); assert(s.walls.length >= 3 && s.walls.length <= 5);
      assert.equal(s.enemies.length, 3 + Math.floor((room - 1) / 2));
      if (room < TOTAL_ROOMS) s = execute({ ...s, phase: 'cleared', enemies: [] }, { type: 'nextRoom' });
    }
  }
});

test('enemy planning reserves legal distinct destinations and has deterministic opening cycles', () => {
  let sawGapCloser = false, sawMultitile = false, sawOpening = false;
  for (let seed = 1; seed <= 32; seed++) {
    const a = createGame(seed), b = structuredClone(a); planEnemies(a); planEnemies(b); assert.deepEqual(a, b);
    const destinations = new Set<string>();
    for (const e of a.enemies) {
      if (!e.intent) continue;
      assert(inside(e.intent.destination)); assert(!same(e.intent.destination, a.player));
      assert(!a.walls.some(w => same(w, e.intent!.destination)));
      const key = `${e.intent.destination.x},${e.intent.destination.y}`;
      assert(!destinations.has(key)); destinations.add(key); assert(e.intent.tiles.every(inside));
      sawGapCloser ||= !same(e, e.intent.destination); sawMultitile ||= e.intent.tiles.length > 1;
      e.cycle = e.kind === 'heavy' ? 1 : 2;
    }
    planEnemies(a); sawOpening ||= a.enemies.some(e => e.opening);
  }
  assert(sawGapCloser && sawMultitile && sawOpening);
});

function segmentTouchesWall(from: Point, to: Point, wall: Point): boolean {
  let entry = 0, exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = to[axis] - from[axis];
    const low = wall[axis] - 0.5, high = wall[axis] + 0.5;
    if (delta === 0) {
      if (from[axis] < low || from[axis] > high) return false;
    } else {
      const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
      entry = Math.max(entry, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    }
  }
  return entry <= exit;
}

test('every planned attack reaches the player with the actual travel heading and clear wall footprint', () => {
  let attacks = 0, approaches = 0, jumps = 0;
  for (let seed = 1; seed <= 64; seed++) {
    for (const location of [p(0, 0), p(6, 0), p(0, 6), p(6, 6), p(3, 3), p(3, 5)]) {
      const s = createGame(seed);
      if (s.walls.some(w => same(w, location)) || s.enemies.some(e => same(e, location))) continue;
      s.player.x = location.x; s.player.y = location.y;
      planEnemies(s);
      for (const e of s.enemies) {
        const intent = e.intent; if (!intent) continue;
        const moving = !same(e, intent.destination);
        assert.equal(intent.direction, moving ? directionTo(e, intent.destination) : directionTo(e, s.player));
        if (moving) {
          const dx = intent.destination.x - e.x, dy = intent.destination.y - e.y;
          assert(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy));
          assert(distance(e, intent.destination) <= (e.kind === 'lunge' ? 3 : 2));
          assert.equal(intent.movement, e.kind === 'heavy' ? 'jump' : 'dash');
          assert(!same(intent.destination, s.player));
          assert(!s.enemies.some(other => other.id !== e.id && same(other, intent.destination)));
          if (intent.movement === 'dash') assert(clearPath(s, e, intent.destination, e.id));
          else jumps++;
        } else assert.equal(intent.movement, 'none');
        if (intent.kind === 'attack') {
          attacks++;
          assert(intent.tiles.some(point => same(point, s.player)));
          assert(intent.label.endsWith('1 damage'));
          for (const point of intent.tiles) {
            assert(inside(point));
            assert(!s.walls.some(wall => segmentTouchesWall(intent.destination, point, wall)), JSON.stringify({ enemy: e, point, walls: s.walls }));
          }
        } else {
          approaches++;
          assert(moving); assert.deepEqual(intent.tiles, []);
          assert(intent.label.endsWith('approach'));
        }
      }
    }
  }
  assert(attacks > 0 && approaches > 0 && jumps > 0);
});

test('restart resets normal turn state and does not retain obsolete slot fields', () => {
  const s = createGame(731);
  assert.equal(s.phase, 'normal'); assert.equal(s.room, 1); assert.equal(s.round, 1);
  assert.equal(s.player.attunement, 0); assert.equal(s.player.hp, s.player.maxHp);
  assert.equal(s.player.hp, 3); assert.equal(s.player.maxHp, 3);
  assert(s.enemies.every(e => !e.intent || (e.intent.kind === 'attack' ? e.intent.label.endsWith('1 damage') : e.intent.label.endsWith('approach'))));
  assert(!('slot' in s)); assert(!('resumePhase' in s));
});

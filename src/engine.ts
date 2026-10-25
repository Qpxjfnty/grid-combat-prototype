import { Ability, ComboStep, Command, COSTS, DIRS, Direction, Enemy, EnemyKind, ENEMY_DAMAGE, GameState, GUARD, MAX_ATTUNEMENT, PLAYER_MAX_HP, Point, SIZE, STATE_VERSION, THRESHOLD, TOTAL_ROOMS } from './model';
import { arc, clearPath, directionTo, distance, inside, pulse, same } from './geometry';

const kinds: EnemyKind[] = ['lunge', 'sweep', 'heavy'];
const attributes = {
  lunge: { guard: GUARD.lunge, hp: 1, reach: 3 },
  sweep: { guard: GUARD.sweep, hp: 2, reach: 2 },
  heavy: { guard: GUARD.heavy, hp: 3, reach: 1 },
};
const active = (enemy: Enemy) => enemy.hp > 0 && !enemy.removed;
const isWall = (state: GameState, point: Point) => state.walls.some(wall => same(wall, point));
const occupant = (state: GameState, point: Point) => state.enemies.find(enemy => active(enemy) && same(enemy, point));
const empty = (state: GameState, point: Point) => inside(point) && !isWall(state, point) && !occupant(state, point);
const allTiles = (): Point[] => Array.from({ length: SIZE * SIZE }, (_, index) => ({ x: index % SIZE, y: Math.floor(index / SIZE) }));

function crossesPlayer(state: GameState, from: Point, to: Point): boolean {
  const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
  for (let step = 1; step <= distance(from, to); step++) {
    if (same(state.player, { x: from.x + dx * step, y: from.y + dy * step })) return true;
  }
  return false;
}

function random(state: GameState): number {
  state.rng = (Math.imul(1664525, state.rng) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

function shuffle<T>(state: GameState, values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index--) {
    const other = Math.floor(random(state) * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

function log(state: GameState, message: string): void {
  state.log = [message, ...state.log].slice(0, 12);
}

function connected(walls: Point[]): boolean {
  const blocked = new Set(walls.map(point => `${point.x},${point.y}`));
  const reached = new Set<string>();
  const queue: Point[] = [{ x: 0, y: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    const key = `${point.x},${point.y}`;
    if (!inside(point) || blocked.has(key) || reached.has(key)) continue;
    reached.add(key);
    for (const direction of [DIRS[0], DIRS[2], DIRS[4], DIRS[6]]) queue.push({ x: point.x + direction.x, y: point.y + direction.y });
  }
  return reached.size === SIZE * SIZE - walls.length;
}

function populateRoom(state: GameState): void {
  state.player.x = Math.floor(SIZE / 2);
  state.player.y = Math.floor(SIZE / 2);
  state.walls = [];
  state.enemies = [];
  state.round = 1;
  state.phase = 'normal';
  state.defenses = [];
  state.pulse = null;
  state.charge = 0;
  const candidates = shuffle(state, allTiles().filter(point => point.x > 0 && point.x < SIZE - 1 && point.y > 0 && point.y < SIZE - 1 && distance(point, state.player) > 1));
  const desiredWalls = 3 + Math.floor((state.room - 1) / 2);
  for (const candidate of candidates) {
    if (state.walls.length >= desiredWalls) break;
    const next = [...state.walls, candidate];
    if (connected(next)) state.walls = next;
  }
  const count = 3 + Math.floor((state.room - 1) / 2);
  const locations = shuffle(state, allTiles().filter(point => !isWall(state, point) && distance(point, state.player) >= 3));
  for (let index = 0; index < count; index++) {
    const locationIndex = locations.findIndex(point => state.enemies.every(enemy => distance(point, enemy) >= 2));
    const location = locations.splice(locationIndex >= 0 ? locationIndex : 0, 1)[0];
    const kind = kinds[(index + state.room - 1) % kinds.length];
    const stats = attributes[kind];
    state.enemies.push({
      id: state.room * 10 + index + 1,
      ...location,
      kind,
      hp: stats.hp,
      maxHp: stats.hp,
      guard: stats.guard,
      maxGuard: stats.guard,
      breached: false,
      stun: 0,
      removed: false,
      opening: false,
      cycle: 0,
      comboStep: 0,
      intent: null,
    });
  }
  planEnemies(state);
  log(state, `Arena ${state.room}/${TOTAL_ROOMS}. Enemies resolve after each normal action.`);
}

export function createGame(seed: number = Date.now()): GameState {
  const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1;
  const state: GameState = {
    version: STATE_VERSION,
    seed: normalizedSeed,
    rng: normalizedSeed,
    room: 1,
    round: 1,
    phase: 'normal',
    player: { x: Math.floor(SIZE / 2), y: Math.floor(SIZE / 2), hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, attunement: 0 },
    charge: 0,
    walls: [],
    enemies: [],
    defenses: [],
    log: [],
    pulse: null,
  };
  populateRoom(state);
  return state;
}

export function availableAbilities(state: GameState): Ability[] {
  if (state.phase === 'normal') return ['dash', 'light', 'deflect'];
  if (state.phase === 'attack') return ['dashAttack'];
  return [];
}

function attackArc(state: GameState, origin: Point, direction: Direction, width: 3 | 5 = 3): Point[] {
  return arc(origin, direction, width).filter(point => !isWall(state, point));
}

export function validTargets(state: GameState, ability: Ability): Point[] {
  if (!availableAbilities(state).includes(ability)) return [];
  if (ability === 'deflect' && state.player.attunement < (COSTS.deflect ?? 1)) return [];
  if (ability === 'dashAttack' && state.charge < (COSTS.dashAttack ?? 1)) return [];
  if (ability === 'dash' || ability === 'dashAttack') {
    return allTiles().filter(point => !same(point, state.player) && empty(state, point) && clearPath(state, state.player, point));
  }
  return DIRS.map(direction => ({ x: state.player.x + direction.x, y: state.player.y + direction.y })).filter(inside);
}

export function previewAction(state: GameState, ability: Ability, target: Point): Point[] {
  if (!validTargets(state, ability).some(point => same(point, target))) return [];
  if (ability === 'light' || ability === 'deflect') return attackArc(state, state.player, directionTo(state.player, target), ability === 'deflect' ? 5 : 3);
  if (ability === 'dashAttack') return attackArc(state, target, directionTo(state.player, target));
  return [{ x: target.x, y: target.y }];
}

export function canBeginAttack(state: GameState): boolean {
  return state.phase === 'normal' && state.player.attunement >= THRESHOLD;
}

function damageGuard(state: GameState, enemy: Enemy, amount: number): boolean {
  if (!active(enemy) || enemy.breached) return false;
  enemy.guard = Math.max(0, enemy.guard - amount);
  if (enemy.guard > 0) return false;
  enemy.breached = true;
  enemy.comboStep = 0;
  enemy.stun = 1;
  enemy.intent = null;
  enemy.opening = false;
  log(state, `Enemy ${enemy.id} breached. Its attack is interrupted.`);
  return true;
}

function checkClear(state: GameState): void {
  if (state.player.hp <= 0) {
    state.player.hp = 0;
    state.phase = 'lost';
    log(state, 'Run ended.');
  } else if (state.enemies.every(enemy => enemy.hp <= 0)) {
    state.charge = 0;
    state.defenses = [];
    state.phase = state.room === TOTAL_ROOMS ? 'won' : 'cleared';
    log(state, state.phase === 'won' ? 'All five arenas cleared.' : `Arena ${state.room} cleared.`);
  }
}

function endAttack(state: GameState): void {
  // A core-hit survivor returns only after frozen time ends; its old tile may now be occupied.
  for (const enemy of state.enemies.filter(enemy => enemy.removed && enemy.hp > 0)) {
    const destination = allTiles().filter(point => empty(state, point) && !same(point, state.player)).sort((a, b) => distance(a, enemy) - distance(b, enemy) || a.y - b.y || a.x - b.x)[0];
    if (destination) {
      enemy.x = destination.x;
      enemy.y = destination.y;
      enemy.removed = false;
      enemy.guard = enemy.maxGuard;
      enemy.breached = false;
      enemy.stun = 0;
      enemy.opening = false;
      enemy.intent = null;
    }
  }
  const discarded = state.charge;
  state.charge = 0;
  state.phase = 'normal';
  log(state, `Attack turn ended.${discarded ? ` ${discarded} unused charge lost.` : ''}`);
  checkClear(state);
}

function wallClearLine(state: GameState, from: Point, to: Point): boolean {
  if (!inside(from) || !inside(to)) return false;
  const dx = to.x - from.x, dy = to.y - from.y;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const tx = dx ? 1 / Math.abs(dx) : Infinity, ty = dy ? 1 / Math.abs(dy) : Infinity;
  let nextX = tx / 2, nextY = ty / 2;
  let x = from.x, y = from.y;
  // Traverse every square touched by the center-to-center attack line, including blocked corners.
  while (x !== to.x || y !== to.y) {
    if (Math.abs(nextX - nextY) < 1e-10) {
      if (isWall(state, { x: x + sx, y }) || isWall(state, { x, y: y + sy })) return false;
      x += sx; y += sy; nextX += tx; nextY += ty;
    } else if (nextX < nextY) {
      x += sx; nextX += tx;
    } else {
      y += sy; nextY += ty;
    }
    if (!inside({ x, y }) || isWall(state, { x, y })) return false;
  }
  return true;
}

const outerRing: Point[] = [
  { x: 0, y: -2 }, { x: 1, y: -2 }, { x: 2, y: -2 }, { x: 2, y: -1 },
  { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 },
  { x: 0, y: 2 }, { x: -1, y: 2 }, { x: -2, y: 2 }, { x: -2, y: 1 },
  { x: -2, y: 0 }, { x: -2, y: -1 }, { x: -2, y: -2 }, { x: -1, y: -2 },
];
const westSweep: Point[] = [
  { x: -2, y: -1 }, { x: -2, y: 0 }, { x: -2, y: 1 },
  { x: -1, y: -2 }, { x: -1, y: -1 }, { x: -1, y: 0 }, { x: -1, y: 1 }, { x: -1, y: 2 },
  { x: 0, y: -2 }, { x: 0, y: -1 }, { x: 0, y: 1 }, { x: 0, y: 2 },
  { x: 1, y: -1 }, { x: 1, y: 1 },
];

export function heavyAttackTiles(_state: GameState, origin: Point, direction: Direction, step: 0 | 1 | 2): { tiles: Point[]; impact?: Point } {
  if (step === 0) return { tiles: DIRS.map(d => ({ x: origin.x + d.x, y: origin.y + d.y })).filter(inside) };
  if (step === 1) {
    const turns = (direction - 6 + 8) % 8;
    const tiles = westSweep.map(point => {
      const ring = Math.max(Math.abs(point.x), Math.abs(point.y)) === 1 ? DIRS : outerRing;
      const index = ring.findIndex(p => same(p, point));
      const rotated = ring[(index + turns * (ring.length / 8)) % ring.length];
      return { x: origin.x + rotated.x, y: origin.y + rotated.y };
    }).filter(inside);
    return { tiles };
  }
  const forward = DIRS[direction];
  const impact = { x: origin.x + forward.x, y: origin.y + forward.y };
  if (!inside(impact)) return { tiles: [] };
  const tiles = [impact];
  for (const ray of DIRS) for (let reach = 1; reach <= 3; reach++) {
    const point = { x: impact.x + ray.x * reach, y: impact.y + ray.y * reach };
    // Heavy attacks ignore terrain and units; only the attacker's body stops its own ray.
    if (same(point, origin) || !inside(point)) break;
    tiles.push(point);
  }
  return { tiles, impact };
}

function attackTiles(state: GameState, enemy: Enemy, destination: Point, direction: Direction): Point[] {
  if (enemy.kind === 'heavy') return enemy.comboStep === 3 ? [] : heavyAttackTiles(state, destination, direction, enemy.comboStep).tiles;
  const forward = DIRS[direction];
  if (enemy.kind === 'lunge') {
    return [1, 2].map(step => ({ x: destination.x + forward.x * step, y: destination.y + forward.y * step })).filter(point => wallClearLine(state, destination, point));
  }
  return arc(destination, direction).filter(point => wallClearLine(state, destination, point));
}

function queenLine(from: Point, to: Point): boolean {
  const dx = to.x - from.x, dy = to.y - from.y;
  return !same(from, to) && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy));
}

function groundRouteClear(state: GameState, from: Point, to: Point, enemyId: number, reserved: ReadonlySet<string>): boolean {
  if (!clearPath(state, from, to, enemyId) || crossesPlayer(state, from, to)) return false;
  const sx = Math.sign(to.x - from.x), sy = Math.sign(to.y - from.y);
  for (let step = 1; step <= distance(from, to); step++) {
    const point = { x: from.x + sx * step, y: from.y + sy * step };
    if (reserved.has(`${point.x},${point.y}`)) return false;
  }
  return true;
}

function approachDistances(state: GameState, enemy: Enemy, reserved: ReadonlySet<string>): Map<string, number> {
  const reach = attributes[enemy.kind].reach;
  const walkable = (point: Point) => inside(point) && !isWall(state, point) && !same(point, state.player) && !reserved.has(`${point.x},${point.y}`) && (!occupant(state, point) || occupant(state, point)!.id === enemy.id);
  const queue = allTiles().filter(point => walkable(point) && (enemy.kind === 'heavy' && enemy.comboStep === 2
    ? DIRS.some((_, facing) => heavyAttackTiles(state, point, facing as Direction, 2).tiles.some(tile => same(tile, state.player)))
    : attackTiles(state, enemy, point, directionTo(point, state.player)).some(tile => same(tile, state.player))));
  const routes = new Map(queue.map(point => [`${point.x},${point.y}`, 0]));
  // Reverse breadth-first search finds the number of legal moves to an actual firing position.
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    const nextDistance = routes.get(`${point.x},${point.y}`)! + 1;
    for (const direction of DIRS) for (let step = 1; step <= reach; step++) {
      const candidate = { x: point.x + direction.x * step, y: point.y + direction.y * step };
      const key = `${candidate.x},${candidate.y}`;
      if (routes.has(key) || !walkable(candidate)) continue;
      if (!groundRouteClear(state, point, candidate, enemy.id, reserved)) continue;
      routes.set(key, nextDistance);
      queue.push(candidate);
    }
  }
  return routes;
}

function planHeavy(state: GameState, enemy: Enemy, reserved: ReadonlySet<string>): void {
  const step = enemy.comboStep;
  const direction = directionTo(enemy, state.player);
  enemy.opening = false;
  const wait = () => {
    enemy.intent = { destination: { x: enemy.x, y: enemy.y }, tiles: [], direction, movement: 'none', kind: 'wait', heavy: true, comboStep: step, label: step === 3 ? 'Heavy recovery' : 'Heavy wait' };
  };
  if (step === 3) { wait(); return; }
  const destinations = allTiles().filter(point => !same(point, enemy) && !same(point, state.player) && empty(state, point) && !reserved.has(`${point.x},${point.y}`) && (step === 0 || (distance(enemy, point) === 1 && groundRouteClear(state, enemy, point, enemy.id, reserved))));
  const origins = step === 0 ? destinations : [{ x: enemy.x, y: enemy.y }, ...destinations];
  const attacks = origins.filter(point => !reserved.has(`${point.x},${point.y}`)).flatMap(point => {
    const moving = !same(point, enemy);
    const facings = !moving && step === 2 ? DIRS.map((_, index) => index as Direction) : [moving ? directionTo(enemy, point) : direction];
    return facings.map(facing => ({ point, moving, direction: facing, aimDifference: Math.min((facing - direction + 8) % 8, (direction - facing + 8) % 8), ...heavyAttackTiles(state, point, facing, step) }));
  }).filter(candidate => candidate.tiles.some(point => same(point, state.player)));
  attacks.sort((a, b) => Number(b.moving) - Number(a.moving) || distance(a.point, state.player) - distance(b.point, state.player) || distance(enemy, a.point) - distance(enemy, b.point) || a.aimDifference - b.aimDifference || a.point.y - b.point.y || a.point.x - b.point.x);
  const attack = attacks[0];
  if (attack) {
    enemy.intent = { destination: { ...attack.point }, tiles: attack.tiles, direction: attack.direction, movement: attack.moving ? step === 0 ? 'jump' : 'dash' : 'none', kind: 'attack', heavy: true, comboStep: step, ...(attack.impact ? { impact: attack.impact } : {}), label: `${step === 0 ? 'Jump heavy' : step === 1 ? 'Heavy sweep' : 'Heavy burst'} · ${ENEMY_DAMAGE} damage` };
    enemy.opening = step === 0;
    return;
  }
  const routes = step === 0 ? undefined : approachDistances(state, enemy, reserved);
  const originRoute = routes?.get(`${enemy.x},${enemy.y}`);
  const route = (point: Point) => routes?.get(`${point.x},${point.y}`) ?? Infinity;
  const approaches = destinations.filter(point => originRoute === undefined ? distance(point, state.player) < distance(enemy, state.player) : route(point) < originRoute).sort((a, b) => (routes ? route(a) - route(b) : 0) || distance(a, state.player) - distance(b, state.player) || a.y - b.y || a.x - b.x);
  const approach = approaches[0];
  if (approach) enemy.intent = { destination: { ...approach }, tiles: [], direction: directionTo(enemy, approach), movement: step === 0 ? 'jump' : 'dash', kind: 'move', heavy: true, comboStep: step, label: step === 0 ? 'Jump approach' : 'Heavy approach' };
  else wait();
}

export function planEnemies(state: GameState, onlyIds?: ReadonlySet<number>): void {
  if (state.phase === 'attack') return;
  const reserved = new Set<string>();
  if (onlyIds) for (const enemy of state.enemies) {
    if (!active(enemy) || !enemy.intent || onlyIds.has(enemy.id)) continue;
    const { destination, movement } = enemy.intent;
    reserved.add(`${destination.x},${destination.y}`);
    // Selective migration must preserve ground commitments, including their traversed squares.
    if (movement === 'dash') {
      const sx = Math.sign(destination.x - enemy.x), sy = Math.sign(destination.y - enemy.y);
      for (let step = 1; step <= distance(enemy, destination); step++) {
        reserved.add(`${enemy.x + sx * step},${enemy.y + sy * step}`);
      }
    }
  }
  for (const enemy of state.enemies) {
    if (onlyIds && !onlyIds.has(enemy.id)) continue;
    if (!active(enemy) || enemy.breached || enemy.stun > 0) {
      enemy.intent = null;
      enemy.opening = false;
      continue;
    }
    if (enemy.kind === 'heavy') {
      planHeavy(state, enemy, reserved);
      if (enemy.intent) reserved.add(`${enemy.intent.destination.x},${enemy.intent.destination.y}`);
      continue;
    }
    enemy.comboStep = 0;
    const movement = 'dash';
    const reach = attributes[enemy.kind].reach;
    enemy.opening = enemy.kind === 'sweep' ? enemy.cycle % 4 === 2 : enemy.cycle % 3 === 2;
    const destinations = allTiles().filter(point => !same(point, state.player) && empty(state, point) && queenLine(enemy, point) && distance(enemy, point) <= reach && !reserved.has(`${point.x},${point.y}`) && groundRouteClear(state, enemy, point, enemy.id, reserved));
    const attacks = [{ x: enemy.x, y: enemy.y }, ...destinations].filter(point => !reserved.has(`${point.x},${point.y}`)).map(point => {
      const moving = !same(point, enemy);
      const direction = moving ? directionTo(enemy, point) : directionTo(enemy, state.player);
      const tiles = attackTiles(state, enemy, point, direction);
      return { point, direction, tiles, moving };
    }).filter(candidate => candidate.tiles.some(point => same(point, state.player)));
    // A moving attack keeps its travel heading; the player must already lie in that forward footprint.
    attacks.sort((a, b) => Number(b.moving) - Number(a.moving) || distance(a.point, state.player) - distance(b.point, state.player) || distance(enemy, a.point) - distance(enemy, b.point) || a.point.y - b.point.y || a.point.x - b.point.x);
    const attack = attacks[0];
    if (attack) {
      const motion = attack.moving ? movement : 'none';
      const label = attack.moving ? `Dash ${enemy.kind}` : enemy.kind === 'lunge' ? 'Lunge' : enemy.kind === 'sweep' ? 'Sweep' : 'Heavy';
      enemy.intent = { destination: { ...attack.point }, tiles: attack.tiles, direction: attack.direction, movement: motion, kind: 'attack', heavy: false, label: `${label} · ${ENEMY_DAMAGE} damage` };
      reserved.add(`${attack.point.x},${attack.point.y}`);
      continue;
    }
    const routes = approachDistances(state, enemy, reserved);
    const originRoute = routes.get(`${enemy.x},${enemy.y}`);
    const route = (point: Point) => routes.get(`${point.x},${point.y}`) ?? Infinity;
    const approaches = destinations.filter(point => originRoute === undefined ? distance(point, state.player) < distance(enemy, state.player) : route(point) < originRoute).sort((a, b) => route(a) - route(b) || distance(a, state.player) - distance(b, state.player) || distance(enemy, b) - distance(enemy, a) || a.y - b.y || a.x - b.x);
    const approach = approaches[0];
    if (approach) {
      enemy.intent = { destination: { ...approach }, tiles: [], direction: directionTo(enemy, approach), movement, kind: 'move', heavy: false, label: 'Dash approach' };
      reserved.add(`${approach.x},${approach.y}`);
    } else {
      enemy.intent = null;
    }
  }
}

function resolveEnemies(state: GameState, lightHitIds?: ReadonlySet<number>): void {
  const recovering = new Set(state.enemies.filter(enemy => active(enemy) && (enemy.breached || enemy.stun > 0)).map(enemy => enemy.id));
  // The set is local: each hit or parry suppresses armor recovery for this response only.
  const suppressedGuard = new Set(lightHitIds);
  const hitBy: string[] = [], parried: string[] = [], deflected: string[] = [];
  for (const enemy of state.enemies) {
    if (!active(enemy) || recovering.has(enemy.id) || !enemy.intent) continue;
    const intent = enemy.intent;
    // A committed Heavy step is spent even if its fixed attack misses or its landing is blocked.
    if (enemy.kind === 'heavy' && intent.comboStep !== undefined && (intent.comboStep !== 0 || intent.kind === 'attack')) enemy.comboStep = ((intent.comboStep + 1) % 4) as ComboStep;
    if (!same(enemy, intent.destination)) {
      // Never move an advertised attack to a new footprint when the planned landing tile is blocked.
      const landingBlocked = !empty(state, intent.destination) || same(intent.destination, state.player);
      const pathBlocked = intent.movement !== 'jump' && (crossesPlayer(state, enemy, intent.destination) || !clearPath(state, enemy, intent.destination, enemy.id));
      if (intent.movement === 'none' || landingBlocked || pathBlocked) {
        enemy.intent = null;
        continue;
      }
      enemy.x = intent.destination.x;
      enemy.y = intent.destination.y;
    }
    if (intent.kind !== 'attack' || !intent.tiles.some(point => same(point, state.player))) continue;
    const source = intent.impact && !same(intent.impact, state.player) ? intent.impact : enemy;
    const approach = directionTo(state.player, source);
    const deflection = state.defenses.some(defense => {
      const offset = (approach - defense.direction + 8) % 8;
      return defense.kind === 'deflect' && (offset <= 2 || offset >= 6);
    });
    const parry = !intent.heavy && state.defenses.some(defense => {
      const offset = (approach - defense.direction + 8) % 8;
      return defense.kind === 'light' && (offset <= 1 || offset >= 7 || lightHitIds?.has(enemy.id) || defense.parryEnemyId === enemy.id);
    });
    const sourceId = `${enemy.kind === 'lunge' ? 'L' : enemy.kind === 'sweep' ? 'S' : 'H'}${enemy.id}`;
    if (deflection) deflected.push(sourceId);
    else if (parry) {
      parried.push(sourceId);
      suppressedGuard.add(enemy.id);
    }
    else {
      state.player.hp = Math.max(0, state.player.hp - ENEMY_DAMAGE);
      hitBy.push(sourceId);
    }
  }
  for (const enemy of state.enemies.filter(active)) {
    enemy.cycle++;
    if (recovering.has(enemy.id)) {
      enemy.stun = Math.max(0, enemy.stun - 1);
      if (enemy.stun === 0 && !suppressedGuard.has(enemy.id)) {
        enemy.guard = enemy.maxGuard;
        enemy.breached = false;
      }
    } else if (!enemy.breached && !suppressedGuard.has(enemy.id)) {
      enemy.guard = Math.min(enemy.maxGuard, enemy.guard + GUARD.regen);
    }
    enemy.intent = null;
  }
  // Hit and parry share one reward, including a parry after the initial swing missed.
  const lightEarned = lightHitIds !== undefined && (lightHitIds.size > 0 || parried.length > 0);
  const beforeCharge = state.player.attunement;
  if (lightEarned) state.player.attunement = Math.min(MAX_ATTUNEMENT, beforeCharge + 2);
  const lightGain = state.player.attunement - beforeCharge;
  state.defenses = [];
  state.pulse = null;
  state.round++;
  state.phase = 'normal';
  checkClear(state);
  const responses = [parried.length ? `Parried ${parried.join(', ')}.` : '', deflected.length ? `Deflected ${deflected.join(', ')}.` : '', hitBy.length ? `Hit by ${hitBy.join(', ')}.` : ''].filter(Boolean);
  log(state, (responses.join(' ') || 'No enemy hits.') + (lightEarned ? ` Light +${lightGain} charge.` : ''));
  if (state.phase === 'normal') planEnemies(state);
}

function hitCore(state: GameState, enemy: Enemy): void {
  enemy.hp = Math.max(0, enemy.hp - 1);
  enemy.comboStep = 0;
  enemy.guard = enemy.maxGuard;
  enemy.breached = false;
  enemy.stun = 0;
  enemy.intent = null;
  enemy.opening = false;
  enemy.removed = true;
  log(state, `Enemy ${enemy.id} loses 1 life${enemy.hp > 0 ? ' and leaves until the attack turn ends' : ' and is removed'}.`);
}

export function execute(state: GameState, command: Command): GameState {
  if (command.type === 'beginAttack') {
    if (!canBeginAttack(state)) return state;
    const next = structuredClone(state);
    next.phase = 'attack';
    next.charge = Math.min(MAX_ATTUNEMENT, Math.max(0, Math.floor(next.player.attunement)));
    next.player.attunement = 0;
    next.pulse = pulse(next, true);
    log(next, `Attack turn: ${next.charge} charge. Pulse hit ${next.pulse.hitIds.length}, breached ${next.pulse.breachedIds.length}.`);
    return next;
  }
  if (command.type === 'endAttack') {
    if (state.phase !== 'attack') return state;
    const next = structuredClone(state);
    endAttack(next);
    return next;
  }
  if (command.type === 'nextRoom') {
    if (state.phase !== 'cleared' || state.room >= TOTAL_ROOMS) return state;
    const next = structuredClone(state);
    next.room++;
    next.player.hp = Math.min(PLAYER_MAX_HP, next.player.hp + 3);
    populateRoom(next);
    return next;
  }
  if (command.type !== 'act' || !availableAbilities(state).includes(command.ability)) return state;
  const { ability, target } = command;
  if (!target || !Number.isInteger(target.x) || !Number.isInteger(target.y) || !validTargets(state, ability).some(point => same(point, target))) return state;
  const next = structuredClone(state);
  const direction = directionTo(next.player, target);
  let lightHitIds: ReadonlySet<number> | undefined;
  if (ability === 'dash' || ability === 'dashAttack') {
    next.player.x = target.x;
    next.player.y = target.y;
    if (ability === 'dashAttack') {
      next.charge -= COSTS.dashAttack ?? 1;
      const tiles = attackArc(next, next.player, direction);
      for (const enemy of next.enemies.filter(active)) {
        if (!tiles.some(point => same(point, enemy))) continue;
        // Resolve exactly one layer: armor breached by this hit never spills into life.
        if (enemy.breached) hitCore(next, enemy);
        else damageGuard(next, enemy, GUARD.dashAttack);
      }
      log(next, `Dash Attack to ${target.x + 1},${target.y + 1}: ${GUARD.dashAttack} Guard or 1 life to already-breached targets.`);
    } else {
      log(next, `Dash to ${target.x + 1},${target.y + 1}.`);
    }
  } else if (ability === 'deflect') {
    next.player.attunement -= COSTS.deflect ?? 1;
    next.defenses.push({ kind: 'deflect', direction });
    log(next, 'Deflect: 1 charge spent; five directions protected, including Heavy.');
  } else {
    const tiles = attackArc(next, next.player, direction);
    const hits = next.enemies.filter(enemy => active(enemy) && tiles.some(point => same(point, enemy)));
    const centerEnemy = hits.find(enemy => same(enemy, target));
    for (const enemy of hits) damageGuard(next, enemy, same(enemy, target) ? GUARD.lightCenter : GUARD.lightSide);
    lightHitIds = new Set(hits.map(enemy => enemy.id));
    next.defenses.push({ kind: 'light', direction, ...(centerEnemy ? { parryEnemyId: centerEnemy.id } : {}) });
    log(next, `Light Attack: ${GUARD.lightCenter} center / ${GUARD.lightSide} side Guard.`);
  }
  if (state.phase === 'normal') resolveEnemies(next, lightHitIds);
  else checkClear(next);
  return next;
}

import { Ability, Command, COSTS, DIRS, Direction, Enemy, EnemyKind, ENEMY_DAMAGE, GameState, GUARD, MAX_ATTUNEMENT, PLAYER_MAX_HP, Point, SIZE, STATE_VERSION, THRESHOLD, TOTAL_ROOMS } from './model';
import { arc, clearPath, directionTo, distance, inside, pulse, same } from './geometry';

const kinds: EnemyKind[] = ['lunge', 'sweep', 'heavy'];
const attributes = {
  lunge: { guard: GUARD.lunge, hp: 1, reach: 3 },
  sweep: { guard: GUARD.sweep, hp: 2, reach: 2 },
  heavy: { guard: GUARD.heavy, hp: 3, reach: 2 },
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
  state.player.y = SIZE - 2;
  state.walls = [];
  state.enemies = [];
  state.round = 1;
  state.phase = 'normal';
  state.defenses = [];
  state.pulse = null;
  state.charge = 0;
  const candidates = shuffle(state, allTiles().filter(point => point.x > 0 && point.x < SIZE - 1 && point.y > 0 && point.y < SIZE - 1 && distance(point, state.player) > 2));
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
    player: { x: Math.floor(SIZE / 2), y: SIZE - 2, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, attunement: 0 },
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

function attackTiles(state: GameState, enemy: Enemy, destination: Point, direction: Direction): Point[] {
  const forward = DIRS[direction];
  if (enemy.kind === 'lunge') {
    return [1, 2].map(step => ({ x: destination.x + forward.x * step, y: destination.y + forward.y * step })).filter(point => wallClearLine(state, destination, point));
  }
  const near = arc(destination, direction).filter(point => wallClearLine(state, destination, point));
  if (enemy.kind === 'sweep') return near;
  const far = [-1, 0, 1].map(offset => {
    const edge = DIRS[(direction + offset + 8) % 8];
    return { x: destination.x + forward.x + edge.x, y: destination.y + forward.y + edge.y };
  }).filter(point => wallClearLine(state, destination, point));
  const unique = new Map<string, Point>();
  for (const point of [...near, ...far]) unique.set(`${point.x},${point.y}`, point);
  return [...unique.values()];
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
  const queue = allTiles().filter(point => walkable(point) && attackTiles(state, enemy, point, directionTo(point, state.player)).some(tile => same(tile, state.player)));
  const routes = new Map(queue.map(point => [`${point.x},${point.y}`, 0]));
  // Reverse breadth-first search finds the number of legal moves to an actual firing position.
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    const nextDistance = routes.get(`${point.x},${point.y}`)! + 1;
    for (const direction of DIRS) for (let step = 1; step <= reach; step++) {
      const candidate = { x: point.x + direction.x * step, y: point.y + direction.y * step };
      const key = `${candidate.x},${candidate.y}`;
      if (routes.has(key) || !walkable(candidate)) continue;
      if (enemy.kind !== 'heavy' && !groundRouteClear(state, point, candidate, enemy.id, reserved)) continue;
      routes.set(key, nextDistance);
      queue.push(candidate);
    }
  }
  return routes;
}

export function planEnemies(state: GameState, onlyIds?: ReadonlySet<number>): void {
  if (state.phase === 'attack') return;
  const reserved = new Set(state.enemies.filter(enemy => active(enemy) && enemy.intent && onlyIds && !onlyIds.has(enemy.id)).map(enemy => `${enemy.intent!.destination.x},${enemy.intent!.destination.y}`));
  for (const enemy of state.enemies) {
    if (onlyIds && !onlyIds.has(enemy.id)) continue;
    if (!active(enemy) || enemy.breached || enemy.stun > 0) {
      enemy.intent = null;
      enemy.opening = false;
      continue;
    }
    const movement = enemy.kind === 'heavy' ? 'jump' : 'dash';
    const reach = attributes[enemy.kind].reach;
    enemy.opening = enemy.kind === 'sweep' ? enemy.cycle % 4 === 2 : enemy.cycle % 3 === (enemy.kind === 'heavy' ? 1 : 2);
    const destinations = allTiles().filter(point => !same(point, state.player) && empty(state, point) && queenLine(enemy, point) && distance(enemy, point) <= reach && !reserved.has(`${point.x},${point.y}`) && (movement === 'jump' || groundRouteClear(state, enemy, point, enemy.id, reserved)));
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
      const label = attack.moving ? `${movement === 'jump' ? 'Jump' : 'Dash'} ${enemy.kind}` : enemy.kind === 'lunge' ? 'Lunge' : enemy.kind === 'sweep' ? 'Sweep' : 'Heavy';
      enemy.intent = { destination: { ...attack.point }, tiles: attack.tiles, direction: attack.direction, movement: motion, kind: 'attack', heavy: enemy.kind === 'heavy', label: `${label} · ${ENEMY_DAMAGE} damage` };
      reserved.add(`${attack.point.x},${attack.point.y}`);
      continue;
    }
    const routes = approachDistances(state, enemy, reserved);
    const originRoute = routes.get(`${enemy.x},${enemy.y}`);
    const route = (point: Point) => routes.get(`${point.x},${point.y}`) ?? Infinity;
    const approaches = destinations.filter(point => originRoute === undefined ? distance(point, state.player) < distance(enemy, state.player) : route(point) < originRoute).sort((a, b) => route(a) - route(b) || distance(a, state.player) - distance(b, state.player) || distance(enemy, b) - distance(enemy, a) || a.y - b.y || a.x - b.x);
    const approach = approaches[0];
    if (approach) {
      enemy.intent = { destination: { ...approach }, tiles: [], direction: directionTo(enemy, approach), movement, kind: 'move', heavy: enemy.kind === 'heavy', label: `${movement === 'jump' ? 'Jump' : 'Dash'} approach` };
      reserved.add(`${approach.x},${approach.y}`);
    } else {
      enemy.intent = null;
    }
  }
}

function resolveEnemies(state: GameState): void {
  const recovering = new Set(state.enemies.filter(enemy => active(enemy) && (enemy.breached || enemy.stun > 0)).map(enemy => enemy.id));
  let hits = 0;
  let counters = 0;
  for (const enemy of state.enemies) {
    if (!active(enemy) || recovering.has(enemy.id) || !enemy.intent) continue;
    const intent = enemy.intent;
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
    const approach = directionTo(state.player, enemy);
    const countered = state.defenses.some(defense => {
      const offset = (approach - defense.direction + 8) % 8;
      return defense.kind === 'deflect' ? offset <= 2 || offset >= 6 : !intent.heavy && offset === 0;
    });
    if (countered) {
      counters++;
    } else {
      state.player.hp = Math.max(0, state.player.hp - ENEMY_DAMAGE);
      hits++;
    }
  }
  for (const enemy of state.enemies.filter(active)) {
    enemy.cycle++;
    if (recovering.has(enemy.id)) {
      enemy.stun = Math.max(0, enemy.stun - 1);
      if (enemy.stun === 0) {
        enemy.guard = enemy.maxGuard;
        enemy.breached = false;
      }
    } else if (!enemy.breached) {
      enemy.guard = Math.min(enemy.maxGuard, enemy.guard + GUARD.regen);
    }
    enemy.intent = null;
  }
  state.defenses = [];
  state.pulse = null;
  state.round++;
  state.phase = 'normal';
  log(state, `Enemies resolved. ${hits} hit${hits === 1 ? '' : 's'}, ${counters} block${counters === 1 ? '' : 's'}.`);
  checkClear(state);
  if (state.phase === 'normal') planEnemies(state);
}

function hitCore(state: GameState, enemy: Enemy): void {
  enemy.hp = Math.max(0, enemy.hp - 1);
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
    for (const enemy of hits) damageGuard(next, enemy, same(enemy, target) ? GUARD.lightCenter : GUARD.lightSide);
    const before = next.player.attunement;
    if (hits.length > 0) next.player.attunement = Math.min(MAX_ATTUNEMENT, before + 2);
    next.defenses.push({ kind: 'light', direction });
    log(next, `Light Attack: ${GUARD.lightCenter} center / ${GUARD.lightSide} side Guard; +${next.player.attunement - before} charge.`);
  }
  if (state.phase === 'normal') resolveEnemies(next);
  else checkClear(next);
  return next;
}

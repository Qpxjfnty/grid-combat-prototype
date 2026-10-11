import { Ability, Command, COSTS, DIRS, Direction, Enemy, EnemyKind, GameState, GUARD, MAX_ATTUNEMENT, Point, SIZE, SLOTS, STATE_VERSION, THRESHOLD, TOTAL_ROOMS } from './model';
import { arc, clearPath, directionTo, distance, inside, pulse, same } from './geometry';

const kinds: EnemyKind[] = ['lunge', 'sweep', 'heavy'];
const attributes = {
  lunge: { guard: GUARD.lunge, hp: 2, reach: 3 },
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
  state.player.x = 4;
  state.player.y = 7;
  state.walls = [];
  state.enemies = [];
  state.round = 1;
  state.slot = 0;
  state.phase = 'normal';
  state.resumePhase = 'normal';
  state.defenses = [];
  state.pulse = null;
  state.charge = 0;
  const candidates = shuffle(state, allTiles().filter(point => point.x > 0 && point.x < SIZE - 1 && point.y > 0 && point.y < SIZE - 1 && distance(point, state.player) > 2));
  const desiredWalls = 6 + state.room;
  for (const candidate of candidates) {
    if (state.walls.length >= desiredWalls) break;
    const next = [...state.walls, candidate];
    if (connected(next)) state.walls = next;
  }
  const count = 3 + Math.floor((state.room - 1) / 2);
  const locations = shuffle(state, allTiles().filter(point => !isWall(state, point) && distance(point, state.player) >= 4));
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
  log(state, `Arena ${state.room}/${TOTAL_ROOMS}. Enemies resolve after all three actions.`);
}

export function createGame(seed: number = Date.now()): GameState {
  const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1;
  const state: GameState = {
    version: STATE_VERSION,
    seed: normalizedSeed,
    rng: normalizedSeed,
    room: 1,
    round: 1,
    slot: 0,
    phase: 'normal',
    resumePhase: 'normal',
    player: { x: 4, y: 7, hp: 12, maxHp: 12, attunement: 0 },
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
  if (state.phase === 'normal' && state.slot < 3) return [...SLOTS[state.slot]];
  if (state.phase === 'attack') return (['shift', 'break', 'core', 'core2'] as Ability[]).filter(ability => state.charge >= (COSTS[ability] ?? Infinity));
  return [];
}

function attackArc(state: GameState, origin: Point, direction: Direction): Point[] {
  return arc(origin, direction).filter(point => !isWall(state, point));
}

export function validTargets(state: GameState, ability: Ability): Point[] {
  if (!availableAbilities(state).includes(ability)) return [];
  if (ability === 'focus') return [];
  if (ability === 'quickstep' || ability === 'dash' || ability === 'shift') {
    return allTiles().filter(point => !same(point, state.player) && empty(state, point) && (ability === 'quickstep' ? distance(point, state.player) === 1 : clearPath(state, state.player, point)));
  }
  if (ability === 'core' || ability === 'core2') {
    return state.enemies.filter(enemy => active(enemy) && enemy.breached && distance(enemy, state.player) === 1).map(enemy => ({ x: enemy.x, y: enemy.y }));
  }
  return DIRS.map(direction => ({ x: state.player.x + direction.x, y: state.player.y + direction.y })).filter(inside);
}

export function previewAction(state: GameState, ability: Ability, target: Point): Point[] {
  if (!validTargets(state, ability).some(point => same(point, target))) return [];
  if (ability === 'deflect' || ability === 'strike' || ability === 'break') return attackArc(state, state.player, directionTo(state.player, target));
  return [{ x: target.x, y: target.y }];
}

export function canBeginAttack(state: GameState): boolean {
  return (state.phase === 'normal' || state.phase === 'resolve') && state.player.attunement >= THRESHOLD;
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
  state.phase = state.resumePhase;
  log(state, `Attack turn ended.${discarded ? ` ${discarded} unused charge lost.` : ''}`);
  checkClear(state);
}

function wallClearLine(state: GameState, from: Point, to: Point): boolean {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const length = distance(from, to);
  if (to.x !== from.x && to.y !== from.y && Math.abs(to.x - from.x) !== Math.abs(to.y - from.y)) return false;
  let previous = from;
  for (let step = 1; step <= length; step++) {
    const point = { x: from.x + dx * step, y: from.y + dy * step };
    if (!inside(point) || isWall(state, point)) return false;
    if (dx && dy && (isWall(state, { x: previous.x + dx, y: previous.y }) || isWall(state, { x: previous.x, y: previous.y + dy }))) return false;
    previous = point;
  }
  return true;
}

function attackTiles(state: GameState, enemy: Enemy, destination: Point): Point[] {
  const direction = directionTo(destination, state.player);
  const forward = DIRS[direction];
  if (enemy.kind === 'lunge') {
    return [1, 2].map(step => ({ x: destination.x + forward.x * step, y: destination.y + forward.y * step })).filter(point => wallClearLine(state, destination, point));
  }
  const near = attackArc(state, destination, direction);
  if (enemy.kind === 'sweep') return near;
  const far = [-1, 0, 1].map(offset => {
    const edge = DIRS[(direction + offset + 8) % 8];
    return { x: destination.x + forward.x + edge.x, y: destination.y + forward.y + edge.y };
  }).filter(point => inside(point) && !isWall(state, point) && !isWall(state, { x: destination.x + forward.x, y: destination.y + forward.y }));
  const unique = new Map<string, Point>();
  for (const point of [...near, ...far]) unique.set(`${point.x},${point.y}`, point);
  return [...unique.values()];
}

export function planEnemies(state: GameState): void {
  if (state.phase === 'attack') return;
  const reserved = new Set<string>();
  for (const enemy of state.enemies) {
    if (!active(enemy) || enemy.breached || enemy.stun > 0) {
      enemy.intent = null;
      enemy.opening = false;
      continue;
    }
    const stats = attributes[enemy.kind];
    enemy.opening = enemy.kind === 'sweep' ? enemy.cycle % 4 === 2 : enemy.cycle % 3 === (enemy.kind === 'heavy' ? 1 : 2);
    const options = [{ x: enemy.x, y: enemy.y }, ...allTiles().filter(point => !same(point, enemy) && !same(point, state.player) && empty(state, point) && distance(enemy, point) <= stats.reach && clearPath(state, enemy, point, enemy.id) && !crossesPlayer(state, enemy, point))];
    const scored = options.filter(point => !reserved.has(`${point.x},${point.y}`)).map(point => {
      const tiles = attackTiles(state, enemy, point);
      const hitsPlayer = tiles.some(tile => same(tile, state.player));
      // Prefer a legal gap-close that threatens the player, then the shortest route toward them.
      const score = (hitsPlayer ? 0 : 100) + distance(point, state.player) * 10 + distance(enemy, point) * 0.1;
      return { point, tiles, score };
    }).sort((a, b) => a.score - b.score || a.point.y - b.point.y || a.point.x - b.point.x);
    const chosen = scored[0];
    if (!chosen) {
      enemy.intent = null;
      continue;
    }
    reserved.add(`${chosen.point.x},${chosen.point.y}`);
    enemy.intent = {
      destination: { ...chosen.point },
      tiles: chosen.tiles,
      heavy: enemy.kind === 'heavy',
      label: enemy.kind === 'lunge' ? 'Lunge · 1 damage' : enemy.kind === 'sweep' ? 'Sweep · 1 damage' : 'Heavy · 2 damage',
    };
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
      if (crossesPlayer(state, enemy, intent.destination) || !clearPath(state, enemy, intent.destination, enemy.id)) {
        enemy.intent = null;
        continue;
      }
      enemy.x = intent.destination.x;
      enemy.y = intent.destination.y;
    }
    if (!intent.tiles.some(point => same(point, state.player))) continue;
    const approach = directionTo(state.player, enemy);
    const countered = state.defenses.some(defense => {
      const offset = (approach - defense.direction + 8) % 8;
      return defense.kind === 'deflect' ? offset === 0 || offset === 1 || offset === 7 : !intent.heavy && offset === 0;
    });
    if (countered) {
      counters++;
      damageGuard(state, enemy, GUARD.counter);
    } else {
      state.player.hp = Math.max(0, state.player.hp - (intent.heavy ? 2 : 1));
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
  state.slot = 0;
  state.round++;
  state.phase = 'normal';
  log(state, `Enemies resolved. ${hits} hit${hits === 1 ? '' : 's'}, ${counters} counter${counters === 1 ? '' : 's'}.`);
  checkClear(state);
  if (state.phase === 'normal') planEnemies(state);
}

export function execute(state: GameState, command: Command): GameState {
  if (command.type === 'skipStep') {
    if (state.phase !== 'normal' || state.slot !== 0 || validTargets(state, 'quickstep').length > 0) return state;
    const next = structuredClone(state);
    next.slot = 1;
    log(next, 'Quickstep blocked; step skipped.');
    return next;
  }
  if (command.type === 'beginAttack') {
    if (!canBeginAttack(state)) return state;
    const next = structuredClone(state);
    next.resumePhase = state.phase as 'normal' | 'resolve';
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
  if (command.type === 'resolve') {
    if (state.phase !== 'resolve' || state.slot !== 3) return state;
    const next = structuredClone(state);
    resolveEnemies(next);
    return next;
  }
  if (command.type === 'nextRoom') {
    if (state.phase !== 'cleared' || state.room >= TOTAL_ROOMS) return state;
    const next = structuredClone(state);
    next.room++;
    next.player.hp = Math.min(next.player.maxHp, next.player.hp + 3);
    populateRoom(next);
    return next;
  }
  if (!availableAbilities(state).includes(command.ability)) return state;
  const { ability, target } = command;
  if (ability !== 'focus' && (!target || !Number.isInteger(target.x) || !Number.isInteger(target.y) || !validTargets(state, ability).some(point => same(point, target)))) return state;
  const next = structuredClone(state);
  if (ability === 'focus') {
    const before = next.player.attunement;
    next.player.attunement = Math.min(MAX_ATTUNEMENT, before + 1);
    log(next, `Focus: +${Math.max(0, next.player.attunement - before)} attunement.`);
  } else if (ability === 'quickstep' || ability === 'dash' || ability === 'shift') {
    next.player.x = target!.x;
    next.player.y = target!.y;
    log(next, `${ability === 'quickstep' ? 'Quickstep' : ability === 'dash' ? 'Dash' : 'Shift'} to ${target!.x + 1},${target!.y + 1}.`);
  } else if (ability === 'deflect') {
    next.defenses.push({ kind: 'deflect', direction: directionTo(next.player, target!) });
    log(next, 'Deflect set: three directions, including Heavy.');
  } else if (ability === 'strike' || ability === 'break') {
    const direction = directionTo(next.player, target!);
    const tiles = attackArc(next, next.player, direction);
    for (const enemy of next.enemies) {
      if (tiles.some(point => same(point, enemy))) damageGuard(next, enemy, ability === 'strike' ? GUARD.strike : GUARD.break);
    }
    if (ability === 'strike') next.defenses.push({ kind: 'strike', direction });
    log(next, ability === 'strike' ? `Strike: ${GUARD.strike} Guard in arc; center direction counters normal attacks.` : `Break: ${GUARD.break} Guard in arc.`);
  } else {
    const enemy = occupant(next, target!)!;
    const damage = ability === 'core2' ? 2 : 1;
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.guard = enemy.maxGuard;
    enemy.breached = false;
    enemy.stun = 0;
    enemy.intent = null;
    enemy.opening = false;
    enemy.removed = true;
    log(next, `Core: enemy ${enemy.id} loses ${damage} life${enemy.hp > 0 ? ' and leaves until attack turn ends' : ' and is removed'}.`);
  }
  if (state.phase === 'attack') {
    next.charge -= COSTS[ability] ?? 0;
  } else {
    next.slot = (next.slot + 1) as GameState['slot'];
    if (next.slot === 3) next.phase = 'resolve';
  }
  checkClear(next);
  return next;
}

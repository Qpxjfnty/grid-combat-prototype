import { DIRS, GUARD, SIZE, type Direction, type GameState, type Point, type PulseResult } from './model';

export const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const inside = (p: Point) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < SIZE && p.y < SIZE;
export const distance = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export function directionTo(a: Point, b: Point): Direction {
  const angle = Math.atan2(b.x - a.x, a.y - b.y);
  return ((Math.round(angle / (Math.PI / 4)) + 8) % 8) as Direction;
}
export function arc(origin: Point, direction: Direction, width: 3 | 5 = 3): Point[] {
  return (width === 5 ? [-2, -1, 0, 1, 2] : [-1, 0, 1]).map(offset => DIRS[(direction + offset + 8) % 8]).map(d => ({ x: origin.x + d.x, y: origin.y + d.y })).filter(inside);
}
export function clearPath(state: GameState, from: Point, to: Point, ignoreEnemyId?: number): boolean {
  if (!inside(from) || !inside(to) || same(from, to)) return false;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return false;
  const blocked = (p: Point) => !inside(p) || state.walls.some(w => same(w, p)) || state.enemies.some(e => e.id !== ignoreEnemyId && e.hp > 0 && !e.removed && same(e, p));
  const sx = Math.sign(dx), sy = Math.sign(dy);
  let p = { ...from };
  for (let i = 0; i < Math.max(Math.abs(dx), Math.abs(dy)); i++) {
    const q = { x: p.x + sx, y: p.y + sy };
    // A queen-line move traverses these tiles only; neighboring flank squares are not on its path.
    if (blocked(q)) return false;
    p = q;
  }
  return true;
}

// Intersect an angular sector's representative direction with a square tile.
// Sectors split at EVERY tile corner, so their interior has constant tile order.
// This is a continuous silhouette sweep, not a sampled ray fan or eight-way LOS.
function entryDistance(origin: Point, p: Point, dx: number, dy: number): number | null {
  let near = 0, far = Infinity;
  for (const [offset, delta] of [[p.x - origin.x, dx], [p.y - origin.y, dy]]) {
    if (Math.abs(delta) < 1e-12) {
      if (offset - 0.5 > 0 || offset + 0.5 < 0) return null;
    } else {
      const a = (offset - 0.5) / delta, b = (offset + 0.5) / delta;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
    }
  }
  return far > near + 1e-10 ? near : null;
}

export function pulse(state: GameState, apply = false): PulseResult {
  const enemies = apply ? state.enemies : state.enemies.map(e => ({ ...e }));
  const tau = Math.PI * 2;
  const all: Point[] = [];
  const boundaries = [0, tau];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const p = { x, y }; all.push(p);
    for (const ox of [-0.5, 0.5]) for (const oy of [-0.5, 0.5]) {
      boundaries.push((Math.atan2(y + oy - state.player.y, x + ox - state.player.x) + tau) % tau);
    }
  }
  boundaries.sort((a, b) => a - b);
  const angles = boundaries.filter((a, i) => i === 0 || a - boundaries[i - 1] > 1e-10);
  const events: { sector: number; tile: number; entry: number }[] = [];
  for (let sector = 0; sector < angles.length - 1; sector++) {
    const angle = (angles[sector] + angles[sector + 1]) / 2;
    for (let tile = 0; tile < all.length; tile++) {
      if (same(all[tile], state.player)) continue;
      const entry = entryDistance(state.player, all[tile], Math.cos(angle), Math.sin(angle));
      if (entry !== null) events.push({ sector, tile, entry });
    }
  }
  // Globally advance the circular front, so a foreground breach propagates.
  events.sort((a, b) => a.entry - b.entry || a.tile - b.tile);
  const blocked = new Set<number>(), visible = new Set<number>();
  visible.add(state.player.y * SIZE + state.player.x);
  const hitIds: number[] = [], breachedIds: number[] = [];
  const hit = new Set<number>();
  const walls = new Set(state.walls.map(w => w.y * SIZE + w.x));
  const occupants = new Map(enemies.filter(e => e.hp > 0 && !e.removed).map(e => [e.y * SIZE + e.x, e]));
  for (const event of events) {
    if (blocked.has(event.sector)) continue;
    visible.add(event.tile);
    if (walls.has(event.tile)) { blocked.add(event.sector); continue; }
    const enemy = occupants.get(event.tile);
    if (!enemy || enemy.breached) continue;
    if (!hit.has(enemy.id)) {
      hit.add(enemy.id); hitIds.push(enemy.id);
      enemy.guard = enemy.opening ? 0 : Math.max(0, enemy.guard - GUARD.pulse);
      if (enemy.guard === 0) {
        enemy.breached = true; enemy.stun = 1; enemy.intent = null; enemy.opening = false;
        breachedIds.push(enemy.id);
      }
    }
    if (!enemy.breached) blocked.add(event.sector);
  }
  return { hitIds, breachedIds, visibleTiles: all.filter((_, i) => visible.has(i)), shadowTiles: all.filter((_, i) => !visible.has(i)) };
}

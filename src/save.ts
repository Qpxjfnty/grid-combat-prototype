import { MAX_ATTUNEMENT, SIZE, STATE_VERSION, TOTAL_ROOMS, type GameState, type Point } from './model';

export type SaveRecord = { schema: 1; token: string; state: GameState };
const isPoint = (v: unknown): v is Point => !!v && typeof v === 'object' && Number.isInteger((v as Point).x) && Number.isInteger((v as Point).y) && (v as Point).x >= 0 && (v as Point).x < SIZE && (v as Point).y >= 0 && (v as Point).y < SIZE;
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
const bounded = (v: number, max: number) => integer(v) && v >= 0 && v <= max;

function validSave(v: unknown): v is GameState {
  if (!v || typeof v !== 'object') return false;
  const s = v as GameState;
  return s.version === STATE_VERSION && integer(s.seed) && integer(s.rng) && Number.isInteger(s.room) && s.room >= 1 && s.room <= TOTAL_ROOMS && Number.isInteger(s.round) && s.round >= 1
    && ['normal', 'attack', 'cleared', 'won', 'lost'].includes(s.phase)
    && isPoint(s.player) && bounded(s.player.hp, s.player.maxHp) && integer(s.player.maxHp) && s.player.maxHp > 0 && s.player.maxHp <= 100 && bounded(s.player.attunement, MAX_ATTUNEMENT) && bounded(s.charge, MAX_ATTUNEMENT)
    && Array.isArray(s.walls) && s.walls.length <= SIZE * SIZE && s.walls.every(isPoint)
    && Array.isArray(s.enemies) && s.enemies.length <= 50 && s.enemies.every(e => isPoint(e) && Number.isInteger(e.id) && ['lunge', 'sweep', 'heavy'].includes(e.kind) && [e.hp, e.maxHp, e.guard, e.maxGuard, e.stun, e.cycle].every(integer) && bounded(e.hp, e.maxHp) && e.maxHp > 0 && e.maxHp <= 100 && bounded(e.guard, e.maxGuard) && e.maxGuard > 0 && e.maxGuard <= 10000 && [e.breached, e.removed, e.opening].every(x => typeof x === 'boolean') && (e.intent === null || (isPoint(e.intent?.destination) && Array.isArray(e.intent.tiles) && e.intent.tiles.every(isPoint) && typeof e.intent.heavy === 'boolean' && typeof e.intent.label === 'string')))
    && Array.isArray(s.defenses) && s.defenses.every(d => ['light', 'deflect'].includes(d.kind) && Number.isInteger(d.direction) && d.direction >= 0 && d.direction < 8)
    && Array.isArray(s.log) && s.log.every(l => typeof l === 'string')
    && (s.pulse === null || (Array.isArray(s.pulse?.hitIds) && s.pulse.hitIds.every(integer) && Array.isArray(s.pulse.breachedIds) && s.pulse.breachedIds.every(integer) && Array.isArray(s.pulse.visibleTiles) && s.pulse.visibleTiles.every(isPoint) && Array.isArray(s.pulse.shadowTiles) && s.pulse.shadowTiles.every(isPoint)));
}

export function parseSaveRecord(raw: string | null): SaveRecord | null {
  try {
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record?.schema !== 1 || typeof record.token !== 'string' || !record.state) return null;
    // Older 9×9 saves remain untouched in their separate localStorage keys.
    return validSave(record.state) ? record as SaveRecord : null;
  } catch { return null; }
}

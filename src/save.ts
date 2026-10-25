import { MAX_ATTUNEMENT, PLAYER_MAX_HP, SIZE, STATE_VERSION, TOTAL_ROOMS, type Enemy, type GameState, type Intent, type Point } from './model';
import { planEnemies } from './engine';

export type SaveRecord = { schema: 1; token: string; state: GameState };
type LegacyIntent = Omit<Intent, 'movement' | 'kind' | 'direction'>;
type CompatibleState = Omit<GameState, 'version' | 'enemies'> & { version: 3 | 4 | typeof STATE_VERSION; enemies: (Omit<Enemy, 'intent'> & { intent: Intent | LegacyIntent | null })[] };
const isPoint = (v: unknown): v is Point => !!v && typeof v === 'object' && Number.isInteger((v as Point).x) && Number.isInteger((v as Point).y) && (v as Point).x >= 0 && (v as Point).x < SIZE && (v as Point).y >= 0 && (v as Point).y < SIZE;
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
const bounded = (v: number, max: number) => integer(v) && v >= 0 && v <= max;

function validIntent(intent: CompatibleState['enemies'][number]['intent'], current: boolean): boolean {
  if (intent === null) return true;
  if (!intent || !isPoint(intent.destination) || !Array.isArray(intent.tiles) || !intent.tiles.every(isPoint) || typeof intent.heavy !== 'boolean' || typeof intent.label !== 'string') return false;
  if (!current) return true;
  const i = intent as Intent;
  return ['none', 'dash', 'jump'].includes(i.movement) && bounded(i.direction, 7)
    && (i.kind === 'attack' ? i.tiles.length > 0 : i.kind === 'move' && i.tiles.length === 0 && i.movement !== 'none');
}

function validSave(v: unknown): v is CompatibleState {
  if (!v || typeof v !== 'object') return false;
  const s = v as CompatibleState;
  return (s.version === 3 || s.version === 4 || s.version === STATE_VERSION) && integer(s.seed) && integer(s.rng) && Number.isInteger(s.room) && s.room >= 1 && s.room <= TOTAL_ROOMS && Number.isInteger(s.round) && s.round >= 1
    && ['normal', 'attack', 'cleared', 'won', 'lost'].includes(s.phase)
    && isPoint(s.player) && bounded(s.player.hp, s.player.maxHp) && integer(s.player.maxHp) && s.player.maxHp > 0 && s.player.maxHp <= 100 && (s.version === 3 || s.player.maxHp === PLAYER_MAX_HP) && bounded(s.player.attunement, MAX_ATTUNEMENT) && bounded(s.charge, MAX_ATTUNEMENT)
    && Array.isArray(s.walls) && s.walls.length <= SIZE * SIZE && s.walls.every(isPoint)
    && Array.isArray(s.enemies) && s.enemies.length <= 50 && s.enemies.every(e => isPoint(e) && Number.isInteger(e.id) && ['lunge', 'sweep', 'heavy'].includes(e.kind) && [e.hp, e.maxHp, e.guard, e.maxGuard, e.stun, e.cycle].every(integer) && bounded(e.hp, e.maxHp) && e.maxHp > 0 && e.maxHp <= 100 && bounded(e.guard, e.maxGuard) && e.maxGuard > 0 && e.maxGuard <= 10000 && [e.breached, e.removed, e.opening].every(x => typeof x === 'boolean') && validIntent(e.intent, s.version === STATE_VERSION))
    && Array.isArray(s.defenses) && s.defenses.every(d => ['light', 'deflect'].includes(d.kind) && Number.isInteger(d.direction) && d.direction >= 0 && d.direction < 8)
    && Array.isArray(s.log) && s.log.every(l => typeof l === 'string')
    && (s.pulse === null || (Array.isArray(s.pulse?.hitIds) && s.pulse.hitIds.every(integer) && Array.isArray(s.pulse.breachedIds) && s.pulse.breachedIds.every(integer) && Array.isArray(s.pulse.visibleTiles) && s.pulse.visibleTiles.every(isPoint) && Array.isArray(s.pulse.shadowTiles) && s.pulse.shadowTiles.every(isPoint)));
}

export function parseSaveRecord(raw: string | null): SaveRecord | null {
  try {
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record?.schema !== 1 || typeof record.token !== 'string' || !record.state) return null;
    // Validate the original health before clamping so invalid legacy data cannot become a valid run.
    if (!validSave(record.state)) return null;
    const source: CompatibleState = record.state;
    if (source.version === STATE_VERSION) return record as SaveRecord;
    const migrated: GameState = {
      ...source,
      version: STATE_VERSION,
      player: { ...source.player, hp: Math.min(source.player.hp, PLAYER_MAX_HP), maxHp: PLAYER_MAX_HP },
      enemies: source.enemies.map(enemy => ({ ...enemy, intent: null })),
    };
    // Refresh old turning attacks once, without restoring canceled intentions or advancing time.
    const plannedIds = new Set(source.enemies.filter(enemy => enemy.intent !== null).map(enemy => enemy.id));
    migrated.phase = 'normal';
    planEnemies(migrated, plannedIds);
    migrated.phase = source.phase;
    return { schema: 1, token: record.token, state: migrated };
  } catch { return null; }
}

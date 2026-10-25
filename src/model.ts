export interface Point { x: number; y: number }
export type Direction = 0|1|2|3|4|5|6|7;
export type Ability = 'dash'|'light'|'deflect'|'dashAttack';
export type EnemyKind = 'lunge'|'sweep'|'heavy';
export interface Intent { destination: Point; tiles: Point[]; heavy: boolean; label: string; movement: 'none'|'dash'|'jump'; kind: 'attack'|'move'; direction: Direction; }
export interface Enemy extends Point { id: number; kind: EnemyKind; hp: number; maxHp: number; guard: number; maxGuard: number; breached: boolean; stun: number; removed: boolean; opening: boolean; cycle: number; intent: Intent | null; }
export interface Defense { kind: 'light'|'deflect'; direction: Direction; }
export interface PulseResult { hitIds: number[]; breachedIds: number[]; visibleTiles: Point[]; shadowTiles: Point[]; }
export interface GameState {
  version: typeof STATE_VERSION; seed: number; rng: number; room: number; round: number;
  phase: 'normal'|'attack'|'cleared'|'won'|'lost';
  player: Point & { hp: number; maxHp: number; attunement: number };
  charge: number; walls: Point[]; enemies: Enemy[]; defenses: Defense[];
  log: string[]; pulse: PulseResult | null; selectedSeed?: string;
}
export type Command = { type: 'act'; ability: Ability; target?: Point } | { type: 'beginAttack' } | { type: 'endAttack' } | { type: 'nextRoom' };
export const SIZE = 7;
export const STATE_VERSION = 5;
export const PLAYER_MAX_HP = 3;
export const ENEMY_DAMAGE = 1;
export const THRESHOLD = 3;
export const MAX_ATTUNEMENT = 10;
export const GUARD = { lunge: 5, sweep: 15, heavy: 20, lightCenter: 2, lightSide: 1, pulse: 5, dashAttack: 5, regen: 10 } as const;
export const TOTAL_ROOMS = 5;
export const DIRS: Point[] = [{x:0,y:-1},{x:1,y:-1},{x:1,y:0},{x:1,y:1},{x:0,y:1},{x:-1,y:1},{x:-1,y:0},{x:-1,y:-1}];
export const COSTS: Partial<Record<Ability,number>> = { deflect: 1, dashAttack: 1 };

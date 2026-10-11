export interface Point { x: number; y: number }
export type Direction = 0|1|2|3|4|5|6|7;
export type Ability = 'quickstep'|'dash'|'deflect'|'strike'|'focus'|'shift'|'break'|'core'|'core2';
export type EnemyKind = 'lunge'|'sweep'|'heavy';
export interface Intent { destination: Point; tiles: Point[]; heavy: boolean; label: string; }
export interface Enemy extends Point { id: number; kind: EnemyKind; hp: number; maxHp: number; guard: number; maxGuard: number; breached: boolean; stun: number; removed: boolean; opening: boolean; cycle: number; intent: Intent | null; }
export interface Defense { kind: 'strike'|'deflect'; direction: Direction; }
export interface PulseResult { hitIds: number[]; breachedIds: number[]; visibleTiles: Point[]; shadowTiles: Point[]; }
export interface GameState {
  version: typeof STATE_VERSION; seed: number; rng: number; room: number; round: number; slot: 0|1|2|3;
  phase: 'normal'|'attack'|'resolve'|'cleared'|'won'|'lost';
  resumePhase: 'normal'|'resolve';
  player: Point & { hp: number; maxHp: number; attunement: number };
  charge: number; walls: Point[]; enemies: Enemy[]; defenses: Defense[];
  log: string[]; pulse: PulseResult | null; selectedSeed?: string;
}
export type Command = { type: 'act'; ability: Ability; target?: Point } | { type: 'beginAttack' } | { type: 'endAttack' } | { type: 'resolve' } | { type: 'nextRoom' } | { type: 'skipStep' };
export const SIZE = 9;
export const STATE_VERSION = 2;
export const THRESHOLD = 3;
export const MAX_ATTUNEMENT = 10;
export const GUARD = { lunge: 10, sweep: 15, heavy: 20, strike: 10, counter: 10, pulse: 5, break: 15, regen: 10 } as const;
export const TOTAL_ROOMS = 5;
export const DIRS: Point[] = [{x:0,y:-1},{x:1,y:-1},{x:1,y:0},{x:1,y:1},{x:0,y:1},{x:-1,y:1},{x:-1,y:0},{x:-1,y:-1}];
export const COSTS: Partial<Record<Ability,number>> = { shift: 1, break: 2, core: 1, core2: 3 };
export const SLOTS: Ability[][] = [['quickstep'],['dash','strike','focus'],['deflect','strike','focus']];

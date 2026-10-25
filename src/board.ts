import Phaser from 'phaser';
import type { Ability, Enemy, GameState, Point, PulseResult } from './model';
import { SIZE, DIRS } from './model';

export interface BoardFrame {
  state: GameState;
  ability: Ability | null;
  target: Point | null;
  cursor: Point | null;
  valid: Point[];
  preview: Point[];
  inspectId: number | null;
  inspectTile: Point | null;
  threatIds: number[];
  showThreats: boolean;
  pulsePreview: PulseResult | null;
}
const CELL = 58;
const PAD = 24;
const EDGE = CELL * SIZE + PAD * 2;
const C = { bg: 0x101419, tile: 0x1d232a, grid: 0x343c47, text: '#f2f5f7', muted: '#adb7c5', wall: 0x4b535d, player: 0x8ed9ff, danger: 0xef827e, heavy: 0xffad6c, opening: 0xff4ed8, breach: 0xffd975, freeze: 0xc79cab, hp: 0xf16c73, hpEmpty: 0x75343c };
const ACTION_COLORS: Record<string, number> = { dash: 0x91ad94, light: 0xc5baa0, deflect: 0x91b4cb, dashAttack: 0xd0b166 };
const PLAN_COLORS = [0x9ba8c5, 0xc3a0a6, 0x7eaaa6, 0xb6ab87, 0xa397bd];
const planColor = (enemy: Enemy) => PLAN_COLORS[((enemy.id % 10) + 4) % PLAN_COLORS.length];
const colorText = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const enemyLabel = (enemy: Enemy) => `${enemy.kind[0].toUpperCase()}${enemy.id}`;
const eq = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const coord = (p: Point) => ({ x: PAD + p.x * CELL + CELL / 2, y: PAD + p.y * CELL + CELL / 2 });

export function createBoard(host: HTMLElement, getFrame: () => BoardFrame, onTile: (p: Point) => void, onHover: (p: Point | null) => void) {
  let scene: CombatBoard | undefined;
  let ready = false;
  let pendingPulse: Point | null = null;
  class CombatBoard extends Phaser.Scene {
    layer!: Phaser.GameObjects.Graphics;
    texts: Phaser.GameObjects.Text[] = [];
    pulseEffect: Phaser.GameObjects.Graphics | null = null;
    create() {
      scene = this;
      this.layer = this.add.graphics();
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        const x = Math.floor((pointer.x - PAD) / CELL);
        const y = Math.floor((pointer.y - PAD) / CELL);
        if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) onTile({ x, y });
      });
      this.game.canvas.setAttribute('role', 'img');
      this.game.canvas.setAttribute('aria-label', 'Combat grid. Use the action buttons, then arrow keys to select a target and Enter to confirm.');
      this.game.canvas.setAttribute('tabindex', '0');
      ready = true;
      this.redraw();
      if (pendingPulse) { this.animatePulse(pendingPulse); pendingPulse = null; }
    }
    text(x: number, y: number, value: string, size: number, color = C.text, weight = 'normal') {
      const label = this.add.text(x, y, value, { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: `${size}px`, color, fontStyle: weight, resolution: 2 }).setOrigin(0.5);
      this.texts.push(label);
      return label;
    }
    tile(p: Point, color: number, alpha: number, inset = 1) {
      this.layer.fillStyle(color, alpha).fillRect(PAD + p.x * CELL + inset, PAD + p.y * CELL + inset, CELL - inset * 2, CELL - inset * 2);
    }
    outline(p: Point, color: number, width = 2, inset = 3) {
      this.layer.lineStyle(width, color, 1).strokeRect(PAD + p.x * CELL + inset, PAD + p.y * CELL + inset, CELL - inset * 2, CELL - inset * 2);
    }
    hpDot(x: number, y: number, radius: number, filled: boolean) {
      if (filled) this.layer.fillStyle(C.hp, 1).fillCircle(x, y, radius);
      else this.layer.fillStyle(0x25181d, 1).fillCircle(x, y, radius).lineStyle(1, C.hpEmpty, 1).strokeCircle(x, y, radius);
    }
    arrow(from: Point, to: Point, color: number, alpha: number, dashed: boolean, startInset: number, endInset: number, width: number) {
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (distance <= startInset + endInset + 2) return;
      const ux = (to.x - from.x) / distance;
      const uy = (to.y - from.y) / distance;
      const end = distance - endInset;
      this.layer.lineStyle(width, color, alpha);
      if (dashed) {
        for (let start = startInset; start < end - 4; start += 10) {
          const stop = Math.min(start + 5, end - 4);
          this.layer.lineBetween(from.x + ux * start, from.y + uy * start, from.x + ux * stop, from.y + uy * stop);
        }
      } else this.layer.lineBetween(from.x + ux * startInset, from.y + uy * startInset, from.x + ux * end, from.y + uy * end);
      const tip = { x: from.x + ux * end, y: from.y + uy * end };
      this.layer.lineBetween(tip.x, tip.y, tip.x - ux * 5 + uy * 3, tip.y - uy * 5 - ux * 3)
        .lineBetween(tip.x, tip.y, tip.x - ux * 5 - uy * 3, tip.y - uy * 5 + ux * 3);
    }
    sourceChip(point: Point, enemy: Enemy, x: number, y: number, alpha: number) {
      const center = coord(point);
      const color = planColor(enemy);
      this.layer.fillStyle(C.bg, 0.96).fillRect(center.x + x - 8.5, center.y + y - 4, 17, 8);
      this.layer.lineStyle(0.7, color, alpha).strokeRect(center.x + x - 8.5, center.y + y - 4, 17, 8);
      this.text(center.x + x, center.y + y, enemyLabel(enemy), 7.5, colorText(color), 'bold').setAlpha(alpha);
    }
    redraw() {
      const f = getFrame();
      const s = f.state;
      const actionColor = f.ability ? ACTION_COLORS[f.ability] : 0xdce3eb;
      this.layer.clear();
      this.texts.forEach(t => t.destroy());
      this.texts = [];
      this.layer.fillStyle(C.bg, 1).fillRect(0, 0, EDGE, EDGE);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) this.tile({ x, y }, C.tile, 1, 1);
      for (let i = 0; i < SIZE; i++) {
        this.text(PAD + i * CELL + CELL / 2, 11, String.fromCharCode(65 + i), 12, C.muted);
        this.text(11, PAD + i * CELL + CELL / 2, `${i + 1}`, 12, C.muted);
      }
      const pulse = f.pulsePreview ?? (s.phase === 'attack' ? s.pulse : null);
      if (pulse) {
        for (const p of pulse.visibleTiles) this.tile(p, C.freeze, 0.065);
        for (const p of pulse.shadowTiles) this.tile(p, 0x000000, 0.4);
      }
      const active = s.enemies.filter(e => !e.removed && e.hp > 0);
      const highlighted = new Set(f.threatIds);
      const plans = s.phase === 'normal' ? active.filter(e => e.intent && !e.breached && (f.showThreats || highlighted.has(e.id))) : [];
      const faded = (e: Enemy) => highlighted.size > 0 && !highlighted.has(e.id);
      const planAlpha = (e: Enemy) => faded(e) ? 0.14 : highlighted.has(e.id) ? 0.95 : 0.55;
      const sources = new Map<string, { point: Point; enemies: Enemy[] }>();
      for (const enemy of plans) {
        for (const point of enemy.intent!.tiles) {
          this.tile(point, planColor(enemy), faded(enemy) ? 0.018 : highlighted.has(enemy.id) ? 0.15 : 0.065);
          const key = `${point.x},${point.y}`;
          const entry = sources.get(key) ?? { point, enemies: [] };
          if (!entry.enemies.some(e => e.id === enemy.id)) entry.enemies.push(enemy);
          sources.set(key, entry);
        }
      }
      for (const p of s.walls) {
        this.tile(p, C.wall, 1, 5);
        const c = coord(p);
        this.layer.lineStyle(1, 0x79818a, 0.45).lineBetween(c.x - 13, c.y - 13, c.x + 13, c.y + 13).lineBetween(c.x + 13, c.y - 13, c.x - 13, c.y + 13);
      }
      for (const d of s.defenses) {
        const offsets = d.kind === 'deflect' ? [-2, -1, 0, 1, 2] : [0];
        for (const offset of offsets) {
          const direction = DIRS[(d.direction + offset + 8) % 8];
          const p = { x: s.player.x + direction.x, y: s.player.y + direction.y };
          if (p.x < 0 || p.x >= SIZE || p.y < 0 || p.y >= SIZE) continue;
          this.outline(p, d.kind === 'deflect' ? ACTION_COLORS.deflect : ACTION_COLORS.light, 2, 7);
        }
      }
      for (const p of f.valid) {
        const c = coord(p);
        this.layer.fillStyle(actionColor, 0.9).fillCircle(c.x, c.y, 3);
      }
      for (const p of f.preview) {
        this.tile(p, actionColor, 0.22, 2);
        this.outline(p, actionColor, 1, 3);
      }
      if (f.ability === 'dashAttack' && f.target) {
        const a = coord(s.player);
        const b = coord(f.target);
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length > 0) {
          const ux = (b.x - a.x) / length;
          const uy = (b.y - a.y) / length;
          this.layer.lineStyle(2, actionColor, 0.65).lineBetween(a.x, a.y, b.x, b.y);
          this.layer.lineStyle(2, actionColor, 1).strokeCircle(b.x, b.y, 5);
          const tip = { x: b.x + ux * 15, y: b.y + uy * 15 };
          this.layer.lineBetween(b.x, b.y, tip.x, tip.y)
            .lineBetween(tip.x, tip.y, tip.x - ux * 6 + uy * 4, tip.y - uy * 6 - ux * 4)
            .lineBetween(tip.x, tip.y, tip.x - ux * 6 - uy * 4, tip.y - uy * 6 + ux * 4);
        }
      }
      // All plans share the same visual grammar: dashed movement, solid attacks.
      // They render beneath units and their vitals, including along crossing paths.
      for (const enemy of plans) {
        const intent = enemy.intent!;
        const color = planColor(enemy);
        const alpha = planAlpha(enemy);
        const origin = coord(enemy);
        const landing = coord(intent.destination);
        const moves = !eq(enemy, intent.destination);
        if (moves) this.arrow(origin, landing, color, alpha, true, 25, 15, highlighted.has(enemy.id) ? 2 : 1.5);
        for (const point of intent.tiles) {
          const occupied = eq(point, s.player) || active.some(e => eq(e, point));
          this.arrow(landing, coord(point), color, alpha, false, moves ? 15 : 25, occupied ? 25 : 7, highlighted.has(enemy.id) ? 2 : 1.3);
        }
        if (moves) {
          // Frozen movement can occupy a previously planned landing tile. Keep its
          // marker at the edge rather than printing a ghost ID over the unit's HP.
          if (eq(intent.destination, s.player) || active.some(e => eq(e, intent.destination))) {
            const p = intent.destination;
            this.layer.lineStyle(1.3, color, alpha).strokeRect(PAD + p.x * CELL + 3, PAD + p.y * CELL + 3, CELL - 6, CELL - 6);
          } else {
            this.layer.fillStyle(C.bg, 0.86).fillRect(landing.x - 15, landing.y - 10, 30, 20);
            this.layer.lineStyle(1.3, color, alpha).strokeRect(landing.x - 15, landing.y - 10, 30, 20);
            this.text(landing.x, landing.y, `${enemyLabel(enemy)}${intent.heavy ? '!' : ''}`, 10, colorText(color), 'bold').setAlpha(faded(enemy) ? 0.26 : 0.95);
          }
        }
      }
      for (const e of s.enemies.filter(e => e.hp > 0)) this.enemy(e, s, pulse);
      const player = coord(s.player);
      this.layer.fillStyle(C.bg, 1).fillRect(player.x - 20, player.y - 23, 40, 46);
      this.layer.lineStyle(2.5, C.player, 1).strokeRect(player.x - 20, player.y - 23, 40, 46);
      this.text(player.x, player.y - 3, 'P', 22, '#bdeaff', 'bold');
      for (let n = 0; n < s.player.maxHp; n++) {
        const columns = Math.min(6, s.player.maxHp);
        const inRow = Math.min(columns, s.player.maxHp - Math.floor(n / columns) * columns);
        this.hpDot(player.x + ((n % columns) - (inRow - 1) / 2) * 7, player.y + 15 + Math.floor(n / columns) * 6.5, 2.5, n < s.player.hp);
      }
      // Up to five full source IDs fit along the tile's edges, outside vitals and
      // central landing labels. Keep the order stable when individual plans fade.
      for (const { point, enemies } of sources.values()) {
        const ordered = enemies.sort((a, b) => a.id - b.id).slice(0, 5);
        const top = ordered.slice(0, 3);
        const topX = top.length === 2 ? [-18, 18] : top.length === 1 ? [-18] : [-18, 0, 18];
        top.forEach((enemy, i) => this.sourceChip(point, enemy, topX[i], -24, faded(enemy) ? 0.26 : 0.95));
        ordered.slice(3).forEach((enemy, i) => this.sourceChip(point, enemy, i === 0 ? -18 : 18, 24, faded(enemy) ? 0.26 : 0.95));
      }
      // Occupied targets must remain visibly selectable above their unit/wall art.
      for (const p of f.valid) {
        if (active.some(e => eq(e, p)) || s.walls.some(w => eq(w, p)) || plans.some(e => eq(e.intent!.destination, p))) {
          const c = coord(p);
          this.layer.fillStyle(actionColor, 1).fillCircle(c.x + 25, c.y, 3);
        }
      }
      if (f.inspectId !== null) {
        const e = s.enemies.find(e => e.id === f.inspectId && e.hp > 0);
        if (e) this.outline(e, 0xffffff, 1.5, 2);
      }
      if (f.inspectTile) this.outline(f.inspectTile, 0xffffff, 1, 6);
      if (f.cursor && !f.target) this.outline(f.cursor, actionColor, 1, 3);
      if (f.target) {
        this.outline(f.target, actionColor, 3, 3);
        const c = coord(f.target);
        this.layer.lineStyle(2, actionColor, 1).lineBetween(c.x - 8, c.y - 24, c.x + 8, c.y - 24);
      }
    }
    enemy(e: Enemy, _s: GameState, pulse: PulseResult | null) {
      const c = coord(e);
      const col = e.removed ? 0x798390 : e.breached ? C.breach : e.opening ? C.opening : 0xc9ced5;
      this.layer.fillStyle(C.bg, e.removed ? 0.6 : 0.96).fillRect(c.x - 23, c.y - 23, 46, 46);
      this.layer.lineStyle(e.removed ? 1.5 : 2, col, e.removed ? 0.65 : 1).strokeRect(c.x - 23, c.y - 23, 46, 46);
      const color = e.removed ? '#a0adbc' : e.breached ? '#ffdc81' : e.opening ? '#ff4ed8' : '#f2f5f7';
      this.layer.lineStyle(3, planColor(e), e.removed ? 0.35 : 0.85).lineBetween(c.x - 22, c.y - 17, c.x - 22, c.y - 8);
      this.text(c.x, c.y - 12, e.removed ? 'return' : `${enemyLabel(e)}${e.kind === 'heavy' ? '!' : ''}`, e.removed ? 10 : e.kind === 'heavy' ? 12 : 14, color, e.removed ? 'normal' : 'bold');
      const guardLabel = `${e.guard}/${e.maxGuard}`;
      const guardRatio = Math.max(0, Math.min(1, e.guard / Math.max(1, e.maxGuard)));
      this.layer.fillStyle(0x222b35, 1).fillRect(c.x - 20, c.y - 3, 40, 12);
      this.layer.fillStyle(col, e.removed ? 0.3 : 0.46).fillRect(c.x - 20, c.y - 3, 40 * guardRatio, 12);
      this.layer.lineStyle(1, col, e.removed ? 0.5 : 0.7).strokeRect(c.x - 20, c.y - 3, 40, 12);
      this.text(c.x, c.y + 3, guardLabel, Math.min(12, 64 / guardLabel.length), color);
      // Life sits immediately below the Guard bar, aligned to its right edge.
      for (let n = 0; n < e.maxHp; n++) this.hpDot(c.x + 17.5 - (e.maxHp - 1 - n) * 7, c.y + 16, 2.5, n < e.hp);
      if (!e.removed && pulse?.hitIds.includes(e.id)) this.layer.fillStyle(C.freeze, 1).fillCircle(c.x + 25, c.y - 25, 2.5);
    }
    animatePulse(origin: Point) {
      this.pulseEffect?.destroy();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const c = coord(origin);
      const effect = this.add.graphics().setDepth(100);
      this.pulseEffect = effect;
      const animation = { radius: 0, alpha: 0.8 };
      this.tweens.add({ targets: animation, radius: EDGE * 1.25, alpha: 0, duration: 700, ease: 'Sine.Out', onUpdate: () => {
        effect.clear().lineStyle(4, C.freeze, animation.alpha).strokeCircle(c.x, c.y, animation.radius);
      }, onComplete: () => { effect.destroy(); if (this.pulseEffect === effect) this.pulseEffect = null; } });
    }
  }
  const game = new Phaser.Game({
    type: Phaser.CANVAS, parent: host, width: EDGE, height: EDGE, backgroundColor: '#101419', scene: CombatBoard,
    render: { antialias: true, pixelArt: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: EDGE, height: EDGE },
    audio: { noAudio: true }, banner: false,
    input: { touch: { capture: true }, mouse: { preventDefaultWheel: false } },
  });
  // Container width changes independently of window resize at responsive breakpoints.
  // Keep input coordinates in sync; the canvas never determines its parent's height.
  const resizeObserver = new ResizeObserver(() => game.scale.refresh());
  resizeObserver.observe(host);
  const hover = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const bounds = game.canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - bounds.left) * EDGE / bounds.width - PAD) / CELL);
    const y = Math.floor(((event.clientY - bounds.top) * EDGE / bounds.height - PAD) / CELL);
    onHover(x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null);
  };
  const leave = () => onHover(null);
  game.canvas.addEventListener('pointermove', hover);
  game.canvas.addEventListener('pointerleave', leave);
  window.addEventListener('blur', leave);
  return {
    redraw: () => { if (ready) scene?.redraw(); },
    animatePulse: (p: Point) => { if (ready) scene?.animatePulse(p); else pendingPulse = p; },
    destroy: () => {
      resizeObserver.disconnect();
      game.canvas.removeEventListener('pointermove', hover);
      game.canvas.removeEventListener('pointerleave', leave);
      window.removeEventListener('blur', leave);
      game.destroy(true);
    },
  };
}

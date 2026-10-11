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
  showThreats: boolean;
  pulsePreview: PulseResult | null;
}
const CELL = 58;
const PAD = 24;
const EDGE = CELL * SIZE + PAD * 2;
const C = { bg: 0x101419, tile: 0x1d232a, grid: 0x343c47, text: '#f2f5f7', muted: '#adb7c5', wall: 0x4b535d, player: 0x8ed9ff, danger: 0xef827e, heavy: 0xffad6c, opening: 0xff4ed8, breach: 0xffd975, valid: 0x8ed9ff, hp: 0xf16c73, hpEmpty: 0x75343c };
const eq = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const coord = (p: Point) => ({ x: PAD + p.x * CELL + CELL / 2, y: PAD + p.y * CELL + CELL / 2 });

export function createBoard(host: HTMLElement, getFrame: () => BoardFrame, onTile: (p: Point) => void) {
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
      this.texts.push(this.add.text(x, y, value, { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: `${size}px`, color, fontStyle: weight, resolution: 2 }).setOrigin(0.5));
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
    redraw() {
      const f = getFrame();
      const s = f.state;
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
        for (const p of pulse.visibleTiles) this.tile(p, C.player, 0.035);
        for (const p of pulse.shadowTiles) this.tile(p, 0x000000, 0.4);
      }
      const active = s.enemies.filter(e => !e.removed && e.hp > 0);
      const inspected = active.find(e => e.id === f.inspectId);
      const threats = f.showThreats ? active : inspected ? [inspected] : [];
      for (const e of threats) {
        if (!e.intent) continue;
        const color = e.intent.heavy ? C.heavy : C.danger;
        for (const p of e.intent.tiles) {
          this.tile(p, color, inspected?.id === e.id ? 0.24 : 0.10);
          const c = coord(p);
          this.layer.lineStyle(1.2, color, 0.65).lineBetween(c.x - 4, c.y - 4, c.x + 4, c.y + 4).lineBetween(c.x + 4, c.y - 4, c.x - 4, c.y + 4);
        }
      }
      for (const p of s.walls) {
        this.tile(p, C.wall, 1, 5);
        const c = coord(p);
        this.layer.lineStyle(1, 0x79818a, 0.45).lineBetween(c.x - 13, c.y - 13, c.x + 13, c.y + 13).lineBetween(c.x + 13, c.y - 13, c.x - 13, c.y + 13);
      }
      for (const d of s.defenses) {
        const offsets = d.kind === 'deflect' ? [-1, 0, 1] : [0];
        for (const offset of offsets) {
          const direction = DIRS[(d.direction + offset + 8) % 8];
          const p = { x: s.player.x + direction.x, y: s.player.y + direction.y };
          if (p.x < 0 || p.x >= SIZE || p.y < 0 || p.y >= SIZE) continue;
          this.outline(p, d.kind === 'deflect' ? 0xbab8ff : 0x8ed9ff, 2, 7);
        }
      }
      for (const p of f.valid) {
        const c = coord(p);
        this.layer.fillStyle(C.valid, 0.8).fillCircle(c.x, c.y, 3);
      }
      for (const p of f.preview) this.tile(p, C.valid, 0.18, 2);
      if (inspected?.intent) {
        const a = coord(inspected);
        const b = coord(inspected.intent.destination);
        if (!eq(inspected, inspected.intent.destination)) {
          this.layer.lineStyle(2.5, 0xf2f5f7, 0.9).lineBetween(a.x, a.y, b.x, b.y);
          this.layer.fillStyle(0xf2f5f7, 1).fillCircle(b.x, b.y, 4);
          this.outline(inspected.intent.destination, 0xf2f5f7, 2, 10);
        }
      }
      for (const e of s.enemies.filter(e => e.hp > 0)) this.enemy(e, s, pulse);
      const player = coord(s.player);
      this.layer.fillStyle(C.bg, 1).fillRect(player.x - 20, player.y - 23, 40, 46);
      this.layer.lineStyle(2.5, C.player, 1).strokeRect(player.x - 20, player.y - 23, 40, 46);
      this.text(player.x, player.y - 7, 'P', 24, '#bdeaff', 'bold');
      for (let n = 0; n < s.player.maxHp; n++) {
        this.hpDot(player.x - 14.5 + (n % 6) * 5.8, player.y + 10 + Math.floor(n / 6) * 6.5, 2, n < s.player.hp);
      }
      // Occupied targets must remain visibly selectable above their unit/wall art.
      for (const p of f.valid) {
        if (active.some(e => eq(e, p)) || s.walls.some(w => eq(w, p))) {
          const c = coord(p);
          this.layer.fillStyle(C.valid, 1).fillCircle(c.x - 24, c.y - 24, 3);
        }
      }
      if (f.inspectId !== null) {
        const e = s.enemies.find(e => e.id === f.inspectId && e.hp > 0);
        if (e) this.outline(e, 0xffffff, 1.5, 2);
      }
      if (f.cursor && !f.target) this.outline(f.cursor, 0xdce3eb, 1, 3);
      if (f.target) {
        this.outline(f.target, C.valid, 3, 3);
        const c = coord(f.target);
        this.layer.lineStyle(2, C.valid, 1).lineBetween(c.x - 8, c.y - 24, c.x + 8, c.y - 24);
      }
    }
    enemy(e: Enemy, _s: GameState, pulse: PulseResult | null) {
      const c = coord(e);
      const col = e.removed ? 0x798390 : e.breached ? C.breach : e.opening ? C.opening : 0xc9ced5;
      this.layer.fillStyle(C.bg, e.removed ? 0.6 : 0.96).fillRect(c.x - 23, c.y - 23, 46, 46);
      this.layer.lineStyle(e.removed ? 1.5 : 2, col, e.removed ? 0.65 : 1).strokeRect(c.x - 23, c.y - 23, 46, 46);
      const color = e.removed ? '#a0adbc' : e.breached ? '#ffdc81' : e.opening ? '#ff4ed8' : '#f2f5f7';
      this.text(c.x, c.y - 13, e.removed ? 'return' : `${e.kind[0].toUpperCase()}${e.id}`, e.removed ? 10 : 16, color, e.removed ? 'normal' : 'bold');
      const guardLabel = `${e.guard}/${e.maxGuard}`;
      const guardRatio = Math.max(0, Math.min(1, e.guard / Math.max(1, e.maxGuard)));
      this.layer.fillStyle(0x222b35, 1).fillRect(c.x - 20, c.y - 3, 40, 12);
      this.layer.fillStyle(col, e.removed ? 0.3 : 0.46).fillRect(c.x - 20, c.y - 3, 40 * guardRatio, 12);
      this.layer.lineStyle(1, col, e.removed ? 0.5 : 0.7).strokeRect(c.x - 20, c.y - 3, 40, 12);
      this.text(c.x, c.y + 3, guardLabel, Math.min(12, 64 / guardLabel.length), color);
      // Life sits immediately below the Guard bar, aligned to its right edge.
      for (let n = 0; n < e.maxHp; n++) this.hpDot(c.x + 17.5 - (e.maxHp - 1 - n) * 7, c.y + 16, 2.5, n < e.hp);
      if (!e.removed && pulse?.hitIds.includes(e.id)) this.layer.fillStyle(C.player, 1).fillCircle(c.x + 25, c.y - 25, 2.5);
    }
    animatePulse(origin: Point) {
      this.pulseEffect?.destroy();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const c = coord(origin);
      const effect = this.add.graphics().setDepth(100);
      this.pulseEffect = effect;
      const animation = { radius: 0, alpha: 0.8 };
      this.tweens.add({ targets: animation, radius: EDGE * 1.25, alpha: 0, duration: 700, ease: 'Sine.Out', onUpdate: () => {
        effect.clear().lineStyle(4, C.player, animation.alpha).strokeCircle(c.x, c.y, animation.radius);
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
  return {
    redraw: () => { if (ready) scene?.redraw(); },
    animatePulse: (p: Point) => { if (ready) scene?.animatePulse(p); else pendingPulse = p; },
    destroy: () => { resizeObserver.disconnect(); game.destroy(true); },
  };
}

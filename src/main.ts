import './style.css';
import { createGame, execute, availableAbilities, validTargets, previewAction, canBeginAttack } from './engine';
import { pulse } from './geometry';
import { createBoard, type BoardFrame } from './board';
import { COSTS, GUARD, MAX_ATTUNEMENT, PLAYER_MAX_HP, SIZE, THRESHOLD, TOTAL_ROOMS, type Ability, type Command, type Enemy, type GameState, type Point } from './model';

import { parseSaveRecord, type SaveRecord } from './save';

const SAVE_KEY = 'grid-combat-prototype.v6';
const LEGACY_SAVE_KEYS = ['grid-combat-prototype.v5', 'grid-combat-prototype.v4', 'grid-combat-prototype.v3'];
const eq = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const coordinate = (p: Point) => `${String.fromCharCode(65 + p.x)}${p.y + 1}`;
const names: Record<Ability, string> = { dash: 'Dash', light: 'Light attack', deflect: 'Deflect', dashAttack: 'Dash attack' };
const HEAVY_STEPS = ['Jump', 'Sweep', 'Impact', 'Recovery'] as const;
const heavyStep = (enemy: Enemy) => enemy.intent?.comboStep ?? enemy.comboStep;
const descriptions: Record<Ability, string> = {
  dash: 'Choose an empty tile along a clear row, column, or diagonal. No charge cost or gain.',
  light: 'Choose the center tile: 2 Guard there, 1 to each side. +2 charge on a hit. Parries the center enemy and center direction; never Heavy.',
  deflect: 'Spend 1 charge. Choose a five-tile arc to block attacks, including Heavy.',
  dashAttack: 'Spend 1 charge. Dash, then hit the three tiles ahead for 5 Guard. Exposed cores lose 1 HP.',
};
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <main class="shell">
    <header class="topline"><h1>Combat prototype</h1><span id="run-label"></span></header>
    <div class="status-strip" id="status" aria-label="Run status"></div>
    <div class="play-layout">
      <section class="board-column" aria-label="Playfield">
        <div id="board" class="board"></div>
        <p class="legend"><span>Dashed → dash</span><span>Curved ⇢ jump</span><span>Solid → attack</span><span>◇ impact</span><span>! Heavy · 1–4</span><span class="pink">■ opening</span><span class="yellow">■ breached</span></p>
        <p class="board-note" id="board-note"></p>
      </section>
      <section class="controls" aria-label="Combat controls">
        <div class="turn-heading"><h2 id="phase-title"></h2></div>
        <div id="abilities" class="abilities"></div>
        <p id="instruction" class="instruction" role="status" aria-live="polite"></p>
        <div id="target-controls" class="target-controls"><button id="confirm" class="primary" disabled>Confirm</button><button id="cancel" class="quiet">Cancel</button></div>
        <div id="phase-controls" class="phase-controls"></div>
        <div id="attack-controls" class="attack-controls"></div>
        <section class="inspection" aria-label="Tile inspection" hidden><div class="inspect-heading"><h3 id="inspect-title">Inspect</h3><button id="clear-inspect" class="text-button" hidden>Clear</button></div><div id="inspect-vitals"></div><p id="inspect-info"></p></section>
        <p id="last-event" class="last-event" aria-live="polite"></p>
      </section>
    </div>
    <div class="details-row">
      <details><summary>Controls & rules</summary><div class="board-options"><label><input type="checkbox" id="threats" checked> Enemy plans</label><label id="pulse-option"><input type="checkbox" id="pulse-preview"> Pulse reach</label></div><div class="rules">
        <p><strong>Each turn:</strong> choose Dash, Light attack, or Deflect. Select a target and confirm. Enemies respond immediately after that one action. Inspection and targeting are free.</p>
        <p><strong>Dash:</strong> move along a clear row, column, or diagonal to an empty tile. No charge cost or gain. Only walls and active enemies on the crossed tiles block movement; neighboring tiles do not block a diagonal.</p>
        <p><strong>Light attack:</strong> select the center of three consecutive neighboring tiles. The double outline marks the center. Deal ${GUARD.lightCenter} Guard damage there and ${GUARD.lightSide} to each side. Gain 2 charge once if any enemy is hit, capped at ${MAX_ATTUNEMENT}. The center enemy's non-Heavy attack is parried during this response even if it moves. Incoming non-Heavy attacks from the center direction are also parried. Side hits do not gain that enemy-specific protection. Heavy attacks cannot be parried. A parry preserves the Light attack's damage and adds no extra damage.</p>
        <p><strong>Deflect:</strong> costs 1 charge. Select the center of five consecutive neighboring tiles. Blocks attacks from all five directions, including Heavy. For the final Heavy blast, face its impact marker; if standing on the impact, face the Heavy. Deals no damage and gains no charge.</p>
        <p><strong>Freeze time:</strong> available at ${THRESHOLD}+ charge. All banked charge becomes the frozen-time budget, and a pulse fires once. Ending the freeze discards unused charge. Enemies do not move, attack, recover, or regenerate during frozen time.</p>
        <p><strong>Pulse:</strong> radial line of sight, ${GUARD.pulse} Guard damage. Pink openings breach instantly. Walls and enemies whose Guard survives cast shadows; breached enemies let the pulse pass through. The reach preview shows the exact resulting visibility, including enemies the pulse will breach.</p>
        <p><strong>Dash attack:</strong> the only frozen-time ability. Costs 1 charge. Dash to an empty tile, then hit the three adjacent tiles facing the direction you dashed for ${GUARD.dashAttack} Guard each. The attack always faces forward; it cannot be aimed separately. Hitting an already-breached enemy instead removes 1 HP. A surviving core-hit enemy restores Guard and leaves combat until time resumes. Newly breaching Guard does not damage HP on that same hit.</p>
        <p><strong>Armor:</strong> Guard protects all HP. The bar shows remaining integer Guard. Red dots beneath its right end show HP; empty dots are lost HP. A breach interrupts and stuns through the next enemy resolution. Unbreached Guard regenerates by ${GUARD.regen} per resolution. Breached Guard restores after the stun. No regeneration or enemy movement occurs during an attack turn.</p>
        <p><strong>Enemy plans:</strong> straight dashed arrows show ground moves; curved dashed arrows show jumps. Solid arrows show attacks. The final Heavy blast starts at its diamond impact marker, one tile from its landing position. Matching IDs identify the source; ! marks Heavy attacks. Hover or tap to emphasize related plans. Plans are hidden while time is frozen.</p>
        <p><strong>Gap closers:</strong> Lunge and Sweep dash along clear paths. Moving Lunge, Sweep, and Heavy sweep/impact attacks face their actual movement direction. Enemies commit an attack only if it can reach your current tile; otherwise they approach or wait without attacking. Once shown, the current destination and attack tiles stay fixed, so you can dodge. A blocked landing cancels the move and attack.</p>
        <p><strong>Heavy combo:</strong> its small 1/4–4/4 marker shows the current step. Each step uses one normal enemy response; the next step aims again when it is planned. Freeze pauses the combo, and a breach interrupts it and resets it to 1/4.</p>
        <ol class="combo-rules"><li><strong>Jump:</strong> jump to any empty tile, clearing walls and units, then hit the eight surrounding neighbors. A committed jump attack has a bright pink opening. An out-of-range approach or wait stays on this step.</li><li><strong>Sweep:</strong> advance up to one tile and use the wide 14-tile sweep shown on the board.</li><li><strong>Impact:</strong> advance up to one tile, strike an adjacent tile, then radiate along eight straight directions for up to three tiles. Walls and the Heavy's own body stop rays, including the rear ray through its body.</li><li><strong>Recovery:</strong> no movement, attack, or opening. Then begin the next jump cycle.</li></ol>
        <p>Sweep and Impact steps still advance if they approach, wait, miss, or have their landing blocked. Only their currently marked footprint is committed; later steps can aim again.</p>
        <p><strong>Inspection:</strong> hover any tile to see its contents, incoming attacks, and planned arrivals. Hover an enemy to see its Guard, HP, planned destination, and attack tiles. Tap or click to keep the inspection after the pointer leaves. Hovering never changes an action target or advances time.</p>
        <p><strong>Enemy types:</strong> L = basic Lunge (${GUARD.lunge} Guard, 1 HP), S = Sweep, H = Heavy. Pink means an opening. Yellow means breached. “Return” marks a survivor removed until time resumes.</p>
        <p><strong>HP:</strong> start with ${PLAYER_MAX_HP} HP. Every unblocked enemy hit removes exactly 1 HP, including Heavy attacks. Separate enemies can each hit you in the same response. Zero HP ends the run.</p>
        <p><strong>Run:</strong> clear ${TOTAL_ROOMS} small seeded arenas. HP restores to ${PLAYER_MAX_HP} between arenas. Your current run saves automatically in this browser.</p>
        <p><strong>Keyboard:</strong> 1–3 select an ability; arrows or numpad move the target cursor; Enter confirms; F freezes time; Escape cancels. Mouse and touch use the same action → target → confirm flow.</p>
        <details><summary>Enemy list</summary><div id="enemy-list" class="enemy-list"></div></details>
      </div></details>
      <details><summary>Run</summary><div class="run-settings"><label for="seed">Seed</label><input id="seed" inputmode="numeric" pattern="[0-9]*" maxlength="10" aria-label="Run seed"><button id="new-seeded">Start seed</button><button id="retry">Restart same seed</button><button id="new-random">New random run</button><p>Runs save automatically. Existing 7×7 runs keep their progress with HP capped at ${PLAYER_MAX_HP}. Starting or restarting replaces this version's run.</p><p id="save-note" role="status"></p></div><details><summary>Recent actions</summary><div id="event-log" class="log"></div></details></details>
    </div>
  </main>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function readSave(): SaveRecord | null {
  try {
    const current = localStorage.getItem(SAVE_KEY);
    if (current !== null) return parseSaveRecord(current);
    for (const key of LEGACY_SAVE_KEYS) {
      const legacy = parseSaveRecord(localStorage.getItem(key));
      if (legacy) return legacy;
    }
    return null;
  } catch { return null; }
}
const initialSave = readSave();
let needsCurrentSave = true;
try { needsCurrentSave = localStorage.getItem(SAVE_KEY) === null; } catch { /* save() reports storage availability. */ }
let state = initialSave?.state ?? createGame();
let knownToken = initialSave?.token ?? null;
let selectedAbility: Ability | null = null;
let target: Point | null = null;
let cursor: Point | null = null;
let inspectId: number | null = null;
let inspectTile: Point | null = null;
let hoveredTile: Point | null = null;
let feedback = '';
let showThreats = true;
let showPulsePreview = false;
let savedMessage = initialSave ? 'Saved run resumed.' : '';
let pulseCache: { state: GameState; value: ReturnType<typeof pulse> } | null = null;
function clearSelection() { selectedAbility = null; target = null; cursor = null; feedback = ''; }
function save() {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ schema: 1, token, state } satisfies SaveRecord));
    knownToken = token;
    savedMessage = 'Saved in this browser.';
  } catch { savedMessage = 'Browser storage is unavailable. Keep this tab open to retain the run.'; }
}
function syncBeforeAction() {
  const current = readSave();
  if (current && current.token !== knownToken) {
    state = current.state;
    knownToken = current.token;
    clearSelection();
    savedMessage = 'Run updated in another tab. Synced here; choose your action again.';
    render();
    return false;
  }
  return true;
}
function frame(): BoardFrame {
  if (showPulsePreview && canBeginAttack(state) && pulseCache?.state !== state) pulseCache = { state, value: pulse(state, false) };
  return { state, ability: selectedAbility, target, cursor, valid: selectedAbility ? validTargets(state, selectedAbility) : [], preview: selectedAbility && target ? previewAction(state, selectedAbility, target) : [], inspectId: inspectedEnemy()?.id ?? null, inspectTile: inspectedTile(), threatIds: relatedThreatIds(), showThreats, pulsePreview: showPulsePreview && canBeginAttack(state) ? pulseCache?.value ?? null : null };
}
const board = createBoard($('board'), frame, p => {
  const enemy = state.enemies.find(e => eq(e, p) && e.hp > 0);
  inspectId = enemy?.id ?? null;
  inspectTile = p;
  hoveredTile = null;
  if (selectedAbility) {
    cursor = p;
    if (validTargets(state, selectedAbility).some(v => eq(v, p))) { target = p; feedback = ''; }
    else { target = null; feedback = 'Choose a highlighted tile.'; }
  }
  render();
}, p => {
  if (p && hoveredTile ? eq(p, hoveredTile) : p === hoveredTile) return;
  hoveredTile = p;
  renderInspection();
  board.redraw();
});
function dispatch(command: Command) {
  if (!syncBeforeAction()) return;
  const origin = { x: state.player.x, y: state.player.y };
  const next = execute(state, command);
  if (next === state) { feedback = 'That action is unavailable. Choose a highlighted target.'; render(); return; }
  state = next;
  clearSelection();
  save();
  render();
  if (command.type === 'beginAttack') board.animatePulse(origin);
}
function choose(ability: Ability) {
  if (!availableAbilities(state).includes(ability) || (COSTS[ability] ?? 0) > (state.phase === 'attack' ? state.charge : state.player.attunement)) return;
  if (selectedAbility === ability) clearSelection();
  else { selectedAbility = ability; target = null; cursor = { x: state.player.x, y: state.player.y }; feedback = ''; }
  render();
}
function button(label: string, action: () => void, className = '', disabled = false) {
  const b = document.createElement('button');
  b.textContent = label; b.className = className; b.disabled = disabled;
  b.addEventListener('click', action);
  return b;
}
function hpDots(hp: number, maxHp: number): string {
  return `<span class="hp-dots" role="img" aria-label="${hp} of ${maxHp} HP">${Array.from({ length: maxHp }, (_, i) => `<span class="hp-dot${i >= hp ? ' is-empty' : ''}" aria-hidden="true"></span>`).join('')}</span>`;
}
function unitVitals(e: Enemy): string {
  const combo = e.kind === 'heavy' ? `<span class="combo-marker" aria-label="Heavy step ${heavyStep(e) + 1} of 4: ${HEAVY_STEPS[heavyStep(e)]}">${heavyStep(e) + 1}/4</span>` : '';
  return `<div class="unit-vitals"><div class="guard-meter" role="meter" aria-label="Guard" aria-valuemin="0" aria-valuemax="${e.maxGuard}" aria-valuenow="${e.guard}"><span class="guard-fill" style="width:${e.guard / e.maxGuard * 100}%"></span><span class="guard-value">${e.guard} / ${e.maxGuard}</span></div><div class="enemy-hp${combo ? ' has-combo' : ''}">${combo}${hpDots(e.hp, e.maxHp)}</div></div>`;
}
function inspection(e: Enemy) {
  if (e.removed) return `Guard restored. Removed for this attack turn; returns when it ends.${e.kind === 'heavy' ? ' Combo restarts at 1/4.' : ''}`;
  let text = '';
  if (e.breached) text += `BREACHED: core exposed, intention interrupted. Stunned through the next enemy resolution.${e.kind === 'heavy' ? ' Combo reset to 1/4.' : ''}`;
  else {
    if (e.kind === 'heavy') text += `${heavyStep(e) + 1}/4 · ${HEAVY_STEPS[heavyStep(e)]}. `;
    if (e.opening) text += 'OPENING: pulse breaches instantly. ';
    if (e.intent) {
      const intent = e.intent;
      if (intent.kind === 'wait') return text + (e.kind === 'heavy' && heavyStep(e) === 3 ? 'No movement or attack this response. No opening.' : 'Out of range: waits without attacking.');
      const movement = intent.movement === 'jump' ? 'Jumps' : 'Dashes';
      if (e.kind !== 'heavy') text += `${intent.label}. `;
      text += `${eq(e, intent.destination) ? `Stays at ${coordinate(e)}.` : `${movement} ${coordinate(e)} → ${coordinate(intent.destination)}.`} `;
      if (intent.impact) text += `Impact at ${coordinate(intent.impact)}; rays originate there. `;
      text += intent.kind === 'attack' ? `Hits ${intent.tiles.map(coordinate).join(', ')}.` : 'Out of range: repositions without attacking.';
    } else text += 'No action planned.';
  }
  return text;
}
function inspectedTile(): Point | null {
  return hoveredTile ?? state.enemies.find(e => e.id === inspectId && e.hp > 0) ?? inspectTile;
}
function inspectedEnemy(): Enemy | undefined {
  const p = inspectedTile();
  return p ? state.enemies.find(e => eq(e, p) && e.hp > 0) : undefined;
}
function relatedThreatIds(): number[] {
  const p = inspectedTile();
  if (!p) return [];
  const active = state.enemies.filter(e => e.hp > 0 && !e.removed && !e.breached && e.intent);
  const source = active.find(e => eq(e, p));
  if (source) return [source.id];
  return active.filter(e => e.intent!.tiles.some(t => eq(t, p)) || eq(e.intent!.destination, p)).map(e => e.id);
}
function renderInspection() {
  const p = inspectedTile();
  const enemy = inspectedEnemy();
  const player = p && eq(p, state.player);
  const wall = p && state.walls.some(w => eq(w, p));
  const label = enemy ? `${enemy.kind[0].toUpperCase()}${enemy.id} · ${enemy.kind[0].toUpperCase()}${enemy.kind.slice(1)}` : player ? 'Player' : wall ? 'Wall' : 'Empty';
  document.querySelector<HTMLElement>('.inspection')!.hidden = !p;
  $('inspect-title').textContent = p ? `${coordinate(p)} · ${label}` : 'Inspect';
  $('inspect-vitals').innerHTML = enemy ? unitVitals(enemy) : player ? hpDots(state.player.hp, state.player.maxHp) : '';
  const details: string[] = [];
  if (p) {
    details.push(enemy ? inspection(enemy) : player ? 'Your position.' : wall ? 'Blocks ground movement, attacks, and pulse line of sight. Jumps can clear it.' : 'Open tile.');
    const active = state.enemies.filter(e => e.hp > 0 && !e.removed && !e.breached && e.intent);
    const threats = active.filter(e => e.intent!.tiles.some(t => eq(t, p)));
    details.push(threats.length ? `Planned attacks here: ${threats.map(e => `${e.kind[0].toUpperCase()}${e.id} (${e.intent!.label})`).join('; ')}.` : 'No attacks planned here.');
    const arrivals = active.filter(e => !eq(e, p) && eq(e.intent!.destination, p));
    if (arrivals.length) details.push(`Planned arrivals: ${arrivals.map(e => `${e.kind[0].toUpperCase()}${e.id} (${e.intent!.movement})`).join(', ')}.`);
  }
  $('inspect-info').textContent = p ? details.join(' ') : 'Hover a tile to inspect it. Tap or click to keep its details.';
  $('clear-inspect').hidden = !p;
  $('board-note').textContent = state.phase === 'attack' && state.pulse ? `Pulse: ${state.pulse.hitIds.length} hit · ${state.pulse.breachedIds.length} breached. Enemy plans paused.` : showPulsePreview && canBeginAttack(state) ? 'Pulse preview: dark tiles are occluded.' : 'Matching IDs show attack sources. Hover or tap to emphasize plans.';
}
function render() {
  const attack = state.phase === 'attack';
  $('run-label').textContent = `Arena ${state.room}/${TOTAL_ROOMS} · Turn ${state.round}`;
  $('status').innerHTML = `<span class="player-health">HP ${hpDots(state.player.hp, state.player.maxHp)}</span><span>Charge <strong>${attack ? state.charge : state.player.attunement}<small> / ${MAX_ATTUNEMENT}</small></strong></span>`;
  const phaseTitles: Record<GameState['phase'], string> = { normal: 'Choose one action', attack: 'Time frozen', cleared: 'Arena cleared', won: 'Run complete', lost: 'Run ended' };
  $('phase-title').textContent = phaseTitles[state.phase];
  $('phase-title').classList.toggle('frozen', attack);
  const actions = availableAbilities(state);
  const abilities = $('abilities'); abilities.replaceChildren();
  for (const ability of actions) {
    const cost = COSTS[ability];
    const label = `${names[ability]}${cost ? ` · −${cost}` : ability === 'light' ? ' · +2 on hit' : ''}`;
    const b = button(label, () => choose(ability), `skill-${ability}${selectedAbility === ability ? ' selected' : ''}`, (cost ?? 0) > (attack ? state.charge : state.player.attunement));
    b.setAttribute('aria-pressed', String(selectedAbility === ability));
    b.title = descriptions[ability];
    abilities.append(b);
  }
  let instruction = '';
  if (feedback) instruction = feedback;
  else if (selectedAbility) {
    instruction = target ? `${names[selectedAbility]} → ${coordinate(target)}.${selectedAbility === 'dashAttack' ? ' Gold tiles show the attack after landing.' : ''}` : descriptions[selectedAbility];
    if (selectedAbility === 'light' && target) {
      const centerEnemy = state.enemies.find(e => !e.removed && e.hp > 0 && eq(e, target!));
      instruction = `Center ${coordinate(target)}: ${GUARD.lightCenter} Guard. Sides: ${GUARD.lightSide}. `;
      if (centerEnemy) instruction += centerEnemy.kind === 'heavy' ? `H${centerEnemy.id} is Heavy: cannot parry it.` : `${centerEnemy.kind[0].toUpperCase()}${centerEnemy.id}'s attack is parried even if it moves. Center direction is also covered.`;
      else instruction += 'Parries non-Heavy attacks from the center direction.';
    }
  }
  else if (state.phase === 'normal') instruction = 'One action, then enemies respond.';
  else if (attack) instruction = state.charge ? 'Dash, then strike ahead. Enemies stay frozen.' : 'No charge left. Resume time.';
  else if (state.phase === 'cleared') instruction = 'All enemies are defeated. Continue with full HP.';
  else if (state.phase === 'won') instruction = 'All five arenas cleared. Start a new run or retry the same seed below.';
  else instruction = 'You have no HP remaining. Restart the same seed or start a new run below.';
  $('instruction').textContent = instruction;
  $('instruction').classList.toggle('light-center', selectedAbility === 'light' && target !== null);
  $('target-controls').hidden = !selectedAbility;
  $('confirm').textContent = target && selectedAbility ? `Confirm ${names[selectedAbility]}` : 'Select a target';
  $('confirm').className = `primary${selectedAbility ? ` skill-${selectedAbility}` : ''}`;
  ($('confirm') as HTMLButtonElement).disabled = !target;
  $('phase-controls').replaceChildren();
  if (state.phase === 'cleared') $('phase-controls').append(button('Next arena · restore HP', () => dispatch({ type: 'nextRoom' }), 'primary wide'));
  if (state.phase === 'lost' || state.phase === 'won') $('phase-controls').append(button('Restart same seed', () => newRun(state.seed), 'primary wide'));
  $('attack-controls').replaceChildren();
  if (attack) $('attack-controls').append(button(`Resume time${state.charge ? ` · discard ${state.charge}` : ''}`, () => dispatch({ type: 'endAttack' }), 'skill-freeze wide'));
  else if (state.phase === 'normal') $('attack-controls').append(button(canBeginAttack(state) ? `Freeze time · use ${state.player.attunement}` : `Freeze time · needs ${THRESHOLD}`, () => dispatch({ type: 'beginAttack' }), 'skill-freeze wide', !canBeginAttack(state)));
  renderInspection();
  $('last-event').textContent = state.round > 1 && !attack ? state.log[0] ?? '' : '';
  $('last-event').hidden = !$('last-event').textContent;
  $('event-log').replaceChildren(...state.log.map(message => { const p = document.createElement('p'); p.textContent = message; return p; }));
  $('save-note').textContent = savedMessage;
  $('pulse-option').hidden = !canBeginAttack(state);
  $('enemy-list').replaceChildren(...state.enemies.filter(e => e.hp > 0).map(e => {
    const b = button(`${e.kind[0].toUpperCase()}${e.id}`, () => { inspectId = e.id; inspectTile = { x: e.x, y: e.y }; hoveredTile = null; render(); });
    b.insertAdjacentHTML('beforeend', unitVitals(e));
    return b;
  }));
  board.redraw();
}
function newRun(seed?: number) {
  state = createGame(seed); inspectId = null; inspectTile = null; hoveredTile = null; clearSelection(); showPulsePreview = false; ($('pulse-preview') as HTMLInputElement).checked = false;
  save(); ($('seed') as HTMLInputElement).value = String(state.seed); render();
}
$('confirm').addEventListener('click', () => { if (selectedAbility && target) dispatch({ type: 'act', ability: selectedAbility, target }); });
$('cancel').addEventListener('click', () => { clearSelection(); render(); });
$('clear-inspect').addEventListener('click', () => { inspectId = null; inspectTile = null; hoveredTile = null; render(); });
$('threats').addEventListener('change', e => { showThreats = (e.target as HTMLInputElement).checked; render(); });
$('pulse-preview').addEventListener('change', e => { showPulsePreview = (e.target as HTMLInputElement).checked; render(); });
$('retry').addEventListener('click', () => newRun(state.seed));
$('new-random').addEventListener('click', () => newRun());
$('new-seeded').addEventListener('click', () => {
  const input = $('seed') as HTMLInputElement;
  if (!/^\d{1,10}$/.test(input.value.trim()) || Number(input.value) > 4294967295) { input.setCustomValidity('Enter a whole-number seed from 0 to 4294967295.'); input.reportValidity(); return; }
  input.setCustomValidity(''); newRun(Number(input.value));
});
$('seed').addEventListener('input', () => ($('seed') as HTMLInputElement).setCustomValidity(''));
($('seed') as HTMLInputElement).value = String(state.seed);
window.addEventListener('storage', e => {
  if (e.key !== SAVE_KEY) return;
  const current = readSave();
  if (current && current.token !== knownToken) { state = current.state; knownToken = current.token; clearSelection(); savedMessage = 'Synced with the run in another tab.'; render(); }
});
window.addEventListener('keydown', event => {
  if (event.repeat || (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) return;
  const key = event.key.toLowerCase();
  if (key === 'escape') { clearSelection(); render(); return; }
  if ((key === 'f' || key === 'a') && canBeginAttack(state)) { event.preventDefault(); dispatch({ type: 'beginAttack' }); return; }
  if (/^[1-3]$/.test(key) && !event.code.startsWith('Numpad')) {
    const ability = availableAbilities(state)[Number(key) - 1];
    if (ability) { event.preventDefault(); choose(ability); }
    return;
  }
  if (!selectedAbility) return;
  const directions: Record<string, Point> = { arrowup: { x: 0, y: -1 }, arrowdown: { x: 0, y: 1 }, arrowleft: { x: -1, y: 0 }, arrowright: { x: 1, y: 0 }, Numpad8: { x: 0, y: -1 }, Numpad2: { x: 0, y: 1 }, Numpad4: { x: -1, y: 0 }, Numpad6: { x: 1, y: 0 }, Numpad7: { x: -1, y: -1 }, Numpad9: { x: 1, y: -1 }, Numpad1: { x: -1, y: 1 }, Numpad3: { x: 1, y: 1 } };
  const d = directions[event.code] ?? directions[key];
  if (d) {
    event.preventDefault();
    const base = ['light', 'deflect'].includes(selectedAbility) ? state.player : cursor ?? state.player;
    cursor = { x: Math.max(0, Math.min(SIZE - 1, base.x + d.x)), y: Math.max(0, Math.min(SIZE - 1, base.y + d.y)) };
    target = validTargets(state, selectedAbility).some(p => eq(p, cursor!)) ? cursor : null;
    feedback = target ? '' : 'That tile is not a legal target.';
    render();
  } else if (key === 'enter' && target) { event.preventDefault(); dispatch({ type: 'act', ability: selectedAbility, target }); }
});
// QA boundary: state is copied on read, and dispatch uses the same validated
// commands as visible controls. This does not expose mutation of live state.
Object.defineProperty(window, 'combatDebug', { value: Object.freeze({ getState: () => structuredClone(state), dispatch: (command: Command) => dispatch(command) }), writable: false });
if (!initialSave || needsCurrentSave) save();
render();

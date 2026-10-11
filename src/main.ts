import './style.css';
import { createGame, execute, availableAbilities, validTargets, previewAction, canBeginAttack } from './engine';
import { pulse } from './geometry';
import { createBoard, type BoardFrame } from './board';
import { COSTS, GUARD, MAX_ATTUNEMENT, SIZE, THRESHOLD, TOTAL_ROOMS, type Ability, type Command, type Enemy, type GameState, type Point } from './model';

import { parseSaveRecord, type SaveRecord } from './save';

const SAVE_KEY = 'grid-combat-prototype.v1';
const eq = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const coordinate = (p: Point) => `${String.fromCharCode(65 + p.x)}${p.y + 1}`;
const names: Record<Ability, string> = { quickstep: 'Quickstep', dash: 'Dash', deflect: 'Deflect', strike: 'Strike', focus: 'Focus', shift: 'Shift', break: 'Break', core: 'Core', core2: 'Core ×2' };
const descriptions: Record<Ability, string> = {
  quickstep: 'Move one tile to an open adjacent square.',
  dash: 'Move along a clear row, column, or diagonal to an empty tile.',
  deflect: 'Choose the middle of a three-tile arc. Counter all attacks from those directions, including Heavy.',
  strike: `Deal ${GUARD.strike} Guard damage in a three-tile arc. Its center direction counters non-Heavy attacks.`,
  focus: `Gain 1 attunement, up to ${MAX_ATTUNEMENT}. Do nothing else.`,
  shift: 'Spend 1 charge. Move along a clear row, column, or diagonal.',
  break: `Spend 2 charge. Deal ${GUARD.break} Guard damage in a three-tile arc.`,
  core: 'Spend 1 charge. Take 1 HP from an adjacent breached enemy; remove it until this attack turn ends.',
  core2: 'Spend 3 charge. Take 2 HP from an adjacent breached enemy; remove it until this attack turn ends.',
};
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <main class="shell">
    <header class="topline"><h1>Combat prototype</h1><span id="run-label"></span></header>
    <div class="status-strip" id="status" aria-label="Run status"></div>
    <div class="play-layout">
      <section class="board-column" aria-label="Playfield">
        <div id="board" class="board"></div>
        <div class="board-options"><label><input type="checkbox" id="threats" checked> Enemy attack tiles</label><label id="pulse-option"><input type="checkbox" id="pulse-preview"> Pulse reach</label></div>
        <p class="legend"><span><b>P</b> player</span><span>L / S / H enemies</span><span>▬ Guard</span><span class="hp-key">● HP</span><span class="pink">■ opening</span><span class="yellow">■ breached</span></p>
        <p class="board-note" id="board-note"></p>
      </section>
      <section class="controls" aria-label="Combat controls">
        <div class="turn-heading"><h2 id="phase-title"></h2><span id="time-label"></span></div>
        <ol class="steps" id="steps" aria-label="Action order"><li>1 <span>Quickstep</span></li><li>2 <span>Dash / Strike / Focus</span></li><li>3 <span>Deflect / Strike / Focus</span></li></ol>
        <div id="abilities" class="abilities"></div>
        <p id="instruction" class="instruction" role="status" aria-live="polite"></p>
        <div id="target-controls" class="target-controls"><button id="confirm" class="primary" disabled>Confirm</button><button id="cancel" class="quiet">Cancel</button></div>
        <div id="phase-controls" class="phase-controls"></div>
        <div id="attack-controls" class="attack-controls"></div>
        <section class="inspection" aria-label="Selected enemy"><div class="inspect-heading"><h3 id="inspect-title">Inspect</h3><button id="clear-inspect" class="text-button" hidden>Clear</button></div><div id="inspect-vitals"></div><p id="inspect-info">Tap an enemy to see its movement and attack.</p></section>
        <div class="log" aria-live="polite" aria-label="Recent events"><p id="log1"></p><p id="log2"></p></div>
      </section>
    </div>
    <p id="save-note" class="save-note" role="status"></p>
    <div class="details-row">
      <details><summary>Rules & controls</summary><div class="rules">
        <p><strong>Each turn:</strong> take actions 1, 2, and 3 in order. Then select <strong>Resolve enemies</strong>. Enemies act only after all three actions. Inspecting and choosing targets is free.</p>
        <p><strong>Movement:</strong> Quickstep moves to any open adjacent tile, including diagonally past a corner. If none is open, you can skip that slot without gaining attunement. Dash and Shift follow a clear row, column, or diagonal. Units and walls block Dash and Shift, and neither can cut a blocked diagonal corner.</p>
        <p><strong>Arcs:</strong> choose the middle adjacent tile. An arc covers that neighbor and the neighbor on either side. Strike damages Guard by ${GUARD.strike} and counters only non-Heavy attacks from its center direction. Deflect counters all attacks in its arc, including Heavy. Both remain active until enemy resolution and move with you.</p>
        <p><strong>Focus:</strong> available only in actions 2 and 3. +1 attunement up to ${MAX_ATTUNEMENT}, and nothing else. At ${THRESHOLD}+ attunement, start an attack turn at any decision point. It freezes time, spends all banked attunement into charge, and pulses once. Ending it discards unused charge and resumes your exact action slot.</p>
        <p><strong>Pulse:</strong> radial line of sight, ${GUARD.pulse} Guard damage. Pink openings breach instantly. Walls and enemies whose Guard survives cast shadows; breached enemies let the pulse pass through. The reach preview shows the exact resulting visibility, including enemies the pulse will breach.</p>
        <p><strong>Combo:</strong> Shift costs 1 for a queen move; Break costs 2 for ${GUARD.break} Guard damage in an arc; Core costs 1 for 1 HP; Core ×2 costs 3 for 2 HP. Core requires an adjacent breached enemy. A core hit restores armor and removes that enemy until this attack turn ends.</p>
        <p><strong>Armor:</strong> Guard protects all HP. The bar shows remaining integer Guard. Red dots beneath its right end show HP; empty dots are lost HP. A breach interrupts and stuns through the next enemy resolution. Unbreached Guard regenerates by ${GUARD.regen} per resolution. Breached Guard restores after the stun. No regeneration or enemy movement occurs during an attack turn.</p>
        <p><strong>Enemy types:</strong> L = Lunge, S = Sweep, H = Heavy. Tap a unit to inspect its exact planned destination and attack tiles. Pink means an opening. Yellow means breached. An outline marked “return” shows an enemy removed until the attack turn ends.</p>
        <p><strong>Run:</strong> clear ${TOTAL_ROOMS} small seeded arenas. Recover 3 HP between arenas. Zero HP ends the run. Your current run saves automatically in this browser.</p>
        <p><strong>Touch:</strong> choose an action, tap a highlighted tile, then confirm. Focus is immediate. <strong>Keyboard:</strong> 1–4 select an ability; arrows or numpad move the target cursor; Enter confirms; F focuses; A starts an attack turn; Escape cancels. Enemy inspection is also available below.</p>
        <details><summary>Enemy list</summary><div id="enemy-list" class="enemy-list"></div></details>
      </div></details>
      <details><summary>Run & seed</summary><div class="run-settings"><label for="seed">Seed</label><input id="seed" inputmode="numeric" pattern="[0-9]*" maxlength="10" aria-label="Run seed"><button id="new-seeded">Start seed</button><button id="retry">Restart same seed</button><button id="new-random">New random run</button><p>Starting or restarting replaces this browser’s saved run.</p></div></details>
    </div>
  </main>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function readSave(): SaveRecord | null {
  try { return parseSaveRecord(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
const initialSave = readSave();
let state = initialSave?.state ?? createGame();
let knownToken = initialSave?.token ?? null;
let selectedAbility: Ability | null = null;
let target: Point | null = null;
let cursor: Point | null = null;
let inspectId: number | null = null;
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
  return { state, ability: selectedAbility, target, cursor, valid: selectedAbility ? validTargets(state, selectedAbility) : [], preview: selectedAbility && target ? previewAction(state, selectedAbility, target) : [], inspectId, showThreats, pulsePreview: showPulsePreview && canBeginAttack(state) ? pulseCache?.value ?? null : null };
}
const board = createBoard($('board'), frame, p => {
  const enemy = state.enemies.find(e => eq(e, p) && e.hp > 0);
  if (enemy) inspectId = enemy.id;
  if (selectedAbility) {
    cursor = p;
    if (validTargets(state, selectedAbility).some(v => eq(v, p))) { target = p; feedback = ''; }
    else { target = null; feedback = 'Choose a highlighted tile.'; }
  } else if (!enemy) inspectId = null;
  render();
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
  if (ability === 'focus') { dispatch({ type: 'act', ability }); return; }
  if (!availableAbilities(state).includes(ability)) return;
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
  return `<div class="unit-vitals"><div class="guard-meter" role="meter" aria-label="Guard" aria-valuemin="0" aria-valuemax="${e.maxGuard}" aria-valuenow="${e.guard}"><span class="guard-fill" style="width:${e.guard / e.maxGuard * 100}%"></span><span class="guard-value">${e.guard} / ${e.maxGuard}</span></div><div class="enemy-hp">${hpDots(e.hp, e.maxHp)}</div></div>`;
}
function inspection(e: Enemy) {
  if (e.removed) return `Guard restored. Removed for this attack turn; returns when it ends.`;
  let text = '';
  if (e.breached) text += 'BREACHED: core exposed, intention interrupted. Stunned through the next enemy resolution.';
  else {
    if (e.opening) text += 'OPENING: pulse breaches instantly. ';
    if (e.intent) text += `${e.intent.label}${e.intent.heavy ? ' (Heavy)' : ''}. ${eq(e, e.intent.destination) ? `Stays at ${coordinate(e)}.` : `Moves ${coordinate(e)} → ${coordinate(e.intent.destination)}.`} Hits ${e.intent.tiles.length ? e.intent.tiles.map(coordinate).join(', ') : 'no tiles'}.`;
    else text += 'No attack planned. Intention interrupted.';
  }
  return text;
}
function render() {
  const attack = state.phase === 'attack';
  const blockedStep = state.phase === 'normal' && state.slot === 0 && validTargets(state, 'quickstep').length === 0;
  $('run-label').textContent = `Arena ${state.room}/${TOTAL_ROOMS} · Turn ${state.round}`;
  $('status').innerHTML = `<span class="player-health">HP ${hpDots(state.player.hp, state.player.maxHp)}</span><span>${attack ? 'Charge' : 'Attunement'} <strong>${attack ? state.charge : state.player.attunement}<small> / ${MAX_ATTUNEMENT}${attack ? '' : ` · ${THRESHOLD}+ to attack`}</small></strong></span><span>Enemies <strong>${state.enemies.filter(e => e.hp > 0).length}</strong></span>`;
  const phaseTitles: Record<GameState['phase'], string> = { normal: `Action ${state.slot + 1} of 3`, resolve: 'Enemy resolution', attack: 'Attack turn', cleared: 'Arena cleared', won: 'Run complete', lost: 'Run ended' };
  $('phase-title').textContent = phaseTitles[state.phase];
  $('time-label').textContent = attack ? 'TIME FROZEN' : state.phase === 'normal' || state.phase === 'resolve' ? 'YOUR DECISION' : '';
  $('time-label').classList.toggle('frozen', attack);
  $('steps').hidden = !['normal', 'resolve', 'attack'].includes(state.phase);
  Array.from($('steps').children).forEach((item, i) => { item.className = i < state.slot ? 'done' : i === state.slot ? 'current' : ''; item.setAttribute('aria-current', i === state.slot ? 'step' : 'false'); });
  const actions = availableAbilities(state);
  const abilities = $('abilities'); abilities.replaceChildren();
  for (const ability of actions) {
    const cost = COSTS[ability];
    const b = button(`${names[ability]}${cost ? ` · ${cost}` : ability === 'focus' ? (state.player.attunement >= MAX_ATTUNEMENT ? ' · MAX' : ' · +1') : ''}`, () => choose(ability), selectedAbility === ability ? 'selected' : '', (ability === 'quickstep' && blockedStep) || (cost !== undefined && state.charge < cost));
    b.setAttribute('aria-pressed', String(selectedAbility === ability));
    b.title = descriptions[ability];
    abilities.append(b);
  }
  let instruction = '';
  if (feedback) instruction = feedback;
  else if (selectedAbility) instruction = target ? `${names[selectedAbility]} → ${coordinate(target)}. ${['strike', 'deflect', 'break'].includes(selectedAbility) ? 'Highlighted tiles form the arc. ' : ''}Confirm to commit.` : descriptions[selectedAbility] + ' Tap a target.';
  else if (blockedStep) instruction = 'No adjacent tile is open. Skip this slot without gaining attunement.';
  else if (state.phase === 'normal') instruction = 'Choose an action. Enemies wait until all three actions are complete.';
  else if (state.phase === 'resolve') instruction = 'All three actions are complete. Resolve enemy intentions, or start an attack turn first.';
  else if (attack) instruction = `${state.charge} charge available. Link actions; unused charge is lost when you end this attack turn.`;
  else if (state.phase === 'cleared') instruction = 'All enemies are defeated. Continue to the next arena and recover 3 HP.';
  else if (state.phase === 'won') instruction = 'All five arenas cleared. Start a new run or retry the same seed below.';
  else instruction = 'You have no HP remaining. Restart the same seed or start a new run below.';
  $('instruction').textContent = instruction;
  $('target-controls').hidden = !selectedAbility;
  $('confirm').textContent = target && selectedAbility ? `Confirm ${names[selectedAbility]}` : 'Select a target';
  ($('confirm') as HTMLButtonElement).disabled = !target;
  $('phase-controls').replaceChildren();
  if (blockedStep) $('phase-controls').append(button('Skip blocked Quickstep', () => dispatch({ type: 'skipStep' }), 'wide'));
  if (state.phase === 'resolve') $('phase-controls').append(button('Resolve enemies', () => dispatch({ type: 'resolve' }), 'primary wide'));
  if (state.phase === 'cleared') $('phase-controls').append(button('Next arena · +3 HP', () => dispatch({ type: 'nextRoom' }), 'primary wide'));
  if (state.phase === 'lost' || state.phase === 'won') $('phase-controls').append(button('Restart same seed', () => newRun(state.seed), 'primary wide'));
  $('attack-controls').replaceChildren();
  if (attack) $('attack-controls').append(button(`End attack${state.charge ? ` · lose ${state.charge} charge` : ''}`, () => dispatch({ type: 'endAttack' }), 'wide'));
  else if (state.phase === 'normal' || state.phase === 'resolve') $('attack-controls').append(button(canBeginAttack(state) ? `Attack turn · use ${state.player.attunement}` : `Attack turn · needs ${THRESHOLD} attunement`, () => dispatch({ type: 'beginAttack' }), 'attack-button wide', !canBeginAttack(state)));
  const enemy = state.enemies.find(e => e.id === inspectId && e.hp > 0);
  $('inspect-title').textContent = enemy ? `${enemy.kind[0].toUpperCase()}${enemy.id} · ${enemy.kind[0].toUpperCase()}${enemy.kind.slice(1)}` : 'Inspect';
  $('inspect-vitals').innerHTML = enemy ? unitVitals(enemy) : '';
  $('inspect-info').textContent = enemy ? inspection(enemy) : 'Tap an enemy to see its movement and attack.';
  $('clear-inspect').hidden = !enemy;
  const recent = state.log.slice(0, 2);
  $('log1').textContent = recent[0] ?? '';
  $('log2').textContent = recent[1] ?? '';
  $('save-note').textContent = savedMessage;
  $('pulse-option').hidden = !canBeginAttack(state);
  $('board-note').textContent = attack && state.pulse ? `Pulse: ${state.pulse.hitIds.length} hit · ${state.pulse.breachedIds.length} breached. Shading shows its original shadow.` : showPulsePreview && canBeginAttack(state) ? 'Pulse preview: dark tiles are occluded. Small blue dots mark enemies it will hit.' : enemy?.intent ? 'White line: selected enemy’s planned move. Crosses: its attack tiles.' : 'Crosses mark enemy attack tiles. Tap an enemy for its planned move.';
  $('enemy-list').replaceChildren(...state.enemies.filter(e => e.hp > 0).map(e => {
    const b = button(`${e.kind[0].toUpperCase()}${e.id}`, () => { inspectId = e.id; render(); });
    b.insertAdjacentHTML('beforeend', unitVitals(e));
    return b;
  }));
  board.redraw();
}
function newRun(seed?: number) {
  state = createGame(seed); inspectId = null; clearSelection(); showPulsePreview = false; ($('pulse-preview') as HTMLInputElement).checked = false;
  save(); ($('seed') as HTMLInputElement).value = String(state.seed); render();
}
$('confirm').addEventListener('click', () => { if (selectedAbility && target) dispatch({ type: 'act', ability: selectedAbility, target }); });
$('cancel').addEventListener('click', () => { clearSelection(); render(); });
$('clear-inspect').addEventListener('click', () => { inspectId = null; render(); });
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
  if (key === 'f' && availableAbilities(state).includes('focus')) { event.preventDefault(); choose('focus'); return; }
  if (key === 'a' && canBeginAttack(state)) { event.preventDefault(); dispatch({ type: 'beginAttack' }); return; }
  if (/^[1-4]$/.test(key) && !event.code.startsWith('Numpad')) {
    const ability = availableAbilities(state).filter(a => a !== 'focus')[Number(key) - 1];
    if (ability) { event.preventDefault(); choose(ability); }
    return;
  }
  if (!selectedAbility) return;
  const directions: Record<string, Point> = { arrowup: { x: 0, y: -1 }, arrowdown: { x: 0, y: 1 }, arrowleft: { x: -1, y: 0 }, arrowright: { x: 1, y: 0 }, Numpad8: { x: 0, y: -1 }, Numpad2: { x: 0, y: 1 }, Numpad4: { x: -1, y: 0 }, Numpad6: { x: 1, y: 0 }, Numpad7: { x: -1, y: -1 }, Numpad9: { x: 1, y: -1 }, Numpad1: { x: -1, y: 1 }, Numpad3: { x: 1, y: 1 } };
  const d = directions[event.code] ?? directions[key];
  if (d) {
    event.preventDefault();
    const base = ['strike', 'deflect', 'break', 'core', 'core2', 'quickstep'].includes(selectedAbility) ? state.player : cursor ?? state.player;
    cursor = { x: Math.max(0, Math.min(SIZE - 1, base.x + d.x)), y: Math.max(0, Math.min(SIZE - 1, base.y + d.y)) };
    target = validTargets(state, selectedAbility).some(p => eq(p, cursor!)) ? cursor : null;
    feedback = target ? '' : 'That tile is not a legal target.';
    render();
  } else if (key === 'enter' && target) { event.preventDefault(); dispatch({ type: 'act', ability: selectedAbility, target }); }
});
// QA boundary: state is copied on read, and dispatch uses the same validated
// commands as visible controls. This does not expose mutation of live state.
Object.defineProperty(window, 'combatDebug', { value: Object.freeze({ getState: () => structuredClone(state), dispatch: (command: Command) => dispatch(command) }), writable: false });
if (!initialSave) save();
render();

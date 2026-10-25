# Grid combat prototype

Version 0.7 is a minimal, touch-friendly combat prototype on a **7 × 7 grid**. It uses placeholder units, a TypeScript simulation, a Phaser board, and plain HTML controls. There is no setting or flavor.

## Play

[Open the game](https://qpxjfnty.github.io/grid-combat-prototype/) in a browser, including Safari on iPad. Select an action, tap a highlighted tile, then confirm. Each normal action is followed immediately by the enemies’ response. Every arena starts you on **D4**, the middle tile, with its eight neighboring tiles clear.

| Normal action | Effect | Charge |
| --- | --- | --- |
| Dash | Move to an empty tile along a clear row, column, or diagonal. | No cost or gain |
| Light Attack | Hit three adjacent tiles: 2 Guard on the center tile, 1 on each side. Parry normal attacks from all three arc directions and every enemy hit, even if it moves. Each hit or parried enemy skips its Guard recovery for this response. Heavy attacks require Deflect. | +2 once if it hits or parries any enemy, capped at 10 |
| Deflect | Block attacks from five adjacent directions, including Heavy. Deals no damage. | Costs 1; requires at least 1 |

At **3 or more charge**, use **Freeze** before committing another normal action. All banked charge becomes the frozen attack budget, and a radial pulse hits visible enemies for 5 Guard. Pink openings breach instantly. Walls and surviving armor cast shadows; breached enemies let the pulse pass through.

While frozen, the only action is **Dash Attack**, costing **1 charge**. Move along a clear queen line, then attack the three neighbors ahead of the landing tile. The movement direction fixes the attack direction. Each target takes 5 Guard, or loses 1 HP if it was already breached. A hit that breaches Guard does not also damage HP. Core-hit survivors leave combat until Freeze ends and return with restored armor.

**Resume time** discards unused budget and resumes normal play without advancing enemy time. You start with **3 HP**, and every unblocked enemy hit deals **1 damage**, including Heavy attacks. Separate enemies can each hit during one response. Clear five arenas without losing all HP; continuing to the next arena restores HP to 3.

## Read the board

Guard appears as a continuous bar with integer current/max values. Red dots beneath its right edge show enemy HP; player HP also uses red dots. Lunge starts with 5 Guard and 1 HP, Sweep with 15 Guard and 2 HP, and Heavy with 20 Guard and 3 HP.

Action colors match their targeting previews: muted green for Dash, light beige for Light Attack, sky blue for Deflect, pink for Freeze, and gold for Dash Attack. Bright pink enemy outlines mark openings; yellow marks breached armor.

Straight dashed arrows show ground dashes; upward-curving dashed arrows show jumps. Both connect each enemy to its planned landing tile. Solid arrows continue forward into its attack tiles. The Heavy’s burst rays start at a marked impact tile. Matching enemy IDs identify the source, including when attacks overlap; ! marks Heavy attacks. Hover or tap an enemy or threatened tile to emphasize related plans. Plans are hidden during Freeze so the Dash Attack preview stays clear.

Dashes check only the tiles they cross: neighboring enemies or walls do not block an open diagonal. Lunge and Sweep use the same ground-path rule. Heavy uses a four-turn combo: jump to an empty tile and hit all eight neighbors (pink opening), advance up to one tile into a wide sweep, advance up to one tile into an adjacent-impact burst, then recover. It aims again between steps; each displayed step stays fixed while you respond. The burst extends three tiles in eight directions from its impact, with only the Heavy itself blocking its ray. All Heavy attack footprints pass through walls and other enemies. Its small 1/4–4/4 marker and inspection text show progress. Moving attacks always face the direction of travel. Enemies only plan an attack that reaches your current tile; otherwise they reposition without attacking. Their shown plans stay fixed, so moving out of the footprint makes them miss.

Light covers all three tiles with its parry; the center marker identifies its higher Guard damage. Response text names which enemies were parried, deflected, or dealt damage. Hover or tap a tile to inspect its contents, enemy arrivals, and planned attacks. Hovering never changes your action target or advances time. Controls, detailed rules, and display options are collapsed under **Controls & rules**; seed and restart options are under **Run**.

Runs save automatically in the current browser, including during Freeze. Existing version 3–5 runs retain progress and use the 3-HP cap. Heavy intentions refresh once for the combo; canceled intentions stay canceled. Version 5 Lunge/Sweep intentions remain fixed. Version 7 uses separate storage so older open tabs cannot overwrite the updated run. Version 6 saves retain their combo step, direction, and landing, with Heavy footprints expanded through walls. Reload preserves the exact updated state. Older version 1 and 2 saves remain untouched and are not converted from their 9 × 9 rules.

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
npm test
npm run build
```

- `src/model.ts`: serializable state and tuning constants.
- `src/geometry.ts`: movement, arcs, and radial pulse visibility.
- `src/engine.ts`: deterministic combat, enemy intentions, generation, and progression.
- `src/main.ts`, `src/board.ts`, `src/style.css`: browser controls and rendering.
- `src/save.ts`: saved-state validation.
- `tests/`: combat, geometry, and persistence tests.
- [DESIGN.md](DESIGN.md): precise rules and balance assumptions.
- [QA.md](QA.md): recorded verification and its limitations.

The GitHub Actions workflow tests and builds main-branch updates, then deploys the static game to GitHub Pages. Vite uses relative asset paths for project-site hosting. The game requires no account, server, telemetry, or remote assets.

For local QA, `window.combatDebug` provides a copied state and normal command dispatch. The simulation does not depend on the renderer or animation timing.

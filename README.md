# Grid combat prototype

A small, touch-friendly roguelike combat prototype. Fresh TypeScript simulation, Phaser board, plain HTML controls, placeholder units, no setting or flavor.

## Play

[Open the game](https://qpxjfnty.github.io/grid-combat-prototype/). On iPad, open the link in Safari. Nothing to install. The current run saves automatically in this browser, including mid-combo. Browser storage may be unavailable in private sessions.

Select an action, tap a highlighted tile, then confirm. Focus takes effect immediately. Tap an enemy to inspect its Guard, life, opening, and next attack. Marked attack tiles show where the enemies will hit after the three action slots; movement destinations show their gap closers.

1. Quickstep or Focus.
2. Dash, Strike, or Focus.
3. Deflect, Strike, or Focus.

Enemies wait until **Resolve enemies**. Strike counters and Deflect persist through that resolution. The extra confirmation allows an attack-turn interrupt after the third action too.

At **4 attunement**, use Attack turn at any decision point. The opening pulse takes 1 Guard from exposed enemies, instantly breaches pink openings, and passes through breached enemies. Intact armor and walls cast angular shadows. Spend the bank on Shift, Break, Core, and Core ×2. End attack discards unused charge and returns to the same action slot. A core-hit survivor leaves the board until the phase ends and returns with restored armor.

Clear five seeded arenas without losing all HP. Next arena restores 3 HP. New-run controls let you replay a seed. Rules are also available inside the game.

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
- `src/engine.ts`: deterministic combat, enemy intentions, generation, progression.
- `src/main.ts`, `src/board.ts`, `src/style.css`: browser controls and rendering.
- `tests/combat.test.ts`: combat and geometry regression tests.
- [DESIGN.md](DESIGN.md): exact rules and prototype assumptions.
- [QA.md](QA.md): verification and limitations.

The GitHub Actions workflow tests and builds every main-branch update, then deploys the static game to GitHub Pages. Vite uses relative asset paths for project-site hosting. No account, server, telemetry, or remote assets are required by the game.

For local QA, `window.combatDebug` provides a copied state and normal command dispatch. The simulation does not depend on the renderer or animation timing.

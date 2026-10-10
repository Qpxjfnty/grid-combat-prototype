# Combat prototype rules, version 0.1

Fresh implementation. No setting, story, decorative assets, or inherited game code.

## Confirmed timing

The player takes three actions, in order: Quickstep/Focus; Dash/Strike/Focus; Deflect/Strike/Focus. **Enemies act only after all three actions**, as requested. There is an explicit Resolve enemies step after the third action so an offensive turn remains possible before resolution. Planning and inspection never advance time.

Strike counters and Deflect remain active until enemies resolve. Their selected directions are relative to the player's current position. Multiple Strike center directions are retained. An offensive turn freezes and resumes the exact slot, defense state, and existing enemy intentions. It never advances enemy time.

## Spatial rules

9 × 9 playable tiles. Eight adjacent directions, including diagonals. A three-tile arc is three consecutive neighbors among those eight; select its center direction. Quickstep moves to any open adjacent tile, including diagonally between obstacles. Dash/Shift move along a clear queen line to an empty tile. Walls and active enemies block traversal; Dash/Shift cannot cut a blocked corner. Deflect stops every attack approaching from its three directions, including Heavy. Strike counters only non-Heavy attacks from its center direction. Avoiding a Heavy attack's marked tiles is also allowed; breaching its attacker interrupts it.

Strike deals 2 Guard to each enemy in its arc. Successful counters deal 2 Guard. Normal actions never damage life. Deflect has no proactive damage. Focus only adds 1 attunement.

## Offensive phase

At 4 or more attunement, enter at any decision point, including before enemy resolution. Transfer all attunement to temporary charge, set attunement to zero, and emit a pulse. Charge remaining when the phase ends is lost. No enemies move, attack, recover, regenerate, or change intentions while time is frozen.

Pulse expands radially in all directions. Occlusion uses angular intervals subtended by whole tile footprints, not eight rays. Walls block. Enemies are processed near to far; a visible armored enemy takes 1 Guard. A pink enemy is instantly breached. Already-breached or newly-breached enemies do not block the pulse. Surviving armor casts a full tile-width angular shadow. A partially visible tile is reachable if any nonzero angular interval is exposed.

Prototype combo actions: Shift costs 1 (queen move); Break costs 2 (3 Guard to a three-tile arc); Core costs 1 (1 life from an adjacent breached enemy); Core ×2 costs 3 (2 life). Core hits remove the target for the rest of that offensive phase and restore its armor. Removed enemies do not block movement or pulse. Survivors return at phase end to their tile or the nearest available tile if occupied. Their interrupted intentions stay canceled until the next enemy planning step.

## Enemies and run

Placeholder Lunge, Sweep, and Heavy units move and attack in small arenas. Their exact destination and attack tiles are marked before the player's actions. Lunge closes distance; Sweep hits an arc; Heavy hits a larger area and cannot be stopped by Strike counters. Openings occur in predictable recovery cycles and are bright pink.

Guard regenerates by 2 per enemy resolution when unbreached. Breach cancels the current intention and stuns through the next enemy resolution, after which Guard restores. A breach never directly damages life. Enemies lose only 1 or 2 life per core hit and cannot be hit again during the same offensive phase.

Five seeded arenas, increasing enemy count, permadeath, restart, and automatic browser-local save. Clear an arena to recover 3 HP (up to maximum) and advance. No progression upgrades in this combat-focused slice. Seeded layouts keep open connectivity and usable space around the player. Initial balance numbers are playtest assumptions.

## Implementation and validation

TypeScript simulation independent of Phaser; canvas board and DOM controls. Tap action, tap target, confirm. Large touch controls, no hover dependency, responsive portrait/landscape layout. Pulse preview and explicit enemy details support rule verification. Vitest is unnecessary: deterministic tests run through Node's test runner with tsx. Verify mobile input and rendering in browsers, distinguish emulation from actual physical iPad testing. GitHub Pages publishes the static production build.

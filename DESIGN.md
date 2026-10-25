# Combat prototype rules, version 0.5

A fresh, placeholder-only combat prototype with a minimal interface. This version uses a 7 × 7 arena and one normal action per turn.

## Turn structure

Choose **Dash**, **Light Attack**, or **Deflect**. Confirming a legal action commits it and immediately resolves the enemies’ advertised intentions. There are no action slots or separate Resolve enemies button. Quickstep, Focus, and the previous frozen combo abilities are absent.

Target selection, previews, hover, and tap inspection are free. Enemies show their intended movement destination and attack tiles before the player acts. Light Attack’s parry and Deflect’s protection apply to the response immediately following that action, then expire.

At a normal decision point with at least 3 banked charge, the player may enter Freeze before committing an action. A normal action and its enemy response resolve together; Freeze cannot interrupt between them. Entering, acting during, and ending Freeze never advance enemy time. Existing enemy intentions remain fixed unless a breach or core hit cancels them.

## Grid and movement

The playfield is 7 × 7, with eight neighboring directions. Dash follows a clear queen line: any horizontal, vertical, or 45-degree diagonal distance to an empty tile. Walls and active enemies block the path and destination. Diagonal movement cannot cut a blocked corner. Dash Attack uses the same movement restrictions and must actually move.

An attack arc consists of consecutive neighboring tiles around its origin. Light Attack covers three neighbors; Deflect protects five neighboring directions. Select the middle adjacent direction to orient either. Walls are excluded from damage previews. Dash Attack’s three-tile arc originates at its landing tile and faces the actual movement direction, with no separate aiming step.

## Normal actions and charge

| Action | Effect | Charge rule |
| --- | --- | --- |
| Dash | Move along a clear queen line. No attack or defense is added. | No cost or gain |
| Light Attack | Deal 2 Guard to the center neighbor and 1 Guard to each side neighbor. Parries non-Heavy incoming attacks from the center direction only. | Gain 2 once if at least one enemy is hit, regardless of the number hit; bank cannot exceed 10 |
| Deflect | Protect the selected direction and two neighboring directions on each side: five directions in total. Blocks all incoming attacks from those directions, including Heavy. | Spend 1 banked charge; unavailable at zero |

Light Attack never directly damages HP, including when it hits an already-breached enemy. A miss gives no charge. Its parry does not deal extra Guard or HP damage and gives no extra charge. Deflect deals no damage and generates no charge. Moving out of an attack’s marked footprint remains another way to avoid it.

The player starts with zero charge. The bank caps at 10, and Freeze requires a minimum of 3.

## Freeze and its entry pulse

Entering Freeze transfers the **entire bank** into a temporary attack budget and sets the normal bank to zero. It emits one radial pulse without deducting an additional charge. Ending Freeze loses all unused budget. It returns to a normal decision point without an enemy response or regeneration step.

The pulse radiates through 360 degrees. Visibility uses angular intervals subtended by whole tile footprints, rather than eight straight rays. Walls block it. Enemies are processed near to far:

- A visible armored enemy takes 5 Guard damage.
- A visible enemy with a bright pink opening breaches instantly, regardless of remaining Guard.
- Already-breached enemies and enemies breached by this pulse let it pass through.
- Armor that survives absorbs the pulse and casts a shadow behind its tile.
- A partially visible tile is reachable when a nonzero part of its angular interval remains exposed.

No enemies move, attack, recover, regenerate, or replan during Freeze. The pulse reach display and its shadow snapshot are inspection aids; they do not spend time or charge.

## Dash Attack

**Dash Attack is the only action during Freeze and costs 1 charge.** First move to a legal queen-line destination, then hit the three adjacent tiles facing along the movement direction. The preview shows the path, landing tile, and forward arc. Direction cannot be chosen independently of movement.

Each enemy in that arc resolves exactly one damage layer:

- If armored when this hit begins, take 5 Guard damage. Reaching zero breaches and interrupts the enemy, with no HP damage spilling through.
- If already breached when this hit begins, lose exactly 1 HP. Restore its armor and remove it from combat for the remainder of this Freeze.

For example, a target with 5 Guard is breached by one Dash Attack but loses no HP. A later Dash Attack that reaches its exposed core removes 1 HP. That target then cannot be hit again during the same Freeze.

Removed enemies do not block movement. A surviving enemy returns when Freeze ends, at its former tile or the nearest available tile if that tile is occupied. Its canceled intention stays canceled until the next normal enemy planning step. Enemies at zero HP are defeated permanently. At zero frozen budget, the player must End Freeze; there is no free movement or attack.

## Armor, enemies, and recovery

| Placeholder | Starting Guard | HP | Attack |
| --- | ---: | ---: | --- |
| Lunge | 5 | 1 | Ground dash up to 3 tiles, then a forward two-tile line; 1 damage |
| Sweep | 15 | 2 | Ground dash up to 2 tiles into a forward three-tile arc; 1 damage |
| Heavy | 20 | 3 | Jump up to 2 tiles into a larger forward footprint; 1 damage; Light Attack cannot parry it |

Enemy gap closers move along rows, columns, or diagonals. Ground dashes need a clear path; jumps can cross walls, units, and the player, but must land on an empty non-wall tile. Every moving attack faces its direction of travel, with a forward footprint from its landing tile. It cannot turn back or aim independently after moving. Adjacent enemies can also attack from their current tile. Attack footprints respect walls.

At planning time, an enemy only commits an attack if the footprint can reach the player’s current tile. Otherwise it approaches without attacking, following a shortest legal route to a firing position when a detour is needed, or waits if it cannot advance. Earlier reserved landing tiles also block later ground paths and diagonal corners, so allies do not invalidate advertised movements. The move and attack resolve as one committed action. The destination and attack tiles stay fixed after the player acts: dodging can make the attack miss. Occupying its landing tile cancels the move and attack; blocking a ground path also cancels it, while a jump can clear the new obstruction.

Guard protects all HP. Breaching cancels the current intention and stuns the enemy through the next enemy response. At the end of that response, its Guard restores. Unbreached enemies regenerate **10 Guard per normal enemy response**, up to their maximum. Breaching itself never removes HP.

Openings follow enemy cycles and appear in bright pink. Breached enemies appear yellow. Core-hit survivors are shown as return markers until Freeze ends. Their Guard is a continuous depleting bar with integer current/max values. Red HP dots sit immediately beneath the bar’s right edge; hollow dark red dots indicate lost HP. The player also uses red HP dots.

## Run and interface

A run spans five seeded arenas. The player starts with a maximum of 3 HP. Every unblocked enemy attack deals exactly 1 HP, including Heavy attacks. Multiple enemies can each hit during one response; damage is per attacker, not per marked tile. Clearing an arena allows advancement and restores HP to 3. Later arenas increase the enemy count from three to five. Layout generation preserves connected open space and room around the starting tile. Zero HP ends the run. There are no progression upgrades in this combat slice.

The persistent interface contains the board, player HP and charge, available actions, and contextual targeting or inspection. Touch input uses action → target → confirm. Hover and tap inspection expose enemy Guard, HP, openings, destinations, and attack tiles without spending a turn. Detailed controls, rules, and display options are collapsed under Controls & rules; seed and restart controls are under Run.

Enemy plans are drawn by source. A straight dashed arrow shows a ground dash; a curved dashed arrow shows a jump. Both run from the enemy's current tile to its labeled landing marker. Solid attack arrows continue forward from that landing tile, with source IDs on attack tiles and ! for Heavy. Source colors and IDs stay consistent as enemies move. Overlapping threats retain each source label. Hovering or tapping an enemy emphasizes its plan; inspecting a threatened or landing tile emphasizes its related sources. Plans are hidden during frozen time, while inspection text remains available. Repositioning moves show only movement and landing markers, without attack tiles. Inspection identifies dash, jump, attack, or repositioning. Player action previews keep their separate functional colors.

Functional colors remain consistent between action buttons, selected states, confirmations, target markers, and previews:

| Action | Color |
| --- | --- |
| Dash | Muted green `#91ad94` |
| Light Attack | Muted light beige `#c5baa0` |
| Deflect | Muted sky blue `#91b4cb` |
| Freeze and its pulse | Muted pink `#c79cab` |
| Dash Attack | Gold `#d0b166` |

Enemy openings retain their distinct bright pink. The interface uses placeholders and functional state indicators, with no decorative assets or flavor.

## Persistence and implementation

Version 5 saves use a separate browser storage entry. Compatible version 3 and 4 runs retain their progress and migrate to the current rules. Current HP is capped at 3 and maximum HP is 3; zero HP stays zero. Arena progress, frozen budget, enemy positions/vitals, and pulse are preserved. Existing intentions are refreshed once to use forward attacks, jumps, or attack-free approaches; canceled intentions remain canceled. This migration does not advance time, including during Freeze. The old saves are left untouched, and older open tabs cannot overwrite version 5 progress. Version 1 and 2 saves remain untouched; their 9 × 9 runs are not migrated into this ruleset. Restarting replaces only the current version's saved run.

The TypeScript simulation is independent of Phaser. The board uses canvas; text and controls use the DOM. Responsive sizing preserves square tiles and updates pointer coordinates after resizing. Reduced-motion preferences suppress the pulse animation. GitHub Pages serves the static production build.

## Balance assumptions and validation scope

The action timing, action set, charge rules, damage layers, fixed movement-facing Dash Attack, 3 player HP, and uniform 1 incoming damage define this revision. Existing regeneration of 10 Guard per response is retained as prototype tuning, along with healing, arena count, enemy density, and enemy cycle timing. These tuning values still need playtesting.

Because regeneration exceeds Light Attack’s 1–2 Guard damage, Light Attack primarily builds charge and provides a narrow parry. Repeated normal attacks do not steadily wear down intact armor under the current tuning. An enemy already at sufficiently low Guard can still be breached by Light Attack. Whether this produces the intended rhythm between normal combat and Freeze is a balance question, not a verified result.

Regression tests should cover one-action enemy timing, charge costs and gains, five-direction Deflect, radial pulse occlusion, direction-fixed Dash Attack, no HP spill on breach, temporary enemy removal, and separate save versions. Browser review should cover touch and keyboard confirmation, hover inspection, action colors, readable vitals, and orientation changes. Emulated mobile browser checks must be distinguished from testing on a physical iPad. This document specifies behavior and validation targets; it makes no claim that this revision has passed those checks.

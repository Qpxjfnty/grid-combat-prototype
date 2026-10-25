# Verification

## Version 0.4 — 24 October 2026

- 52 combat and save checks pass, including 3 starting/max HP, exactly 1 damage per unblocked enemy attack, three-hit defeat, Heavy bypassing Light parries, Deflect protection, healing capped at 3, and validated version 3 save migration.
- WebKit iPad touch checks confirm a Heavy hit reduces HP from 3 to 2, leaves exactly one empty dot, and is blocked by the following Deflect. Restart restores exactly 3 HP.
- A version 3 frozen save migrates without changing its round or frozen budget, clamps 8/12 HP to 3/3, and relabels Heavy intentions to 1 damage. Migration is persisted immediately; subsequent writes by an older tab to the old key cannot overwrite the version 4 run.
- Visually inspected a five-enemy arena with overlapping threats at 834×1194: dashed movement arrows, source-labeled landing markers, solid attack arrows, source chips on threatened tiles, and focused-source emphasis are visible. Guard and HP stay readable. Inspections list each overlapping source and leave combat state unchanged.
- Enemy plan visibility toggle and frozen-time hiding were checked visually. Hovering during target selection preserves the intended Dash; confirming it matches the simulation exactly. Portrait/landscape layouts at 834×1194, 1194×834, and 768×1024 remain square without horizontal overflow. No browser page errors were observed.
- Production typecheck/build pass. Earlier balance witnesses used higher player HP and do not establish complete-run balance for this revision.

## Version 0.3 — 24 October 2026

- 47 combat and save checks pass. Coverage includes one normal action followed by immediate enemy response, zero-cost Dash, Light center/side damage and charge-on-hit, normal versus Heavy parries, five-direction Deflect, charge limits, the radial entry pulse, all eight Dash Attack directions, no HP spill on breach, core removal/return, and zero-budget rejection.
- Arena generation checks cover 48 seeds across all five arenas (240 layouts), with connected floors, valid 7×7 coordinates, and no overlapping occupants. The basic Lunge has 5 Guard and 1 HP.
- Desktop Chrome: action colors, 7×7 target mapping, enemy hover details, and normal Dash selection/confirmation match the simulation; selecting and inspecting targets does not advance time.
- WebKit iPad touch emulation: two Light attacks bank 4 charge while parrying, Deflect spends 1 and previews five tiles, Freeze transfers 3 charge and pulses, and only Dash Attack remains. Two directional dashes spend charge without advancing the round and land a core hit. Reload during Freeze preserves the complete state. Older save storage remains untouched.
- Tablet portrait and landscape checks (834×1194, 1194×834, and 768×1024) keep a square board without horizontal overflow. Screenshots of Deflect and the forward-facing Dash Attack were visually inspected. No page errors were observed. Production typecheck/build pass.
- A legal tactical simulation cleared the first two arenas on seed 731. Full five-arena balance is unverified. Retained 10-Guard regeneration means Light mainly builds charge; an isolated Heavy can make earning new charge costly because Light cannot parry it. No balance changes were made beyond the requested revision.

The earlier checks below are historical and do not establish balance or complete-run success for the new one-action rules.

## Version 0.2 baseline

Version 0.2 verified on 11 October 2026.

- Hover update: desktop Chrome checks cover enemies, player, walls, empty tiles, planned attacks, pin restoration on board exit/padding, and target confirmation after hover. Hover leaves combat state and saved state unchanged and does not rebuild action buttons. Screenshots were visually reviewed.
- WebKit iPad emulation verifies tap inspection, pointer hover, ignored touch-generated hover, pin restoration, and normal Quickstep target/confirmation. No horizontal overflow or page errors were observed.
- 54 combat and save tests pass, including threshold 3, cap 10, removal of Focus from Quickstep, larger integer Guard pools and proportional damage, saved-run migration, and a legally reached corner trap with the conditional blocked-step skip.
- WebKit iPad touch checks verify Quickstep-only slot 1 (including rejection of the F shortcut), two Focus actions banking 2, attack activation at 3, Focus clamping at 10, and no-reward skip when Quickstep is blocked.
- Existing saves retain run progress, migrate Guard exactly once, and clamp excess banked attunement/charge to 10. A browser reload confirms migration. Migrated runs use separate version-2 storage so an older open game tab cannot overwrite them.
- Guard 12/35 renders a proportional depleting bar. Enemy life is red dots aligned beneath its right edge. Player life is red dots in the HUD and on the board; depleted life is shown as empty dots.
- Visually inspected the updated board and inspection display at iPad portrait widths of 768 and 834 pixels. No horizontal overflow or browser console errors were observed. Production typecheck/build pass.

## Version 0.1 baseline

The following checks were performed on 10 October 2026, before the revised action and attunement rules:

- 44 deterministic combat/geometry tests pass. Coverage includes continuous pulse shadows and partial exposure, chained breaches, all interruption boundaries, Heavy versus normal counters, core removal/return, frozen time, invalid commands, and blocked gap closers.
- Arena generation checks cover 48 seeds across all five arenas (240 layouts), with connected floors and no overlapping occupants.
- A separate randomized simulation exercised 100 seeds and 10,435 legal commands, including 347 frozen-phase commands. No overlapping occupants, invalid resource values, mutation of input snapshots, or unintended enemy time advances were found.
- A tactical simulation cleared all five arenas on seed 731 using 327 legal commands, finishing with 8/12 HP. This verifies a legal complete run; it is not a claim that balance is final.
- Production typecheck and static build pass.
- WebKit with iPad Pro 11 touch emulation: Quickstep, Dash, Deflect, Focus, targeting without time passing, explicit enemy resolution, attack turn, exact save/reload during frozen time, and phase resume pass.
- Touch-driven combo fixture: pulse breach, Core ×2, Shift onto a removed enemy's tile, Break, Core, charge accounting, phase end, and safe enemy return all pass.
- Rotation between 768 × 1024, 834 × 1194, and 1194 × 834 keeps the board square, correctly maps touch targets, and produces no horizontal overflow. Grid cells remain at least 44 CSS pixels at these sizes. A canvas-height issue found during rotation was corrected and retested.
- WebKit reported no browser console errors during these checks.
- Desktop Chromium at 1280 × 800: keyboard Quickstep and Strike targeting/confirmation, retained counter direction, enemy inspection and movement preview, Focus, and explicit resolution pass. The board remains square, there is no horizontal overflow, and the final browser session reports zero errors and warnings.

The balance values in DESIGN.md are prototype assumptions. Physical iPad Safari testing has not been performed. Browser emulation does not establish device-specific performance or touchscreen ergonomics.

## Implementation references

The Phaser board uses [Scale Manager FIT](https://docs.phaser.io/api-documentation/3.90.0/class/scale-scalemanager). Deployment follows [GitHub Pages publishing-source guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

# Verification

Version 0.2 verified on 11 October 2026.

- 54 combat and save tests pass, including threshold 3, cap 10, removal of Focus from Quickstep, larger integer Guard pools and proportional damage, saved-run migration, and a legally reached corner trap with the conditional blocked-step skip.
- WebKit iPad touch checks verify Quickstep-only slot 1 (including rejection of the F shortcut), two Focus actions banking 2, attack activation at 3, Focus clamping at 10, and no-reward skip when Quickstep is blocked.
- Existing saves retain run progress, migrate Guard exactly once, and clamp excess banked attunement/charge to 10. A browser reload confirms migration.
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

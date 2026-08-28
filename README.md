# omarchy-sunsetr (mark.sunsetr)

Omarchy bar plugin: a night-light indicator and control surface for
[sunsetr](https://github.com/psi4j/sunsetr), driven by sunsetr's event
socket instead of polling. Replaces Omarchy's stock NightLight indicator.

- Icon color runs cool -> warm with sunsetr's live color temperature;
  opacity tracks gamma. Collapses to zero width at true peak daytime;
  hovering the bar's center section still peeks it in a fixed, muted state.
- **Left-click**: toggle (force day/night, or back to automatic).
- **Middle-click**: refresh.
- **Right-click**: open the info popup (status, period countdown, and an
  Auto/Day/Night switch).
- Forcing day/night fades in over `forceTransitionSeconds` (default 2s)
  instead of jumping instantly, using sunsetr's own per-preset `smoothing`/
  `startup_duration` fields.
- CLI (`sunsetr-nightlight`) for keybindings: `toggle|on|off|auto|status|start|stop|refresh`.

## Install

```
omarchy plugin add https://github.com/markallisongit/omarchy-sunsetr.git
cd ~/.config/omarchy/plugins/mark.sunsetr
bin/setup
```

`bin/setup` (idempotent, asks before changing anything - pass `--yes` to
skip prompts):

1. Creates the `day`/`night` sunsetr presets if missing (also happens
   lazily on first toggle, so this step isn't required before first use).
2. Symlinks `sunsetr-nightlight` into `~/.local/bin`.
3. Removes the stock `NightLight` indicator from `~/.config/omarchy/shell.json`.
4. Adds a `trigger.toggle.nightlight` menu override pointing at
   `sunsetr-nightlight toggle`.
5. Enables the plugin (`omarchy plugin enable mark.sunsetr`) if not already
   enabled.

Every file it edits gets a `.bak.sunsetr.<timestamp>` copy first.

## Uninstall

```
bin/setup --uninstall
omarchy plugin remove mark.sunsetr
```

Reverses all of the above from the backups `bin/setup` created, and deletes
any `day`/`night` presets it generated (never ones you've edited by hand -
detected by the generated-file marker comment at the top of the `.toml`).

## Settings

Configured per the bar widget's entry in `~/.config/omarchy/shell.json`
(`bar.layout.<section>` -> the `mark.sunsetr` item):

| Key | Default | Description |
|---|---|---|
| `dayTemp` | `6500` | Cool end of the icon's color range (K). Match your `sunsetr.toml`'s `day_temp`. |
| `nightTemp` | `3500` | Warm end of the icon's color range (K). Match your `sunsetr.toml`'s `night_temp`. |
| `coolColor` | `#9fb4c7` | Icon color at `dayTemp`. |
| `warmColor` | `#ff9d54` | Icon color at `nightTemp`. |
| `dayPreset` | `"day"` | sunsetr preset name applied when forcing day. |
| `nightPreset` | `"night"` | sunsetr preset name applied when forcing night. |
| `forceTransitionSeconds` | `2` | Fade duration when forcing day/night. **Only takes effect the first time the preset is created** - to change it later, edit `~/.config/sunsetr/presets/<name>/sunsetr.toml`'s `startup_duration` directly. |

## Keybindings

Bind a key to `sunsetr-nightlight toggle` (or `on`/`off`/`auto`) the same
way you'd bind any other Omarchy shell command, e.g. in
`~/.config/hypr/bindings.conf`:

```
bindd = SUPER CTRL, N, Toggle night light, exec, sunsetr-nightlight toggle
```

## Development

```
npm test          # runs tests/color.test.js and tests/control.test.js under plain node
```

`SunsetrColor.js` and `SunsetrControl.js` are pure JS with no Qt dependency,
so they're fully unit-tested outside Quickshell. `Service.qml`/`BarWidget.qml`
are verified manually against the running shell (no Qt test harness here).

## Architecture

See `docs/superpowers/specs/2026-08-28-omarchy-sunsetr-plugin-design.md` for
the full design rationale (why a single extended service instead of separate
read/write services, why static-mode presets instead of a custom smoothing
engine, etc.).

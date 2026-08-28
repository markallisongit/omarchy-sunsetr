# omarchy-sunsetr plugin — design

Date: 2026-08-28
Status: approved, pending implementation plan

## Background

An existing loose plugin (`mark.sunsetr`, living directly in
`~/.config/omarchy/plugins/mark.sunsetr`, not source-controlled) is a
read-only Omarchy bar widget: it observes sunsetr's event socket and
shows a status-light icon whose color runs cool→warm and whose opacity
tracks gamma. It never drives sunsetr.

Other sunsetr-integration plugins for Omarchy commonly go further: they
replace Omarchy's stock NightLight indicator entirely, poll
`sunsetr status` on a timer, support toggling day/night via sunsetr
presets, ship a CLI, repoint the stock nightlight menu entry, and provide
an install/uninstall setup script.

This spec covers rebuilding `mark.sunsetr` as a proper git-tracked
project (`markallisongit/omarchy-sunsetr`) that adds that same feature
set (toggle, info panel, CLI, menu integration, install/uninstall) while
keeping this plugin's one real architectural advantage — socket-driven
push updates instead of polling — and adding a specific improvement over
a timer-polling approach: forced day/night presets fade smoothly
(briefly) instead of jumping instantly.

## Goals

- Toggle capability: force day / force night / back to automatic, from
  the bar icon and from a CLI (for keybindings).
- An info popup panel, simplified and styled to match Omarchy's
  existing popup conventions rather than a dense data table.
- Forcing day/night should fade over a short duration, not jump
  instantly — using sunsetr's own per-preset smoothing fields.
- Install/uninstall through the standard Omarchy plugin flow
  (`omarchy plugin add <git-url>` / `omarchy plugin remove`), replacing
  the stock NightLight indicator and menu entry.
- Keep the socket-driven read model (no polling) and the existing
  tested color/opacity math.
- Source-controlled at `~/Projects/omarchy-sunsetr`, pushed to
  `github.com/markallisongit/omarchy-sunsetr` (private for now).

## Non-goals

- No custom smoothing/animation engine on our side — all fade behavior
  during forced presets comes from sunsetr's own `smoothing` /
  `startup_duration` preset fields, not client-side interpolation.
- No configurable icon-visibility modes (`hover`/`always`/`never`).
  Visibility behavior is fixed (see below) — one correct behavior,
  not a settings matrix.
- Not attempting to support hyprsunset side-by-side (don't autostart
  hyprsunset).

## Architecture

Single extended service, per the "Approach A" decision: `Service.qml`
keeps its existing socket connection, boot-race handling, and
reconnect/backoff logic exactly as-is, and gains control methods.
Because sunsetr's event socket already emits a state-change event the
instant a preset takes effect, control methods don't need a
polling-lag workaround (a timer-driven `sunsetr status` poller would
otherwise need to schedule a delayed re-probe after every action to
catch up). A rejected alternative (separate read/write
services) added ceremony with no benefit, since control doesn't need
any state the read side doesn't already have.

### Components

- **`manifest.json`** — bump to reflect toggle capability. New
  `barWidget.defaults`/`schema` entries: `dayPreset` (default
  `"day"`), `nightPreset` (default `"night"`), `forceTransitionSeconds`
  (default `2`) alongside the existing `dayTemp`/`nightTemp`/
  `coolColor`/`warmColor`. No `interval` setting — there is no polling
  to configure.

- **`Service.qml`** (extended) — adds:
  - `toggle()`, `applyPreset(name)`, `start()`, `stop()`: shell out via
    `Process` to `sunsetr preset <name>`, starting sunsetr with
    `uwsm-app` first if it isn't running (`sunsetr --background` uses
    the pre-0.56 `hyprctl dispatch exec` syntax and fails on current
    Hyprland).
  - `lastError`: captured from the preset-apply process's stdout+stderr
    on non-zero exit, ANSI-stripped, first `[ERROR]` line picked out,
    since sunsetr prints its boxed error report on stdout.
  - Everything already there (`stateLoaded`, `connected`,
    `everConnected`, `stale`, socket lifecycle, reconnect backoff)
    is unchanged.
  - Header comment updates: this service is no longer read-only,
    "observes sunsetr, never drives it" no longer applies.

- **`SunsetrColor.js`** (extended, not replaced) — keeps `clamp01`,
  `warmth`, `lerp`, `alphaOf`, `mixChannels` as-is. `opacityForState`
  is refactored to use a newly-exported `activity(warmth, gamma)`
  helper (`Math.max(clamp01(warmth), dimming)`) so `BarWidget.qml` can
  reuse the exact same "how far from neutral" value to decide
  collapse, rather than duplicating the calculation.

- **`SunsetrControl.js`** (new) — pure logic, node-testable like
  `SunsetrColor.js`:
  - `toggleTarget(activePreset, warmth, dayPreset, nightPreset)`:
    forced (activePreset not `"default"`) → `"default"`; auto and
    `warmth >= 0.5` (already past the day/night midpoint, i.e.
    currently warm) → `dayPreset`; auto and `warmth < 0.5` →
    `nightPreset`. Uses the configured day/night temps' midpoint via
    `warmth`, not a fixed Kelvin constant, since this plugin's
    day/night temps are user-configurable.

- **`BarWidget.qml`** (extended) — adds:
  - Click handling: left = `toggle()`, middle = `refresh()`, right =
    open the popup.
  - **Icon visibility**: collapses to zero width only at true peak
    daytime (`activity(warmth, gamma) === 0` — temp at or above
    dayTemp and gamma at or above day_gamma). Any other state (dusk
    starting, night, dawn, or a forced non-day preset) shows the full
    continuous color/opacity animation exactly as today — no
    intermediate collapse. While collapsed, hovering the bar's center
    section reveals the icon in a fixed muted state (dim, non-animated
    — matching stock indicators' "peeked" ~0.45 opacity), not the live
    gradient, since there's nothing meaningful to show at neutral.
    This replaces the originally-discussed configurable
    `hover`/`always`/`never` `reveal` setting — one fixed, standard
    behavior instead of a settings matrix.
  - **Info popup** (`PopupCard`, matching existing Omarchy popup
    conventions — `Column`, `Text`, `PanelSeparator`, `ButtonGroup`,
    not a bespoke widget): four rows, simplified from an earlier
    denser draft:
    1. Title: `󰔎  Night Light` (same glyph as the icon, same style as
       other shell popups).
    2. Status line: a small colored dot using the same live
       `mixChannels`-derived color as the icon, followed by
       `4200K · 85% brightness` — ties the panel to the icon visually
       instead of a plain data table.
    3. Period line: combined into one line, e.g.
       `Sunset → Night in 1h12m` (period + next period together,
       not two separate rows).
    4. Connection line — rendered *only* when `stale` is true or
       `lastError` is non-empty; otherwise omitted entirely. Silent by
       default, matching the deliberate `everConnected` latch design
       that avoids false-positiving on the normal ~1s startup gap.
    - Below the four rows: an Auto / Day / Night `ButtonGroup` calling
      `applyPreset()` — the one control element, kept separate from
      the informational rows above it.

- **`bin/sunsetr-nightlight`** (new) — CLI:
  `toggle|on|off|auto|status|start|stop|refresh`. Routes through
  `omarchy-shell`'s IPC when the shell is running (bar updates
  immediately), falls back to talking to `sunsetr` directly otherwise.
  Enables keybindings (e.g. rebinding `SUPER+CTRL+N`).

- **`bin/sunsetr-ensure-preset`** (new) — creates
  `~/.config/sunsetr/presets/{day,night}/sunsetr.toml` on first use if
  missing, seeded from the user's live `day_temp`/`night_temp`/gamma
  values via `sunsetr get`. Critically, unlike a plain static preset,
  the generated file also sets `smoothing = true` and
  `startup_duration = <forceTransitionSeconds>` (default 2s) — this is
  what makes forcing day/night fade briefly instead of jumping, using
  sunsetr's own documented per-preset smoothing fields (confirmed:
  "Smooth transitions provide gradual fade effects when sunsetr starts
  up, reloads, switches presets, and shuts down"; presets can override
  `smoothing`/`startup_duration`/`shutdown_duration` independently of
  the main config). Existing preset files are never overwritten —
  `forceTransitionSeconds` only takes effect the first time a preset
  is created; changing the setting afterward requires manually editing
  the generated `.toml` (documented in the README).
  `sunsetr preset <name>` called on an already-active preset toggles
  it back to default — this is native sunsetr behavior, not something
  the plugin needs to implement.

- **`bin/setup`** (new) — idempotent install helper (asks before
  changing anything; `--yes` to skip prompts):
  1. create day/night presets if missing (also done lazily on first
     toggle, so this isn't required before first use)
  2. symlink `sunsetr-nightlight` into `~/.local/bin`
  3. remove `NightLight` from `omarchy.indicators` in
     `~/.config/omarchy/shell.json`
  4. merge `extensions/omarchy-menu.jsonc`'s
     `trigger.toggle.nightlight` override into
     `~/.config/omarchy/extensions/omarchy-menu.jsonc`
  5. `omarchy plugin enable mark.sunsetr` if not already enabled

  Edited files get a `.bak.sunsetr.<timestamp>` copy. `--uninstall`
  reverses all of the above (restores `omarchy.indicators`, removes
  the menu override and CLI symlink, deletes presets it created if
  unmodified, returns sunsetr to `default`).

- **`extensions/omarchy-menu.jsonc`** (new) — the
  `trigger.toggle.nightlight` override fragment `bin/setup` merges in,
  pointing at `sunsetr-nightlight toggle`/`status`.

## Data flow summary

1. Socket event or seed probe → `Service.qml` state (`currentTemp`,
   `currentGamma`, `period`, `activePreset`, `nextPeriod`, `stale`).
2. `BarWidget.qml` derives `warmth`, `activity`, `liveColor`,
   `iconOpacity`, `collapsed` from that state plus its own settings
   (`dayTemp`/`nightTemp`/`coolColor`/`warmColor`) — unchanged
   ownership split from today (service reports, widget renders).
3. User interaction (click / popup button) → `BarWidget.qml` calls
   `Service.qml` control methods → `Process` runs `sunsetr preset …` →
   sunsetr applies it (with its own short smoothing) → socket emits
   the change → back to step 1. No manual delay/re-probe needed.

## Testing

- `tests/color.test.js` (existing) — unchanged, still covers
  `clamp01`/`warmth`/`mixChannels`/`opacityForState`; extend with
  cases for the newly-exported `activity()` helper (0 at peak
  daytime, matching the collapse condition).
- `tests/control.test.js` (new) — covers `SunsetrControl.js`'s
  `toggleTarget`: forced→default regardless of warmth, auto+warm→day,
  auto+cool→night, boundary at warmth exactly 0.5, and that it uses
  the configured day/night temps' midpoint rather than a fixed
  constant.
- Both run under plain `node`, no Qt dependency, matching the existing
  pattern.

## Install / distribution

- Local project: `~/Projects/omarchy-sunsetr`, git-tracked, pushed to
  `github.com/markallisongit/omarchy-sunsetr` (private during
  development; flip to public before submitting to
  omarchyplugins.com).
- End-user install: `omarchy plugin add
  https://github.com/markallisongit/omarchy-sunsetr.git` (clones to
  `~/.config/omarchy/plugins/mark.sunsetr`), then run `bin/setup` —
  matching the standard Omarchy plugin flow.
- Plugin id stays `mark.sunsetr` (not renamed).

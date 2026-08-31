# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.2] - 2026-08-31

- The popup's countdown line now reads "Day → Sunset begins in 11h" instead
  of "Day → Sunset in 11h" - sunsetr's "Sunset"/"Sunrise" are named
  ~70-minute transition periods, not the instant of the astronomical event,
  and the old wording read as a countdown to sunset itself.
- The popup now shows the coordinates sunsetr is using ("Location: 52.1°N,
  0.5°W (change with sunsetr geo)"), so it's obvious where to fix it if
  they're wrong.

## [0.3.1] - 2026-08-31

- Fixed: left-clicking the widget before sunsetr is installed no longer
  triggers an OS-level "App failure" notification (it was still attempting
  to launch sunsetr via `uwsm-app`). Any click now opens the popup's
  existing "sunsetr is not installed" explanation instead.

## [0.3.0] - 2026-08-31

- `bin/setup` now checks for the sunsetr binary up front and stops with a
  clear message if it's missing, instead of failing later with a confusing
  error.
- The bar widget now distinguishes "sunsetr not installed" from the normal
  boot/reconnect states in its tooltip and popup, rather than showing
  "loading…" forever.

## [0.2.0] - 2026-08-28

- Night-light indicator and control driven by sunsetr's event socket instead
  of polling or hyprsunset.
- Icon color runs cool -> warm with sunsetr's live color temperature; opacity
  tracks gamma. Collapses to zero width at true peak daytime.
- Left-click toggles forced day/night (or back to automatic); middle-click
  refreshes; right-click opens an info popup with status, period countdown,
  and an Auto/Day/Night switch.
- Forcing day/night fades in via sunsetr's per-preset `smoothing`/
  `startup_duration` fields instead of jumping instantly.
- `sunsetr-nightlight` CLI for keybindings
  (`toggle|on|off|auto|status|start|stop|refresh`).
- `bin/setup` installer: creates `day`/`night` presets, symlinks the CLI,
  removes the stock NightLight indicator, adds a toggle menu override, and
  enables the plugin. Idempotent, with `--yes`/`--uninstall` support and
  timestamped backups of every file it touches.

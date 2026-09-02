# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-09-02

Addresses the marketplace security review of 0.5.0:

- **Breaking (behavior):** the BigDataCloud reverse-geocode lookup that
  resolves a place name for the popup's location line is now off by
  default, behind a new `resolvePlaceNames` setting - resolving a name
  means sending your exact configured coordinates to that third party, so
  it now requires explicit opt-in. With it off, the popup shows raw
  coordinates.
- Hardened `bin/sunsetr-ensure-preset`: preset names are now restricted to
  a safe charset (blocks path traversal), sunsetr's reported
  temperature/gamma values are validated as numeric before being written
  into the generated TOML (blocks config injection), a symlink planted at
  the preset path is refused rather than followed, and the file is written
  via a private temp file + atomic rename instead of a direct redirect.
- Hardened `bin/setup`'s config-file edits: writes to `shell.json` and the
  menu override now go through an unpredictable `mktemp`-generated temp
  file in the same directory (was a fixed `.tmp` suffix, susceptible to a
  pre-planted symlink) before an atomic rename. Backups now use a single
  fixed filename per file (was glob/mtime-discovered at restore time,
  which could be tricked into "restoring" an attacker-planted file) and
  restore now refuses anything at that path that isn't a regular file
  owned by the current user.
- `BarWidget.qml`'s popup now renders all dynamic/external text (geocoder
  suggestions, resolved place name, status and error lines) with
  `textFormat: Text.PlainText`, so content from an external API can no
  longer be auto-detected and rendered as rich text.

## [0.5.0] - 2026-09-02

- The popup's location line is now clickable: type a city name, pick a match
  from the dropdown (or press Enter for the top match), and sunsetr switches
  to geo mode at that location immediately - no more dropping to a terminal
  for `sunsetr geo`. Search uses Open-Meteo's free, keyless geocoding API.
  Always writes to the base config, not whatever preset is currently active.

## [0.4.1] - 2026-09-02

- Fixed: on a fresh install, the bar icon could get stuck reading
  "loading..." forever. Installing the sunsetr package sets up neither of
  its two documented autostart methods (a compositor `exec-once` line, or
  its systemd `--user` service) on its own - `bin/setup` now enables and
  starts the systemd service, unless sunsetr is already running some other
  way (no duplicate process) or a compositor autostart line already covers
  it (no double-start on the next boot).

## [0.4.0] - 2026-08-31

- The popup's location line now shows a resolved place name (e.g.
  "Cambridge, GB") instead of raw coordinates, via a reverse-geocode lookup
  against BigDataCloud's free, keyless API. The result is cached at
  `~/.cache/mark.sunsetr/geocode.json`, so the lookup only happens once per
  actual location change. Falls back to raw coordinates if the lookup hasn't
  resolved yet, is offline, or the location has no name to give.
- `bin/setup` now also disables Omarchy's native `omarchy.nightlight`
  service, not just its bar indicator - previously the native service stayed
  switchable elsewhere and could fight sunsetr for control of the display.
- The `mark.sunsetr` IPC `status` command now includes `placeName`.
- Fixed: flipping between two locations in quick succession could leave the
  popup stuck on raw coordinates for an already-resolved location until an
  unrelated lookup finished.
- Fixed: rapid `state_applied` events during a sunset/sunrise transition no
  longer each spawn their own location-probe subprocess back-to-back.

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

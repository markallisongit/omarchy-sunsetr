# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.0] - 2026-09-02

Restores place names in the popup without needing shell.json edited by hand,
and replaces 0.6.0's off-by-default setting with a real pre-transfer consent
flow - which is what the marketplace review asked for. Consent now gates
*transmission*, not display: a name already on this machine is shown without
asking, because showing it sends nothing.

### Added

- **A place name for every location you pick.** The search dropdown already
  returns each result's name alongside its coordinates, and that name is now
  kept when you commit the choice. Setting your location from the widget
  therefore names it immediately - no lookup, no third party, nothing sent.
- **A consent prompt in the popup.** For a location that came from
  `sunsetr.toml` instead, the location line offers "show place name". That
  expands a prompt naming BigDataCloud and quoting the exact coordinates that
  would be sent - at the precision they would be sent at, not the display
  rounding - with **Look up** and **Not now**. Expanding it sends nothing;
  only Look up does.
- **Withdrawal from the same line.** Once on, the line offers "stop lookups",
  which turns the setting off, clears the resolved name and deletes it from
  the cache. A name that came from a picked suggestion is kept, since it never
  left the machine and there is nothing about it to withdraw.

### Changed

- `resolvePlaceNames` is still off by default, but is no longer the only way
  in: the popup's prompt sets it through `omarchy bar set`, Omarchy's own
  CLI, so the plugin never writes to `shell.json` itself.
- The consent check moved from the top of `maybeGeocode()` to after the memo
  and on-disk cache have been consulted. Everything before it is local, so
  gating it achieved nothing except hiding names that were already here.
- A cached name written before this release reads back as lookup-sourced and
  is re-asked about rather than displayed, so an upgrade never shows a name
  obtained without a consent flow.

### Fixed

- `sunsetr get --json latitude longitude` reports coordinates rounded to one
  decimal place (`"51.9"` for a stored `51.879670`), so a picked name filed
  under the coordinates it was picked at was filed where nothing would ever
  look it up. The name is now claimed by the probe that follows the location
  change and stored under the coordinates that probe reports.

## [0.6.1] - 2026-09-02

Follow-up to the 0.6.0 marketplace security review, covering two things the
review asked for that 0.6.0 only partly delivered:

- The geocode cache write in `Service.qml` still used a predictable
  `geocode.json.tmp` path in a user-writable directory - the same class of
  issue 0.6.0 fixed for `bin/setup`'s config writes, just in a file that pass
  didn't touch. It now writes through an `mktemp`-generated temp file in the
  cache directory before the atomic rename.
- Remote text is now **bounded**, not just rendered as plain text. Search
  suggestion names and descriptions are capped in length (80/120 characters)
  and the result list is capped at 5 client-side, so a geocoder that ignores
  the query's `count=5` can't flood the dropdown. The reverse-geocoded place
  name is capped the same way, both when formatted and when read back from
  the on-disk cache. The suggestion rows now elide rather than widening the
  popup.

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

import QtQuick
import Quickshell
import Quickshell.Io
import "SunsetrColor.js" as ColorModel
import "SunsetrControl.js" as Control

// Owns the live sunsetr state for the bar widget: a persistent connection to
// sunsetr's event socket (sunsetr-events.sock), which streams one JSON line
// per state change (StateApplied / PeriodChanged / PresetChanged /
// ConfigChanged) with no polling. One `sunsetr status --json` probe runs at
// startup to seed the state immediately, since the socket only delivers
// events on change and may not have anything queued the moment we connect.
//
// This service both observes sunsetr (socket-driven, no polling) and drives
// it: toggle()/applyPreset()/start()/stop() shell out to the sunsetr CLI.
// Because the event socket emits a state-change the instant a preset takes
// effect, control methods don't need a polling-lag workaround (unlike a
// timer-driven `sunsetr status` poller, which schedules a delayed re-probe
// after every action to catch up) - the next socket event is the update.
//
// It holds what sunsetr reports and how the connection to it is faring, and
// nothing about how any of that gets drawn. Color, opacity and tooltip text
// all derive from user settings the bar widget owns, so they belong to the
// widget - which also spares this singleton being written to by one widget
// instance per monitor just to compute values it hands straight back.
Item {
  id: root

  // Injected by omarchy-shell.
  property var shell: null
  property var manifest: null

  // NOT injected by shell.qml's ensureService() - that only ever sets
  // omarchyPath/shell/manifest/barWidgetRegistry/pluginRegistry on a service
  // singleton, confirmed by reading it directly. tailscale/dropbox's
  // Service.qml read settings via a different path entirely: their Panel
  // instantiates the service inline with an explicit `settings: root.settings`
  // binding, which is a panel-based pattern this shell-level singleton
  // doesn't use. Instead, BarWidget.qml pushes its own `settings` (the object
  // the bar host's injectProps() assigns onto the widget) onto this property
  // itself whenever it changes - see BarWidget.qml's pushSettingsToService().
  // This is how toggle() can resolve dayPreset/nightPreset/dayTemp/nightTemp
  // without the widget mediating every CLI-driven call.
  property var settings: ({})

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  property bool stateLoaded: false
  property bool connected: false
  // Latches on the first live connection so that "not connected" can mean
  // "we had it and lost it" rather than "we haven't got it yet". Without the
  // distinction the ~1s boot gap between the seed probe landing and the
  // socket coming up would report a fault on every single startup.
  property bool everConnected: false
  property var currentTemp: null
  property var currentGamma: null
  property string period: ""
  property string activePreset: "default"
  property string nextPeriod: ""
  property string stateName: "stable"
  property string lastError: ""
  // Distinguishes "sunsetr isn't installed" from "sunsetr just hasn't
  // started yet" - the socket-wait loop below can't tell those apart on its
  // own, and a missing executable never fires Process.onExited at all
  // (QProcess's FailedToStart isn't surfaced to QML here), so it's checked
  // separately through a shell instead of relying on that.
  property bool sunsetrMissing: false
  // Not part of the event socket's payload at all (sunsetr doesn't emit
  // coordinates on state changes), so this only ever updates from
  // locationProbe below - on startup and whenever refresh() runs.
  property var latitude: null
  property var longitude: null

  // Human-readable "Cambridge, United Kingdom" for the popup, resolved from
  // latitude/longitude via BigDataCloud's reverse-geocode-client endpoint (no
  // API key). null until the first lookup lands - BarWidget falls back to
  // formatLocation's raw coordinates until then, and forever if the lookup
  // never succeeds (offline, service down, or a spot with no name at all).
  // geocodedLat/geocodedLon record which coordinates placeName (or a
  // deliberate "nothing usable there") is actually for, so maybeGeocode can
  // tell "already resolved this exact location" apart from "location changed,
  // go look it up again" without re-hitting the network on every refresh().
  property var placeName: null
  property var geocodedLat: null
  property var geocodedLon: null

  readonly property string geocodeCacheDir:
    (Quickshell.env("XDG_CACHE_HOME") || (Quickshell.env("HOME") + "/.cache")) + "/mark.sunsetr"
  readonly property string geocodeCacheFile: geocodeCacheDir + "/geocode.json"

  // In-memory memo of every coordinate resolved so far this session (keyed
  // by the same 6dp-rounded value used for the cache/query below), mapping
  // to its place name ("" for a resolved-but-nameless spot). geocodedLat/
  // geocodedLon alone only remembers the *most recent* lookup's target, so a
  // location that flips away and back while a lookup for that intervening
  // location is still in flight would otherwise find geocodedLat/geocodedLon
  // pointing at itself (skip - already resolved) while placeName had already
  // been cleared for the intervening lookup, stranding the popup on raw
  // coordinates until that unrelated lookup finishes. The memo lets a return
  // to an already-known location restore its name immediately instead.
  property var geocodeMemo: ({})

  // Kicks off the (cache-then-network) lookup for a newly-probed lat/lon, but
  // only when it's actually a new location: coordsMatch against
  // geocodedLat/geocodedLon is what stops a flapping sunsetr connection (each
  // reconnect calls refresh() -> locationProbe) or a mashed manual-refresh
  // click from re-querying the same spot over and over. The running-process
  // guard is a second line of defense against overlapping lookups if two
  // distinct locations arrive close together - the second is simply skipped
  // and picked up by the next refresh() once the first finishes.
  function maybeGeocode(lat, lon) {
    // Off by default: resolving a place name means sending your exact
    // configured coordinates to BigDataCloud, a third party. Only do that
    // once the user has explicitly opted in via the widget's settings -
    // otherwise the popup just shows raw coordinates (see BarWidget.qml's
    // locationLine), and nothing about location ever leaves this machine.
    if (!root.setting("resolvePlaceNames", false)) {
      root.placeName = null
      return
    }
    if (lat === null || lat === undefined || lon === null || lon === undefined) return
    var latNum = Number(lat), lonNum = Number(lon)
    if (!isFinite(latNum) || !isFinite(lonNum)) return
    // Rounded once, here, so the same value is used consistently for the
    // memo/cache key, the coordsMatch dedupe, and the API query - 6dp is
    // ~0.1m, far finer than a place name needs, chosen mainly to keep JS's
    // number->string conversion (both in the URL and in the cache file) away
    // from exponential notation, which the API can't parse as a coordinate.
    var rLat = Number(latNum.toFixed(6)), rLon = Number(lonNum.toFixed(6))
    var memoKey = rLat + "," + rLon
    if (Object.prototype.hasOwnProperty.call(root.geocodeMemo, memoKey)) {
      root.placeName = root.geocodeMemo[memoKey] || null
      root.geocodedLat = rLat
      root.geocodedLon = rLon
      return
    }
    if (ColorModel.coordsMatch(rLat, rLon, root.geocodedLat, root.geocodedLon)) return
    if (cacheReadProcess.running || geocodeProcess.running) return
    // The old name belongs to the old coordinates - clear it now rather than
    // leaving it displayed (wrongly) until this lookup resolves, which could
    // be seconds away or, if it never succeeds, never.
    root.placeName = null
    root.pendingGeoLat = rLat
    root.pendingGeoLon = rLon
    cacheReadProcess.command = ["bash", "-lc", "cat " + shQuote(root.geocodeCacheFile) + " 2>/dev/null"]
    cacheReadProcess.running = true
  }

  property var pendingGeoLat: null
  property var pendingGeoLon: null

  // Cache read is its own step (rather than folding into geocodeProcess)
  // specifically so a warm cache never touches the network at all - it
  // resolves the place name as fast as `cat` runs.
  Process {
    id: cacheReadProcess
    stdout: StdioCollector { id: cacheReadOut; waitForEnd: true }
    onExited: function(exitCode) {
      var cached = ColorModel.parseGeocodeCache(String(cacheReadOut.text || ""), root.pendingGeoLat, root.pendingGeoLon)
      if (cached) {
        root.placeName = cached
        root.geocodedLat = root.pendingGeoLat
        root.geocodedLon = root.pendingGeoLon
        root.geocodeMemo[root.pendingGeoLat + "," + root.pendingGeoLon] = cached
        return
      }
      var url = "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" +
        root.pendingGeoLat + "&longitude=" + root.pendingGeoLon + "&localityLanguage=en"
      // -f: a non-2xx response (rate limited, service down) fails the curl
      // call instead of handing an HTML error page to JSON.parse.
      // -L: BigDataCloud 307-redirects api.bigdatacloud.net to api-bdc.io -
      // without this the response is an empty, "successful" (exit 0) body.
      // --connect-timeout/--max-time: never let a stalled connection leave
      // this Process (and the running-guard above) stuck indefinitely.
      geocodeProcess.command = ["bash", "-lc",
        "curl -sfL -A 'omarchy-sunsetr-plugin' --connect-timeout 3 --max-time 5 " + shQuote(url)]
      geocodeProcess.running = true
    }
  }

  Process {
    id: geocodeProcess
    stdout: StdioCollector { id: geocodeOut; waitForEnd: true }
    onExited: function(exitCode) {
      // Offline, timed out, or the service refused/errored: leave
      // geocodedLat/geocodedLon untouched so the *next* refresh() (the next
      // reconnect, or a manual click) retries rather than giving up on this
      // location for the rest of the session.
      if (exitCode !== 0) return
      var name = ""
      try {
        name = ColorModel.formatPlaceName(JSON.parse(String(geocodeOut.text || "")))
      } catch (e) {
        console.warn("mark.sunsetr: could not parse geocode response:", e)
        return
      }
      // A location with no usable name (open ocean, Antarctica) is still a
      // resolved answer - record it so this exact spot isn't re-queried every
      // refresh, but there's nothing worth writing to the on-disk cache.
      root.geocodedLat = root.pendingGeoLat
      root.geocodedLon = root.pendingGeoLon
      root.geocodeMemo[root.pendingGeoLat + "," + root.pendingGeoLon] = name
      if (!name) return
      root.placeName = name
      var payload = JSON.stringify({ lat: root.pendingGeoLat, lon: root.pendingGeoLon, placeName: name })
      // Written to a temp file and renamed into place so a shell restart (or
      // a crash) mid-write can never leave a torn/partial cache file behind -
      // the rename is atomic, so a reader always sees either the old
      // complete file or the new one, never a half-written one.
      //
      // mktemp rather than a fixed "geocode.json.tmp": that path was
      // predictable and sat in a user-writable directory, so a symlink
      // planted there ahead of time would have been followed and the redirect
      // would have written through it. Same fix, and the same reasoning, as
      // bin/setup's config writes. Created in geocodeCacheDir so the mv stays
      // a same-filesystem atomic rename.
      geocodeCacheWriteProcess.command = ["bash", "-lc",
        "mkdir -p " + shQuote(root.geocodeCacheDir) +
        " && tmp=$(mktemp " + shQuote(root.geocodeCacheFile + ".XXXXXX") + ")" +
        " && printf '%s' " + shQuote(payload) + ' > "$tmp"' +
        " && mv \"$tmp\" " + shQuote(root.geocodeCacheFile)]
      geocodeCacheWriteProcess.running = true
    }
  }

  // Fire-and-forget: a failed write (read-only home, disk full) just means no
  // persistent cache for next session, not a broken lookup this session -
  // placeName above is already set from the live response either way.
  Process {
    id: geocodeCacheWriteProcess
  }

  // Once a connection we had has dropped, the readings above are last-known
  // rather than live, and sunsetr may have moved the display since. Connection
  // health is this service's business even though only the widget renders it.
  readonly property bool stale: stateLoaded && everConnected && !connected

  function refresh() {
    if (!seedProbe.running) seedProbe.running = true
    runLocationProbe()
  }

  // Throttled re-probe for applyEvent below: at most one `sunsetr get`
  // subprocess per locationProbeThrottleMs, with a trailing call so a probe
  // still lands shortly after a burst ends rather than being dropped
  // entirely. Without this, the dozens of state_applied events a single
  // ~70-minute sunset/sunrise transition emits as current_temp/current_gamma
  // glide would each spawn their own subprocess back-to-back.
  readonly property int locationProbeThrottleMs: 5000
  property double lastLocationProbeMs: 0

  function runLocationProbe() {
    root.lastLocationProbeMs = Date.now()
    if (!locationProbe.running) locationProbe.running = true
  }

  Timer {
    id: locationProbeTrailing
    repeat: false
    onTriggered: root.runLocationProbe()
  }

  function requestLocationProbe() {
    var elapsed = Date.now() - root.lastLocationProbeMs
    if (elapsed >= root.locationProbeThrottleMs) {
      runLocationProbe()
    } else if (!locationProbeTrailing.running) {
      locationProbeTrailing.interval = root.locationProbeThrottleMs - elapsed
      locationProbeTrailing.start()
    }
  }

  function applyEvent(evt) {
    if (!evt || typeof evt !== "object") return
    // Every socket message means sunsetr just reloaded and re-applied its
    // config, so latitude/longitude on disk may have moved even when this
    // particular event carries no coordinates and no visible temp/gamma
    // change (e.g. a location edit that doesn't cross a day/night boundary
    // fires state_applied only, no config_changed - `config_changed` turns
    // out to mean "the smoothing target changed", not "the file changed").
    // Re-running the same locationProbe refresh() uses at startup/reconnect
    // is cheap and self-guarded, but a transition period fires this many
    // times a second, so requestLocationProbe throttles rather than spawning
    // a subprocess per event.
    requestLocationProbe()
    if ("current_temp" in evt) currentTemp = evt.current_temp
    if ("current_gamma" in evt) currentGamma = evt.current_gamma
    if ("period" in evt) period = String(evt.period)
    if ("active_preset" in evt) activePreset = String(evt.active_preset)
    if ("next_period" in evt) nextPeriod = String(evt.next_period || "")
    if ("state" in evt) stateName = String(evt.state)
    stateLoaded = true
  }

  // One-shot seed so the icon is correct immediately on shell startup.
  Process {
    id: seedProbe
    command: ["sunsetr", "status", "--json"]
    stdout: StdioCollector {
      id: seedOut
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) return
      try {
        root.applyEvent(JSON.parse(String(seedOut.text || "")))
      } catch (e) {
        console.warn("mark.sunsetr: could not parse seed status:", e)
      }
    }
  }

  // One-shot too, same reasoning as seedProbe: `sunsetr get` reads whatever
  // is on disk right now, so this only reflects the coordinates at the
  // moment it last ran (startup, or a manual refresh()) - not a live socket
  // field, since sunsetr's events never carry coordinates.
  //
  // Explicitly targets "default" rather than the active configuration:
  // this plugin's day/night force presets are deliberately static overrides
  // with no latitude/longitude fields of their own (see
  // sunsetr-ensure-preset), so reading "active" would go blank - not "no
  // location configured", just "the current preset doesn't care about
  // geography" - the instant either force preset is active. Pairs with
  // setLocation() below, which writes to the same target.
  Process {
    id: locationProbe
    command: ["sunsetr", "get", "--target", "default", "--json", "latitude", "longitude"]
    stdout: StdioCollector {
      id: locationOut
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) return
      try {
        var v = JSON.parse(String(locationOut.text || ""))
        root.latitude = "latitude" in v ? Number(v.latitude) : null
        root.longitude = "longitude" in v ? Number(v.longitude) : null
        root.maybeGeocode(root.latitude, root.longitude)
      } catch (e) {
        console.warn("mark.sunsetr: could not parse location:", e)
      }
    }
  }

  // Ensures sunsetr is running, ensures a non-default preset's file exists
  // (day/night presets are created lazily, seeded from live config), then
  // applies the named preset. Never uses `sunsetr --background` - that flag
  // uses the pre-0.56 `hyprctl dispatch exec` syntax and fails on current
  // Hyprland, same reason Omarchy's own bin/omarchy-toggle-nightlight starts
  // hyprsunset via `uwsm-app` instead.
  Process {
    id: presetProcess
    property string pendingName: ""
    stdout: StdioCollector { id: presetOut; waitForEnd: true }
    stderr: StdioCollector { id: presetErr; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) {
        root.lastError = ""
        return
      }
      root.lastError = root.extractError(String(presetOut.text || "") + String(presetErr.text || ""))
    }
  }

  // sunsetr's error report is a boxed ANSI report printed on stdout, e.g.:
  //   ┣[ERROR] Preset 'x' not found at: ...
  // Strip ANSI escapes and surface just the first line containing "ERROR".
  function extractError(rawOutput) {
    var stripped = String(rawOutput).replace(/\x1b\[[0-9;]*m/g, "")
    var lines = stripped.split("\n")
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("ERROR") !== -1) {
        return lines[i].replace(/^[^A-Za-z0-9]*/, "").trim()
      }
    }
    return stripped.trim()
  }

  // Launching via uwsm-app when sunsetr isn't installed doesn't just fail
  // quietly - uwsm wraps it in a systemd user scope, and that scope failing
  // to start surfaces as an "App failure" desktop notification. Bailing out
  // before ever calling uwsm-app is what avoids that, not anything under
  // our own control once the launch attempt is made.
  function ensureRunningAndApply(name) {
    if (root.sunsetrMissing) {
      root.lastError = "sunsetr is not installed"
      return
    }
    var duration = Number(setting("forceTransitionSeconds", 2))
    // Prefer the absolute path to our bundled sunsetr-ensure-preset script:
    // the installer never puts it on PATH (only bin/sunsetr-nightlight gets
    // symlinked into ~/.local/bin), so a bare command name reliably fails
    // with "command not found". manifest.__sourceDir is stamped by
    // PluginRegistry.qml with this plugin's own source directory and
    // injected onto every service instance by shell.qml's ensureService(),
    // so it's normally available; fall back to the bare name only if
    // manifest hasn't been injected yet, so PATH-based resolution is at
    // least attempted rather than silently doing nothing.
    var ensureScript = (root.manifest && root.manifest.__sourceDir)
      ? shQuote(root.manifest.__sourceDir + "/bin/sunsetr-ensure-preset")
      : "sunsetr-ensure-preset"
    var ensureStep = name === "default"
      ? ""
      : ensureScript + " " + shQuote(name) + " " + shQuote(name === String(setting("dayPreset", "day")) ? "day" : "night") + " " + shQuote(String(duration)) + " || exit 1; "
    presetProcess.command = ["bash", "-lc",
      "pgrep -x sunsetr >/dev/null || { setsid uwsm-app -- sunsetr >/dev/null 2>&1 & sleep 1; }; " +
      ensureStep +
      "sunsetr preset " + shQuote(name)]
    presetProcess.running = true
  }

  function shQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'"
  }

  // Switches to geo mode and writes new coordinates into the base config -
  // not whatever preset happens to be active, since presets are for
  // day/night temp/gamma variants, not separate geographies. Coordinates
  // aren't part of the event socket's payload (see maybeGeocode above), so a
  // successful write also kicks an immediate, unthrottled location probe
  // rather than waiting on the throttled one requestLocationProbe schedules
  // off the state_applied event this triggers when sunsetr is running.
  function setLocation(lat, lon) {
    var latNum = Number(lat), lonNum = Number(lon)
    if (!isFinite(latNum) || !isFinite(lonNum)) return
    setLocationProcess.command = ["sunsetr", "set", "--target", "default",
      "transition_mode=geo", "latitude=" + latNum, "longitude=" + lonNum]
    setLocationProcess.running = true
  }

  Process {
    id: setLocationProcess
    stdout: StdioCollector { id: setLocationOut; waitForEnd: true }
    stderr: StdioCollector { id: setLocationErr; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) {
        root.lastError = ""
        root.runLocationProbe()
        return
      }
      root.lastError = root.extractError(String(setLocationOut.text || "") + String(setLocationErr.text || ""))
    }
  }

  function applyPreset(name) {
    ensureRunningAndApply(String(name))
  }

  function toggle() {
    var dayTemp = Number(setting("dayTemp", 6500))
    var nightTemp = Number(setting("nightTemp", 3500))
    var dayPreset = String(setting("dayPreset", "day"))
    var nightPreset = String(setting("nightPreset", "night"))
    var w = ColorModel.warmth(root.currentTemp, dayTemp, nightTemp)
    applyPreset(Control.toggleTarget(root.activePreset, w, dayPreset, nightPreset))
  }

  function start() {
    if (root.sunsetrMissing) {
      root.lastError = "sunsetr is not installed"
      return
    }
    presetProcess.command = ["bash", "-lc",
      "pgrep -x sunsetr >/dev/null || setsid uwsm-app -- sunsetr >/dev/null 2>&1 &"]
    presetProcess.running = true
  }

  function stop() {
    presetProcess.command = ["sunsetr", "stop"]
    presetProcess.running = true
  }

  // One-shot presence check, re-run every time awaitSocket times out (i.e.
  // on the same ~30s cadence as the socket wait itself) so installing
  // sunsetr while the shell is already running is picked up without a
  // restart, same as a late-starting sunsetr already is below.
  Process {
    id: binaryCheck
    command: ["bash", "-lc", "command -v sunsetr >/dev/null 2>&1"]
    onExited: function(exitCode) { root.sunsetrMissing = exitCode !== 0 }
  }

  // The awaitSocket-timeout cadence above only fires while never connected -
  // once connected it stops running entirely, so a binary that disappears
  // (or reappears) out from under an already-live connection would otherwise
  // go undetected until the connection itself drops and retries. This runs
  // independently of connection state so that case self-heals too, just on a
  // slower cadence since it's the rarer one.
  Timer {
    interval: 60000
    running: true
    repeat: true
    onTriggered: if (!binaryCheck.running) binaryCheck.running = true
  }

  readonly property string socketPath: Quickshell.env("XDG_RUNTIME_DIR") + "/sunsetr-events.sock"
  property var activeSocket: null

  // Don't attempt a connection until sunsetr's socket file actually exists.
  // This is what eliminates the boot race rather than papering over it:
  // sunsetr autostarts ~1s after the shell, so a connect issued at
  // Component.onCompleted routinely lands before the file is there. Waiting
  // for the file first means the first real connect attempt is (almost)
  // always against a live server instead of a bet that has to be retried.
  //
  // Bounded to 30s chunks and self-re-arming: if sunsetr isn't running at
  // all yet (not just racing), we keep waiting in bounded stretches rather
  // than blocking forever, and pick it up whenever it does start.
  Process {
    id: awaitSocket
    command: ["timeout", "30", "sh", "-c", "until [ -S \"$0\" ]; do sleep 0.1; done", root.socketPath]
    onExited: function(exitCode) {
      if (exitCode === 0) {
        spawnSocket()
        root.refresh()
      } else if (exitCode === 124) {
        // `timeout` fired: sunsetr simply isn't up yet. The 30s wait is its
        // own throttle, so go straight back to waiting.
        if (!binaryCheck.running) binaryCheck.running = true
        running = true
      } else {
        // The helper itself failed rather than timing out - no `timeout` on
        // PATH, or the process killed out from under us during a plugin
        // reload. Those exit immediately, so re-arming inline the way a 124
        // does would spin as fast as the kernel can fork. Back off instead.
        root.reconnect(false)
      }
    }
  }

  // Reconnect pacing. A drop from a live connection retries at once: the
  // file-existence wait above can't spin, because a cleanly-exited sunsetr
  // takes its socket file with it and the wait simply blocks. A connect that
  // never landed is the opposite case - the stale-file one below - where the
  // wait returns instantly every time, so retrying at a fixed interval would
  // respawn two processes, build and destroy a Socket, and log a refusal
  // every 2s for as long as the file sits there. That backs off to a ceiling.
  readonly property int retryDelayMin: 2000
  readonly property int retryDelayMax: 30000
  property int retryDelay: retryDelayMin

  Timer {
    id: retryTimer
    repeat: false
    onTriggered: if (!awaitSocket.running) awaitSocket.running = true
  }

  function reconnect(immediate) {
    if (retryTimer.running) return
    if (immediate) {
      if (!awaitSocket.running) awaitSocket.running = true
      return
    }
    retryTimer.interval = retryDelay
    retryDelay = Math.min(retryDelay * 2, retryDelayMax)
    retryTimer.restart()
  }

  // File existence rules out the boot race but not a stale file left behind
  // by a crashed sunsetr with no listener behind it. For that case a single
  // long-lived Socket is a dead end: measured against a live journal, a
  // failed connect attempt against such a file never fires onConnectedChanged
  // at all (matches Quickshell's own documented behavior for "can't find the
  // server"), and reassigning `connected` on the same instance afterwards -
  // even toggling it false then true - produces no further connect attempt
  // and no error, repeat timer notwithstanding. Whatever internal state a
  // failed attempt leaves behind, it isn't one a same-instance retry escapes.
  // So retries here don't reuse the instance: each attempt gets a throwaway
  // Socket, which behaves exactly like the very first attempt always has.
  Component {
    id: socketFactory
    Socket {
      connected: true
      parser: SplitParser {
        onRead: function(message) {
          try {
            root.applyEvent(JSON.parse(message))
          } catch (e) {
            console.warn("mark.sunsetr: bad event:", e)
          }
        }
      }
      onConnectedChanged: {
        if (connected) {
          root.connected = true
          root.everConnected = true
          root.sunsetrMissing = false
          root.retryDelay = root.retryDelayMin
          connectTimeout.stop()
        } else {
          root.teardownSocket()
        }
      }
    }
  }

  function spawnSocket() {
    activeSocket = socketFactory.createObject(root, { path: root.socketPath })
    connectTimeout.restart()
  }

  function teardownSocket() {
    // A drop from a connection we actually had is a real event worth chasing
    // immediately; a teardown from the timeout below never connected at all,
    // and is the case that has to be paced.
    var wasConnected = root.connected
    root.connected = false
    connectTimeout.stop()
    if (activeSocket) {
      activeSocket.destroy()
      activeSocket = null
    }
    reconnect(wasConnected)
  }

  // Bounded proof-of-life for a freshly spawned attempt: a real connect to a
  // live listener resolves near-instantly, so if this one hasn't within 2s
  // it's the stale-file case above - throw it away and go back to waiting
  // for the (possibly still-stale) file rather than leaving a dead instance
  // sitting around unreported.
  Timer {
    id: connectTimeout
    interval: 2000
    repeat: false
    onTriggered: {
      if (!root.connected) root.teardownSocket()
    }
  }

  Component.onCompleted: {
    seedProbe.running = true
    locationProbe.running = true
    awaitSocket.running = true
    binaryCheck.running = true
  }

  IpcHandler {
    target: "mark.sunsetr"

    function status(): string {
      return JSON.stringify({
        connected: root.connected,
        stale: root.stale,
        sunsetrMissing: root.sunsetrMissing,
        retryDelay: root.retryDelay,
        stateLoaded: root.stateLoaded,
        currentTemp: root.currentTemp,
        currentGamma: root.currentGamma,
        period: root.period,
        activePreset: root.activePreset,
        nextPeriod: root.nextPeriod,
        lastError: root.lastError,
        latitude: root.latitude,
        longitude: root.longitude,
        placeName: root.placeName
      })
    }

    function refresh(): void { root.refresh() }
    function toggle(): string { root.toggle(); return "ok" }
    function on(): string { root.applyPreset(String(root.setting("nightPreset", "night"))); return "ok" }
    function off(): string { root.applyPreset(String(root.setting("dayPreset", "day"))); return "ok" }
    function auto(): string { root.applyPreset("default"); return "ok" }
    function start(): void { root.start() }
    function stop(): void { root.stop() }
  }
}

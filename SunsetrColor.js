// Pure helpers mapping sunsetr's live temperature/gamma to bar-icon color and
// opacity. No Qt imports so this can also run under `node` (see tests/), and
// nothing here knows about hex notation - colors move in and out as {r,g,b,a}
// floats, which is what QML hands over anyway.

// Tested as `x >= 0` rather than `x < 0` so that NaN lands on 0 instead of
// falling through both comparisons untouched. A NaN here doesn't stay local:
// it rides every channel out of mixChannels and reaches QML as an unusable
// color, so it's cheapest to stop it at the gate.
function clamp01(x) {
  return x >= 0 ? (x > 1 ? 1 : x) : 0
}

// 0 at dayTemp (cool end) .. 1 at nightTemp (warm end), clamped. Handles
// dayTemp < nightTemp or dayTemp === nightTemp without dividing badly.
function warmth(currentTemp, dayTemp, nightTemp) {
  if (currentTemp === null || currentTemp === undefined) return 0
  if (dayTemp === nightTemp) return 0
  var t = (dayTemp - currentTemp) / (dayTemp - nightTemp)
  return clamp01(t)
}

function lerp(from, to, f) {
  return from + (to - from) * f
}

// Alpha is optional on the way in and defaults to opaque, so a caller holding
// a plain {r,g,b} isn't silently rendered invisible.
function alphaOf(c) {
  return c.a === undefined || c.a === null ? 1 : clamp01(c.a)
}

// Mix two colors channel-wise by fraction t (0..1, clamped). Takes and returns
// {r,g,b,a} floats in 0..1 - exactly the shape a QML `color` already exposes -
// so callers hand over color values directly rather than round-tripping them
// through a hex string. That round-trip used to drop alpha on the floor: any
// color carrying one stringifies to 8 digits, which a 6-digit parse rejects,
// and the icon went black with no warning. Here alpha is just a fourth channel.
function mixChannels(from, to, t) {
  var f = clamp01(t)
  return {
    r: lerp(clamp01(from.r), clamp01(to.r), f),
    g: lerp(clamp01(from.g), clamp01(to.g), f),
    b: lerp(clamp01(from.b), clamp01(to.b), f),
    a: lerp(alphaOf(from), alphaOf(to), f)
  }
}

// warmth (0-1) + gamma (0-100%) -> how far sunsetr has moved from neutral,
// whichever signal (color or dimming) has moved furthest. 0 at true peak
// daytime (dayTemp, day_gamma=100), 1 when either signal is maxed out.
function activity(warmth, gamma) {
  var dimming = gamma === null || gamma === undefined ? 0 : clamp01((100 - gamma) / 100)
  return Math.max(clamp01(warmth), dimming)
}

// warmth (0-1) + gamma (0-100%) -> icon opacity. The icon should recede at
// neutral - full daylight, no dimming - and draw the eye the more sunsetr is
// actually altering the display, whether that's by color (warmth) or by
// dimming (gamma below 100).
function opacityForState(warmth, gamma) {
  return 0.35 + activity(warmth, gamma) * 0.65
}

// "sunset" -> "Sunset". Falls back to a generic title-case rather than
// hiding the period entirely if sunsetr ever reports something unexpected.
function periodLabel(period) {
  var p = String(period || "")
  if (p === "") return ""
  return p.charAt(0).toUpperCase() + p.slice(1)
}

// Fixed period cycle sunsetr's geo/manual transition modes both follow.
// sunsetr's status output reports the current period but not the name of
// the next one (only its start timestamp), so the next name is derived here.
var PERIOD_CYCLE = { day: "sunset", sunset: "night", night: "sunrise", sunrise: "day" }

function nextPeriodName(period) {
  var p = String(period || "")
  return PERIOD_CYCLE[p] || ""
}

// Milliseconds remaining -> "1h12m" / "1h" / "12m" / "1m" / "now". Rounds up
// so a countdown never reads "0m" while time still remains, and never goes
// negative once the target timestamp has passed.
function formatCountdown(remainingMs) {
  var ms = Number(remainingMs)
  if (!isFinite(ms) || ms <= 0) return "now"
  var totalMinutes = Math.ceil(ms / 60000)
  var hours = Math.floor(totalMinutes / 60)
  var minutes = totalMinutes % 60
  if (hours <= 0) return minutes + "m"
  return minutes > 0 ? hours + "h" + minutes + "m" : hours + "h"
}

if (typeof module !== "undefined") {
  module.exports = {
    clamp01: clamp01,
    warmth: warmth,
    lerp: lerp,
    alphaOf: alphaOf,
    mixChannels: mixChannels,
    activity: activity,
    opacityForState: opacityForState,
    periodLabel: periodLabel,
    nextPeriodName: nextPeriodName,
    formatCountdown: formatCountdown
  }
}

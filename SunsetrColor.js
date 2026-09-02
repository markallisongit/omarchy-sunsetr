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

// 52.1364 -> "52.1°N" (matches the 1-decimal precision `sunsetr get` itself
// rounds coordinates to - this is a "does this look like the right place"
// hint, not a value anything recomputes from). null/undefined/non-finite
// input (sunsetr not installed yet, or the probe hasn't landed) -> "".
function formatLocation(lat, lon) {
  var latNum = Number(lat)
  var lonNum = Number(lon)
  if (lat === null || lat === undefined || lon === null || lon === undefined ||
      !isFinite(latNum) || !isFinite(lonNum)) {
    return ""
  }
  var latDir = latNum >= 0 ? "N" : "S"
  var lonDir = lonNum >= 0 ? "E" : "W"
  return Math.abs(latNum).toFixed(1) + "°" + latDir + ", " +
    Math.abs(lonNum).toFixed(1) + "°" + lonDir
}

// First non-blank string among the arguments, trimmed; "" if none qualify.
// Guards against a field that's present but the wrong type (a number, say) -
// coercing that into text would produce a placename nobody asked for.
function firstNonBlankString() {
  for (var i = 0; i < arguments.length; i++) {
    var s = arguments[i]
    if (typeof s === "string" && s.trim() !== "") return s.trim()
  }
  return ""
}

// countryCode ("gb") -> "GB" if it's exactly 2 letters once trimmed, else ""
// - anything else (a 3-letter code, a non-string) isn't a code this popup's
// fixed width can trust, so the caller falls back to the full country name.
function countryAbbrev(countryCode) {
  if (typeof countryCode !== "string") return ""
  var trimmed = countryCode.trim()
  return /^[A-Za-z]{2}$/.test(trimmed) ? trimmed.toUpperCase() : ""
}

// BigDataCloud's reverse-geocode-client response -> "Cambridge, GB".
// city/locality/principalSubdivision are tried in that order since rural or
// remote coordinates often only populate the coarser fields; country alone
// (open ocean, Antarctica) still beats showing nothing. The country half
// prefers the 2-letter code over countryName - BigDataCloud's names run long
// ("United Kingdom of Great Britain and Northern Ireland"), and this popup
// is a narrow fixed-width card, not a report. "" only when the response has
// no usable text at all, which tells the caller to fall back to raw
// coordinates instead.
// Bounds the assembled name the same way SunsetrGeocode.js bounds search
// suggestions: this is remote text landing in a narrow fixed-width line, so
// cap what a misbehaving (or tampered-with) API can hand the shell to lay
// out. Generous enough that no real "City, CC" pair is ever clipped - the
// countryCode preference above already keeps the long half short.
var MAX_PLACE_NAME_CHARS = 80

function formatPlaceName(geo) {
  if (!geo || typeof geo !== "object") return ""
  var primary = firstNonBlankString(geo.city, geo.locality, geo.principalSubdivision)
  var country = countryAbbrev(geo.countryCode) || firstNonBlankString(geo.countryName)
  var name = (primary && country) ? primary + ", " + country : (primary || country)
  return name.length > MAX_PLACE_NAME_CHARS ? name.slice(0, MAX_PLACE_NAME_CHARS) : name
}

// Same location, within float round-trip noise (JSON stringify/parse, string
// coordinates from `sunsetr get`). null/undefined/non-finite on either side
// never matches - that's "no reading yet", not "the same reading again".
function coordsMatch(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lat1 === undefined || lon1 === null || lon1 === undefined) return false
  if (lat2 === null || lat2 === undefined || lon2 === null || lon2 === undefined) return false
  var a = Number(lat1), b = Number(lon1), c = Number(lat2), d = Number(lon2)
  if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return false
  return Math.abs(a - c) < 1e-6 && Math.abs(b - d) < 1e-6
}

// Raw text of the on-disk geocode cache -> the cached place name, or null if
// it's missing, corrupt, for a different location, or was cached with no
// usable name (an ocean/Antarctica-style "" is retried rather than "cached"
// forever, since the API's answer for that spot could later improve). Never
// throws: a torn or pre-feature-empty cache file is just a miss, not a crash.
function parseGeocodeCache(text, lat, lon) {
  if (!text) return null
  var data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return null
  }
  if (!data || typeof data !== "object") return null
  if (!coordsMatch(data.lat, data.lon, lat, lon)) return null
  // Bounded on the way back out too, not just when formatPlaceName wrote it:
  // the cache is a plain file in a user-writable directory, so what comes
  // back isn't necessarily what this widget put there.
  var name = typeof data.placeName === "string" ? data.placeName.trim() : ""
  if (name.length > MAX_PLACE_NAME_CHARS) name = name.slice(0, MAX_PLACE_NAME_CHARS)
  return name ? name : null
}

// Which of the two name sources the cached entry came from: a suggestion the
// user picked ("picker" - never left this machine) or a reverse-geocode
// lookup ("lookup" - obtained under consent, and forgotten when it is
// withdrawn). Read separately from parseGeocodeCache rather than widening its
// return value, since every other caller only ever wants the name. "" for a
// cache written before this field existed, which is treated as a lookup:
// assuming the more sensitive origin is the safe way to be wrong.
function parseGeocodeCacheSource(text) {
  if (!text) return ""
  var data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return ""
  }
  if (!data || typeof data !== "object") return ""
  return data.source === "picker" ? "picker" : "lookup"
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
    formatCountdown: formatCountdown,
    formatLocation: formatLocation,
    formatPlaceName: formatPlaceName,
    coordsMatch: coordsMatch,
    parseGeocodeCache: parseGeocodeCache,
    parseGeocodeCacheSource: parseGeocodeCacheSource
  }
}

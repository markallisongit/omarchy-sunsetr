// Run: node tests/color.test.js
const assert = require("node:assert/strict")
const C = require("../SunsetrColor.js")

// warmth()
assert.equal(C.warmth(6500, 6500, 3500), 0, "day temp -> fully cool")
assert.equal(C.warmth(3500, 6500, 3500), 1, "night temp -> fully warm")
assert.equal(C.warmth(5000, 6500, 3500), 0.5, "midpoint -> half warmth")
assert.equal(C.warmth(9000, 6500, 3500), 0, "above day temp clamps to 0")
assert.equal(C.warmth(1000, 6500, 3500), 1, "below night temp clamps to 1")
assert.equal(C.warmth(null, 6500, 3500), 0, "null temp -> 0, not NaN")
assert.equal(C.warmth(5000, 6500, 6500), 0, "equal day/night temps never divides by zero")
assert.equal(C.warmth(NaN, 6500, 3500), 0, "NaN temp -> 0, never propagates")
assert.equal(C.warmth("nonsense", 6500, 3500), 0, "unparseable temp -> 0, never propagates")
assert.equal(C.warmth(5000, 3500, 6500), 0.5, "inverted day/night range still interpolates")

// clamp01
assert.equal(C.clamp01(NaN), 0, "NaN clamps to 0 rather than passing through")
assert.equal(C.clamp01(-0.5), 0)
assert.equal(C.clamp01(1.5), 1)
assert.equal(C.clamp01(0.25), 0.25)

// mixChannels
const black = { r: 0, g: 0, b: 0, a: 1 }
const white = { r: 1, g: 1, b: 1, a: 1 }

assert.deepEqual(C.mixChannels(black, white, 0), { r: 0, g: 0, b: 0, a: 1 })
assert.deepEqual(C.mixChannels(black, white, 1), { r: 1, g: 1, b: 1, a: 1 })
assert.deepEqual(C.mixChannels(black, white, 0.5), { r: 0.5, g: 0.5, b: 0.5, a: 1 })
assert.deepEqual(C.mixChannels(black, white, -1), black, "clamps below 0")
assert.deepEqual(C.mixChannels(black, white, 2), white, "clamps above 1")
assert.deepEqual(C.mixChannels(black, white, NaN), black, "NaN fraction yields a real color")

// Alpha is a fourth channel, not something dropped en route. This is the case
// the old hex round trip got wrong: a translucent color came back as black.
assert.deepEqual(
  C.mixChannels({ r: 0, g: 0, b: 0, a: 0 }, { r: 1, g: 1, b: 1, a: 1 }, 0.5),
  { r: 0.5, g: 0.5, b: 0.5, a: 0.5 },
  "alpha interpolates alongside rgb")
assert.equal(C.mixChannels({ r: 1, g: 0, b: 0, a: 0.25 }, white, 0).a, 0.25,
  "a translucent endpoint keeps its alpha instead of going opaque or black")

// Missing alpha means opaque, never invisible.
assert.equal(C.alphaOf({ r: 0, g: 0, b: 0 }), 1, "absent alpha defaults to opaque")
assert.equal(C.alphaOf({ r: 0, g: 0, b: 0, a: null }), 1, "null alpha defaults to opaque")
assert.equal(C.alphaOf({ r: 0, g: 0, b: 0, a: 0.5 }), 0.5)
assert.deepEqual(C.mixChannels({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 0.5),
  { r: 0.5, g: 0.5, b: 0.5, a: 1 }, "plain {r,g,b} endpoints mix as opaque")

// Out-of-range channels are clamped rather than propagated.
assert.deepEqual(C.mixChannels({ r: -1, g: 2, b: NaN, a: 1 }, white, 0),
  { r: 0, g: 1, b: 0, a: 1 }, "channels clamp, NaN included")

// opacityForState
assert.equal(C.opacityForState(0, 100), 0.35, "neutral (full daylight, no dimming) -> recedes to the floor")
assert.equal(C.opacityForState(1, 100), 1, "full warmth alone -> fully opaque")
assert.equal(C.opacityForState(0, 0), 1, "full dimming alone -> fully opaque")
assert.equal(C.opacityForState(0.5, 100), 0.675, "warmth is the stronger signal here, drives opacity")
assert.equal(C.opacityForState(0, null), 0.35, "unknown gamma treated as no dimming, not full opacity")
assert.ok(Math.abs(C.opacityForState(0.4, 90) - 0.61) < 1e-9, "gamma's mild dimming (0.1) loses to warmth (0.4)")
assert.equal(C.opacityForState(NaN, NaN), 0.35, "NaN inputs fall back to the neutral floor, not NaN opacity")

// activity()
assert.equal(C.activity(0, 100), 0, "peak daytime (no warmth, no dimming) -> zero activity")
assert.equal(C.activity(1, 100), 1, "full warmth alone -> full activity")
assert.equal(C.activity(0, 0), 1, "full dimming alone -> full activity")
assert.equal(C.activity(0.5, 100), 0.5, "warmth alone drives activity when gamma is full")
assert.equal(C.activity(0, null), 0, "unknown gamma treated as no dimming, not full activity")
assert.ok(Math.abs(C.activity(0.4, 90) - 0.4) < 1e-9, "the stronger of warmth/dimming wins")

// opacityForState still matches its old behavior, now expressed via activity()
assert.equal(C.opacityForState(0, 100), 0.35 + 0 * 0.65)
assert.equal(C.opacityForState(1, 100), 0.35 + 1 * 0.65)
assert.equal(C.opacityForState(0.5, 100), 0.35 + C.activity(0.5, 100) * 0.65)

// periodLabel()
assert.equal(C.periodLabel("sunset"), "Sunset")
assert.equal(C.periodLabel("day"), "Day")
assert.equal(C.periodLabel("night"), "Night")
assert.equal(C.periodLabel("sunrise"), "Sunrise")
assert.equal(C.periodLabel(""), "", "empty period -> empty label, not 'undefined' or a crash")
assert.equal(C.periodLabel(null), "")
assert.equal(C.periodLabel("weird"), "Weird", "unrecognized period still title-cases rather than hiding")

// nextPeriodName()
assert.equal(C.nextPeriodName("day"), "sunset")
assert.equal(C.nextPeriodName("sunset"), "night")
assert.equal(C.nextPeriodName("night"), "sunrise")
assert.equal(C.nextPeriodName("sunrise"), "day")
assert.equal(C.nextPeriodName(""), "", "unknown period has no derivable next period")
assert.equal(C.nextPeriodName("weird"), "")

// formatCountdown()
assert.equal(C.formatCountdown(0), "now")
assert.equal(C.formatCountdown(-5000), "now", "already-passed timestamps never show a negative countdown")
assert.equal(C.formatCountdown(30 * 1000), "1m", "sub-minute remainders round up rather than showing 0m")
assert.equal(C.formatCountdown(12 * 60 * 1000), "12m")
assert.equal(C.formatCountdown(72 * 60 * 1000), "1h12m")
assert.equal(C.formatCountdown(60 * 60 * 1000), "1h", "exact hour omits a redundant 0m")
assert.equal(C.formatCountdown(125 * 60 * 1000), "2h5m")

// formatLocation()
assert.equal(C.formatLocation(52.1364, -0.4668), "52.1°N, 0.5°W")
assert.equal(C.formatLocation(-33.8688, 151.2093), "33.9°S, 151.2°E", "negative lat/positive lon -> S/E")
assert.equal(C.formatLocation(0, 0), "0.0°N, 0.0°E", "the equator/prime meridian aren't negative")
assert.equal(C.formatLocation(null, null), "", "no coordinates yet (sunsetr missing or probe pending) -> empty, not '0.0°N, 0.0°E'")
assert.equal(C.formatLocation(undefined, undefined), "")
assert.equal(C.formatLocation("52.1", "-0.5"), "52.1°N, 0.5°W", "sunsetr get returns strings, not numbers")

// formatPlaceName()
// countryCode (2-letter, e.g. "GB") is preferred over countryName - the
// popup is a narrow fixed-width card, and a full name like BigDataCloud's
// "United Kingdom of Great Britain and Northern Ireland" blows straight
// through it (see the 2026-08-31 screenshot: "Bedford, United Kingdom of...").
assert.equal(C.formatPlaceName({ city: "Cambridge", countryCode: "GB", countryName: "United Kingdom of Great Britain and Northern Ireland" }),
  "Cambridge, GB", "short code wins over a long country name")
assert.equal(C.formatPlaceName({ locality: "Foo", countryCode: "us" }), "Foo, US",
  "falls back to locality when city is absent; code is uppercased")
assert.equal(C.formatPlaceName({ principalSubdivision: "Region", countryName: "Country" }),
  "Region, Country", "no countryCode at all -> falls back to countryName, as before")
assert.equal(C.formatPlaceName({ countryCode: "AQ" }), "AQ",
  "country code alone is still a usable name")
assert.equal(C.formatPlaceName({ city: "Solo" }), "Solo", "city alone, no country")
assert.equal(C.formatPlaceName({}), "", "nothing usable -> empty, not 'undefined, undefined'")
assert.equal(C.formatPlaceName(null), "")
assert.equal(C.formatPlaceName(undefined), "")
assert.equal(C.formatPlaceName("not an object"), "")

// Bounded like the search suggestions in SunsetrGeocode.js: this is remote
// text landing in a narrow fixed-width line, so a misbehaving API can't hand
// the shell an arbitrarily long name to lay out.
assert.equal(C.formatPlaceName({ city: "c".repeat(500), countryCode: "GB" }).length, 80,
  "an overlong city is clipped, not rendered in full")
assert.equal(C.formatPlaceName({ city: "Cambridge", countryCode: "GB" }), "Cambridge, GB",
  "a name that fits is passed through untouched")

// The on-disk cache is bounded on read too - it's a plain file in a
// user-writable directory, so what comes back isn't necessarily what
// formatPlaceName put there.
assert.equal(
  C.parseGeocodeCache(JSON.stringify({ lat: 52.2, lon: 0.12, placeName: "p".repeat(500) }), 52.2, 0.12).length,
  80)
assert.equal(
  C.parseGeocodeCache(JSON.stringify({ lat: 52.2, lon: 0.12, placeName: "Cambridge, GB" }), 52.2, 0.12),
  "Cambridge, GB")
assert.equal(C.formatPlaceName({ city: "", countryCode: "GB" }), "GB",
  "empty-string city is treated as absent, not as a real (blank) name")
assert.equal(C.formatPlaceName({ city: "   " }), "", "whitespace-only city is treated as absent")
assert.equal(C.formatPlaceName({ city: "  Zurich  ", countryCode: " ch " }),
  "Zurich, CH", "surrounding whitespace is trimmed before the 2-letter check")
assert.equal(C.formatPlaceName({ city: 123, countryCode: "GB" }), "GB",
  "non-string city is ignored rather than coerced into the name")
assert.equal(C.formatPlaceName({ city: "X", countryCode: "USA", countryName: "United States" }),
  "X, United States", "a code that isn't exactly 2 letters falls back to countryName")
assert.equal(C.formatPlaceName({ city: "X", countryCode: 42 }), "X",
  "non-string countryCode is ignored, not stringified into the name")

// coordsMatch()
assert.equal(C.coordsMatch(52.1, -0.5, 52.1, -0.5), true)
assert.equal(C.coordsMatch(52.1, -0.5, 52.1 + 1e-9, -0.5), true, "sub-epsilon float noise still matches")
assert.equal(C.coordsMatch(52.1, -0.5, 52.2, -0.5), false)
assert.equal(C.coordsMatch(null, -0.5, 52.1, -0.5), false, "null on either side never matches")
assert.equal(C.coordsMatch(52.1, -0.5, undefined, -0.5), false)
assert.equal(C.coordsMatch(NaN, -0.5, 52.1, -0.5), false)
assert.equal(C.coordsMatch("52.1", "-0.5", 52.1, -0.5), true, "numeric strings coerce like formatLocation")

// parseGeocodeCache()
const payload = JSON.stringify({ lat: 52.1, lon: -0.5, placeName: "Cambridge, United Kingdom" })
assert.equal(C.parseGeocodeCache(payload, 52.1, -0.5), "Cambridge, United Kingdom",
  "matching coordinates return the cached name")
assert.equal(C.parseGeocodeCache(payload, 10, 10), null,
  "a cache entry for a different location is a miss, not a wrong answer")
assert.equal(C.parseGeocodeCache("", 52.1, -0.5), null, "no cache file yet -> miss")
assert.equal(C.parseGeocodeCache("not json {{{", 52.1, -0.5), null,
  "corrupt/truncated cache file -> miss, not a crash")
assert.equal(C.parseGeocodeCache("42", 52.1, -0.5), null, "a JSON scalar isn't a cache entry")
assert.equal(C.parseGeocodeCache(JSON.stringify({ lat: 52.1, lon: -0.5 }), 52.1, -0.5), null,
  "missing placeName -> miss")
assert.equal(C.parseGeocodeCache(JSON.stringify({ lat: 52.1, lon: -0.5, placeName: "" }), 52.1, -0.5), null,
  "an empty cached name is treated as no cache, so it's retried rather than displayed")

console.log("ok")

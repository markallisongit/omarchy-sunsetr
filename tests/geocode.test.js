// Run: node tests/geocode.test.js
const assert = require("node:assert/strict")
const Geocode = require("../SunsetrGeocode.js")

// Well-formed Open-Meteo response -> suggestion rows, region joins admin1+country.
assert.deepEqual(
  Geocode.parseForwardGeocodingResults(JSON.stringify({
    results: [
      { name: "Cambridge", admin1: "England", country: "United Kingdom", latitude: 52.2, longitude: 0.12 },
      { name: "Cambridge", admin1: "Massachusetts", country: "United States", latitude: 42.37, longitude: -71.1 }
    ]
  })),
  [
    { name: "Cambridge", description: "England, United Kingdom", country: "United Kingdom", latitude: 52.2, longitude: 0.12 },
    { name: "Cambridge", description: "Massachusetts, United States", country: "United States", latitude: 42.37, longitude: -71.1 }
  ]
)

// Missing admin1 (a country-level result) -> region is just the country.
assert.deepEqual(
  Geocode.parseForwardGeocodingResults(JSON.stringify({
    results: [{ name: "Tokyo", country: "Japan", latitude: 35.68, longitude: 139.69 }]
  })),
  [{ name: "Tokyo", description: "Japan", country: "Japan", latitude: 35.68, longitude: 139.69 }]
)

// No matches, an empty body, and malformed JSON all resolve to an empty list
// rather than throwing - a network hiccup shouldn't crash the picker.
assert.deepEqual(Geocode.parseForwardGeocodingResults(JSON.stringify({ results: [] })), [])
assert.deepEqual(Geocode.parseForwardGeocodingResults(""), [])
assert.deepEqual(Geocode.parseForwardGeocodingResults("not json"), [])

// A result missing coordinates or a name is skipped rather than passed
// through half-formed.
assert.deepEqual(
  Geocode.parseForwardGeocodingResults(JSON.stringify({
    results: [{ name: "Nowhere", latitude: 1 }, { admin1: "X", latitude: 1, longitude: 2 }]
  })),
  []
)

// resolveLocationCommit picks the highlighted suggestion, clamped to bounds.
var suggestions = [
  { name: "A", latitude: 1, longitude: 1 },
  { name: "B", latitude: 2, longitude: 2 }
]
assert.deepEqual(Geocode.resolveLocationCommit(suggestions, 0), suggestions[0])
assert.deepEqual(Geocode.resolveLocationCommit(suggestions, 1), suggestions[1])
assert.deepEqual(Geocode.resolveLocationCommit(suggestions, 5), suggestions[1],
  "out-of-range index clamps to the last suggestion")
assert.deepEqual(Geocode.resolveLocationCommit(suggestions, -1), suggestions[0],
  "negative index clamps to the first suggestion")

// Nothing to commit when there are no suggestions yet - typed text alone
// isn't a location sunsetr can use, unlike the weather widget's name-only
// fallback, since sunsetr requires real coordinates to switch into geo mode.
assert.equal(Geocode.resolveLocationCommit([], 0), null)
assert.equal(Geocode.resolveLocationCommit(null, 0), null)

// Remote strings are truncated to a bounded length. The dropdown is a narrow
// card, and nothing that reaches it should be able to hand the shell an
// arbitrarily long string to lay out.
const longName = "x".repeat(500)
const bounded = Geocode.parseForwardGeocodingResults(JSON.stringify({
  results: [{ name: longName, admin1: "y".repeat(500), country: "z".repeat(500), latitude: 1, longitude: 2 }]
}))
assert.equal(bounded.length, 1)
assert.equal(bounded[0].name.length, 80)
assert.equal(bounded[0].description.length, 120)
assert.ok(longName.startsWith(bounded[0].name))

// Names that fit are passed through untouched - bounding only ever clips.
assert.equal(
  Geocode.parseForwardGeocodingResults(JSON.stringify({
    results: [{ name: "Cambridge", country: "United Kingdom", latitude: 52.2, longitude: 0.12 }]
  }))[0].name,
  "Cambridge"
)

// The result list itself is capped client-side, not just by the query's
// count=5 - a server that ignores that parameter can't flood the dropdown.
const flood = Array.from({ length: 200 }, (_, i) => (
  { name: "Place " + i, country: "Nowhere", latitude: i, longitude: i }
))
assert.equal(Geocode.parseForwardGeocodingResults(JSON.stringify({ results: flood })).length, 5)

// A suggestion the user picked already carries its own place name, so
// committing it never needs a reverse-geocode lookup - the name is joined
// here rather than being asked of a third party.
assert.equal(
  Geocode.formatSuggestionPlaceName({ name: "Cambridge", country: "United Kingdom" }),
  "Cambridge, United Kingdom"
)

// No country (a result Open-Meteo returned without one) still gives a usable
// name rather than a trailing-comma fragment.
assert.equal(Geocode.formatSuggestionPlaceName({ name: "Cambridge" }), "Cambridge")
assert.equal(Geocode.formatSuggestionPlaceName({ name: "Cambridge", country: "" }), "Cambridge")

// Nothing usable in, nothing out - the caller falls back to raw coordinates.
assert.equal(Geocode.formatSuggestionPlaceName(null), "")
assert.equal(Geocode.formatSuggestionPlaceName({}), "")
assert.equal(Geocode.formatSuggestionPlaceName({ country: "United Kingdom" }), "")

// Bounded to the same 80 characters as a reverse-geocoded name: this string
// is remote text landing in the same narrow popup line.
const longSuggestion = Geocode.formatSuggestionPlaceName({
  name: "a".repeat(60), country: "b".repeat(60)
})
assert.equal(longSuggestion.length, 80)

// --- What the consent gate actually gates -------------------------------
// nextGeocodeStep is the whole decision about whether coordinates leave this
// machine, pulled out of Service.qml so it can be asserted directly.

// The invariant that matters: "fetch" - the only step that transmits - is
// unreachable without opt-in, whatever else is true.
assert.equal(Geocode.nextGeocodeStep(true, null, false), "ask")
assert.equal(Geocode.nextGeocodeStep(true, "", false), "ask")
assert.equal(Geocode.nextGeocodeStep(true, null, true), "fetch")

// A name we already hold locally (picked from the dropdown, or in the
// on-disk cache from an earlier opted-in lookup) is displayed without asking
// and without transmitting. Consent gates the transfer, not the display.
assert.equal(Geocode.nextGeocodeStep(true, "Cambridge, United Kingdom", false), "resolved")
assert.equal(Geocode.nextGeocodeStep(true, "Cambridge, United Kingdom", true), "resolved")

// No coordinates: nothing to look up and nothing to consent to, so the popup
// must not offer a prompt that would send nothing anywhere.
assert.equal(Geocode.nextGeocodeStep(false, null, false), "none")
assert.equal(Geocode.nextGeocodeStep(false, null, true), "none")
assert.equal(Geocode.nextGeocodeStep(false, "Cambridge, United Kingdom", true), "none")

// --- Which cached names may be shown ------------------------------------
// A picked suggestion's name never left the machine, so showing it needs no
// permission and survives the opt-in being off or withdrawn.
assert.equal(Geocode.usableCachedName("Cambridge, United Kingdom", "picker", false), "Cambridge, United Kingdom")
assert.equal(Geocode.usableCachedName("Cambridge, United Kingdom", "picker", true), "Cambridge, United Kingdom")

// A looked-up name is only shown while the opt-in that produced it stands.
// This is also the migration path: a cache from a version with no consent
// flow reads back as "lookup", so it is re-asked about, not silently shown.
assert.equal(Geocode.usableCachedName("Bedford, GB", "lookup", true), "Bedford, GB")
assert.equal(Geocode.usableCachedName("Bedford, GB", "lookup", false), null)
assert.equal(Geocode.usableCachedName("Bedford, GB", "", false), null)

// Nothing cached is nothing to show, whatever the opt-in says.
assert.equal(Geocode.usableCachedName(null, "picker", true), null)
assert.equal(Geocode.usableCachedName("", "picker", true), null)

// Composed with nextGeocodeStep, an opted-out user holding only a
// lookup-sourced cache is asked rather than shown, and still sends nothing.
assert.equal(
  Geocode.nextGeocodeStep(true, Geocode.usableCachedName("Bedford, GB", "lookup", false), false),
  "ask")
assert.equal(
  Geocode.nextGeocodeStep(true, Geocode.usableCachedName("Cambridge, United Kingdom", "picker", false), false),
  "resolved")

// --- Binding a picked name to the location that comes back ---------------
// sunsetr reports coordinates rounded (currently to 1dp) rather than at the
// precision it stores them: a config holding 51.879670 probes back as "51.9".
// So the name of a picked suggestion cannot be filed under the coordinates it
// was picked at - nothing would ever look there. isPickedLocation is what
// lets the probe that follows the change claim it instead.
assert.equal(Geocode.isPickedLocation(52.2, 0.1, 52.2053, 0.1218, 0.06), true,
  "1dp rounding of the picked coordinates still identifies the same place")
assert.equal(Geocode.isPickedLocation(51.9, -0.4, 51.87967, -0.41748, 0.06), true,
  "negative coordinates round the same way")
assert.equal(Geocode.isPickedLocation(52.2053, 0.1218, 52.2053, 0.1218, 0.06), true,
  "an exact match still matches, if sunsetr ever reports full precision")

// A different location must never claim the pending name.
assert.equal(Geocode.isPickedLocation(42.37, -71.1, 52.2053, 0.1218, 0.06), false)
assert.equal(Geocode.isPickedLocation(52.4, 0.1218, 52.2053, 0.1218, 0.06), false,
  "beyond the tolerance in latitude alone is still a different place")
assert.equal(Geocode.isPickedLocation(52.2053, 0.4, 52.2053, 0.1218, 0.06), false,
  "beyond the tolerance in longitude alone is still a different place")

// Nothing pending, or nothing probed, claims nothing.
assert.equal(Geocode.isPickedLocation(52.2, 0.1, null, null, 0.06), false)
assert.equal(Geocode.isPickedLocation(null, null, 52.2053, 0.1218, 0.06), false)
assert.equal(Geocode.isPickedLocation(52.2, 0.1, undefined, 0.1218, 0.06), false)

console.log("ok")

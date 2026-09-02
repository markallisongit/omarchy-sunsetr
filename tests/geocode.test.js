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
    { name: "Cambridge", description: "England, United Kingdom", latitude: 52.2, longitude: 0.12 },
    { name: "Cambridge", description: "Massachusetts, United States", latitude: 42.37, longitude: -71.1 }
  ]
)

// Missing admin1 (a country-level result) -> region is just the country.
assert.deepEqual(
  Geocode.parseForwardGeocodingResults(JSON.stringify({
    results: [{ name: "Tokyo", country: "Japan", latitude: 35.68, longitude: 139.69 }]
  })),
  [{ name: "Tokyo", description: "Japan", latitude: 35.68, longitude: 139.69 }]
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

console.log("ok")

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

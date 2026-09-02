// Pure helpers for turning free-text location search into sunsetr
// coordinates. No Qt imports so this can also run under `node` (see tests/),
// matching SunsetrColor.js/SunsetrControl.js.

// Open-Meteo's free, keyless geocoding search response -> suggestion rows
// for the location picker. Mirrors the shape the weather plugin's own
// Model.js already builds from the same API - kept independent here since
// plugins in this shell don't share code across directories.
// Remote text is bounded before it can reach the popup. The suggestion
// dropdown is a narrow fixed-width card and no real place name needs more
// room than this, so a geocoder that misbehaves - or one that has been
// tampered with upstream - can't hand the shell a megabyte-long name (or
// hundreds of results) to lay out. count=5 is already asked for in the query
// string; this is the client-side half that doesn't depend on the server
// honouring it. Pairs with textFormat: Text.PlainText in BarWidget.qml,
// which stops these same strings being interpreted as markup.
var MAX_SUGGESTIONS = 5
var MAX_NAME_CHARS = 80
var MAX_DESCRIPTION_CHARS = 120
// The same cap SunsetrColor.js's formatPlaceName applies to a reverse-geocoded
// name, for the same reason: whichever of the two produced it, the string ends
// up in the same narrow popup line.
var MAX_PLACE_NAME_CHARS = 80

// Truncates rather than rejects: a too-long name is far more likely to be a
// genuinely verbose result than an attack, and showing its first 80
// characters is more useful than dropping the row entirely.
function boundedText(value, limit) {
  var text = String(value === null || value === undefined ? "" : value)
  return text.length > limit ? text.slice(0, limit) : text
}

function parseForwardGeocodingResults(raw) {
  var data
  try {
    data = JSON.parse(String(raw || "{}"))
  } catch (e) {
    return []
  }
  var results = data && data.results
  if (!results || !results.length) return []

  var out = []
  for (var i = 0; i < results.length; i++) {
    if (out.length >= MAX_SUGGESTIONS) break
    var r = results[i]
    if (!r || !r.name || r.latitude === undefined || r.longitude === undefined) continue
    var region = [r.admin1, r.country].filter(function(part) { return !!part }).join(", ")
    out.push({
      name: boundedText(r.name, MAX_NAME_CHARS),
      description: boundedText(region, MAX_DESCRIPTION_CHARS),
      // Carried separately from `description` (which is admin1 + country, the
      // disambiguator the dropdown shows) because formatSuggestionPlaceName
      // wants the country alone - "Cambridge, United Kingdom", not
      // "Cambridge, England, United Kingdom".
      country: boundedText(r.country, MAX_NAME_CHARS),
      latitude: r.latitude,
      longitude: r.longitude
    })
  }
  return out
}

// The suggestion the picker should commit on Enter: whichever one is
// currently highlighted, clamped to the list's bounds so a stale index (the
// list shrank after the highlight moved) never reaches past the end. null
// when there's nothing to commit - typed text alone isn't a location
// sunsetr can use, unlike the weather widget's name-only fallback, since
// sunsetr requires real coordinates to switch into geo mode.
function resolveLocationCommit(suggestions, selectedIndex) {
  var choices = suggestions || []
  if (!choices.length) return null
  var index = Math.max(0, Math.min(parseInt(selectedIndex, 10) || 0, choices.length - 1))
  return choices[index] || null
}

// The place name for a suggestion the user just picked. This is the reason
// the common case never needs a reverse-geocode lookup at all: the user typed
// a query and chose a result, so the name is already in hand - asking a third
// party to turn the coordinates back into the name they came from would send
// the user's location out for something already known locally.
function formatSuggestionPlaceName(choice) {
  if (!choice || typeof choice !== "object") return ""
  var name = String(choice.name || "").trim()
  if (!name) return ""
  var country = String(choice.country || "").trim()
  var full = country ? name + ", " + country : name
  return full.length > MAX_PLACE_NAME_CHARS ? full.slice(0, MAX_PLACE_NAME_CHARS) : full
}

// Whether the coordinates a probe just reported are the location a
// just-picked suggestion was for.
//
// This exists because sunsetr reports coordinates rounded - `sunsetr get
// --json latitude longitude` answers "51.9" for a config holding 51.879670 -
// so the key the next probe produces is not the key the picked suggestion
// carries. Filing the picked name under the coordinates it was picked at
// would put it where nothing ever looks; instead the probe that follows the
// change claims it, and the name is filed under whatever that probe says.
//
// The tolerance absorbs that reporting precision (1dp rounds by at most
// ~0.05 degrees) while staying far tighter than the distance between two
// places anyone would be choosing between, so a name can never be attached
// to a location the user did not pick. An exact match passes too, in case
// sunsetr's reported precision ever changes.
function isPickedLocation(probedLat, probedLon, pickedLat, pickedLon, tolerance) {
  var a = Number(probedLat), b = Number(probedLon)
  var c = Number(pickedLat), d = Number(pickedLon)
  if (probedLat === null || probedLat === undefined || probedLon === null || probedLon === undefined) return false
  if (pickedLat === null || pickedLat === undefined || pickedLon === null || pickedLon === undefined) return false
  if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return false
  return Math.abs(a - c) <= tolerance && Math.abs(b - d) <= tolerance
}

// Whether a name found in the on-disk cache may be displayed. One taken from
// a suggestion the user picked always may - it never left this machine, so no
// permission is involved in showing it. One that came from a lookup may only
// while the opt-in that produced it still stands, so that a cache written by
// a version that had no consent flow at all (source "lookup" by default) is
// re-asked about rather than silently displayed. Returns null for "no usable
// local name", which is what nextGeocodeStep wants.
function usableCachedName(name, source, optedIn) {
  if (!name) return null
  if (source === "picker") return name
  return optedIn ? name : null
}

// What the service should do next for a set of coordinates. This is the whole
// decision about whether the user's location leaves the machine, kept in one
// pure function so it can be read - and tested - on its own rather than
// inferred from the control flow of Service.qml's maybeGeocode().
//
//   "none"     - no usable coordinates; nothing to resolve, nothing to ask.
//   "resolved" - a name is already known locally (picked from the dropdown,
//                or cached from an earlier opted-in lookup). Display it.
//   "ask"      - a name would require a third-party lookup and the user has
//                not opted in. Offer the consent prompt; send nothing.
//   "fetch"    - the user has opted in and no local answer exists. Only this
//                step transmits, and it is unreachable when optedIn is false.
function nextGeocodeStep(coordsValid, localName, optedIn) {
  if (!coordsValid) return "none"
  if (localName) return "resolved"
  return optedIn ? "fetch" : "ask"
}

if (typeof module !== "undefined") {
  module.exports = {
    parseForwardGeocodingResults: parseForwardGeocodingResults,
    resolveLocationCommit: resolveLocationCommit,
    formatSuggestionPlaceName: formatSuggestionPlaceName,
    usableCachedName: usableCachedName,
    isPickedLocation: isPickedLocation,
    nextGeocodeStep: nextGeocodeStep
  }
}

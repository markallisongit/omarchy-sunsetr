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

if (typeof module !== "undefined") {
  module.exports = {
    parseForwardGeocodingResults: parseForwardGeocodingResults,
    resolveLocationCommit: resolveLocationCommit
  }
}

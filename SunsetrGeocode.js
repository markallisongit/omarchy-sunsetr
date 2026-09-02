// Pure helpers for turning free-text location search into sunsetr
// coordinates. No Qt imports so this can also run under `node` (see tests/),
// matching SunsetrColor.js/SunsetrControl.js.

// Open-Meteo's free, keyless geocoding search response -> suggestion rows
// for the location picker. Mirrors the shape the weather plugin's own
// Model.js already builds from the same API - kept independent here since
// plugins in this shell don't share code across directories.
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
    var r = results[i]
    if (!r || !r.name || r.latitude === undefined || r.longitude === undefined) continue
    var region = [r.admin1, r.country].filter(function(part) { return !!part }).join(", ")
    out.push({
      name: String(r.name),
      description: region,
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

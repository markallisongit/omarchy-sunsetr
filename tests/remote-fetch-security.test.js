// Run: node tests/remote-fetch-security.test.js
// Guards the marketplace security invariants on the two remote-response
// paths. These checks intentionally inspect the QML command declarations:
// the boundary has to exist before StdioCollector, not merely in the JS that
// parses an already-accumulated response.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const barWidget = fs.readFileSync(path.join(root, "BarWidget.qml"), "utf8")
const service = fs.readFileSync(path.join(root, "Service.qml"), "utf8")

function assertBoundedPinnedCurl(source, assignment, label) {
  const start = source.indexOf(assignment)
  assert.notEqual(start, -1, label + " command assignment must exist")
  // Each declaration is wrapped over a few lines; stop at its following
  // `.running` assignment so unrelated curl mentions cannot satisfy it.
  const end = source.indexOf(".running = true", start)
  assert.notEqual(end, -1, label + " command must be started")
  const command = source.slice(start, end)

  assert.match(command, /\["\/usr\/bin\/curl",/,
    label + " must execute curl by its trusted absolute path")
  assert.match(command, /"--max-filesize", "65536"/,
    label + " must cap bytes before stdout reaches StdioCollector")
  assert.doesNotMatch(command, /\["(?:ba)?sh"|\bcurl\b(?!")/,
    label + " must not resolve curl through a shell or ambient PATH")
}

assertBoundedPinnedCurl(barWidget, "geocodeProc.command =", "Open-Meteo fetch")
assertBoundedPinnedCurl(service, "geocodeProcess.command =", "BigDataCloud fetch")

// A failed curl includes HTTP errors, timeouts, and CURLE_FILESIZE_EXCEEDED.
// Both handlers must gate parsing on exit 0, ensuring a partial oversized
// body is never accepted even if its prefix resembles JSON.
assert.match(barWidget,
  /locationSuggestions = \(exitCode === 0 && root\.editingLocation\)[\s\S]*?parseForwardGeocodingResults/)
assert.match(service,
  /id: geocodeProcess[\s\S]*?onExited: function\(exitCode\) \{[\s\S]*?if \(exitCode !== 0\) return[\s\S]*?JSON\.parse/)

console.log("ok")

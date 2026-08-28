// Run: node tests/control.test.js
const assert = require("node:assert/strict")
const Ctrl = require("../SunsetrControl.js")

// Forced (non-default) preset always returns to default, regardless of warmth.
assert.equal(Ctrl.toggleTarget("day", 0, "day", "night"), "default")
assert.equal(Ctrl.toggleTarget("day", 1, "day", "night"), "default")
assert.equal(Ctrl.toggleTarget("night", 0.9, "day", "night"), "default")
assert.equal(Ctrl.toggleTarget("some-custom-preset", 0.5, "day", "night"), "default",
  "any non-default active preset returns to default, not just the plugin's own presets")

// Auto (default) + warm (>= midpoint) -> day preset.
assert.equal(Ctrl.toggleTarget("default", 1, "day", "night"), "day")
assert.equal(Ctrl.toggleTarget("default", 0.6, "day", "night"), "day")

// Auto (default) + cool (< midpoint) -> night preset.
assert.equal(Ctrl.toggleTarget("default", 0, "day", "night"), "night")
assert.equal(Ctrl.toggleTarget("default", 0.4, "day", "night"), "night")

// Boundary: exactly at the midpoint counts as "warm enough" -> day.
assert.equal(Ctrl.toggleTarget("default", 0.5, "day", "night"), "day")

// Uses the configured preset names verbatim, not hardcoded "day"/"night".
assert.equal(Ctrl.toggleTarget("default", 1, "sol", "luna"), "sol")
assert.equal(Ctrl.toggleTarget("default", 0, "sol", "luna"), "luna")

console.log("ok")

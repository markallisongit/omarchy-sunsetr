// Pure control logic for forcing/toggling sunsetr presets. No Qt imports so
// this can also run under `node` (see tests/), matching SunsetrColor.js.
//
// warmth is the same 0..1 value SunsetrColor.js's warmth() produces (0 at
// dayTemp, 1 at nightTemp) rather than a fixed Kelvin threshold, since this
// plugin's day/night temperatures are user-configurable.
function toggleTarget(activePreset, warmth, dayPreset, nightPreset) {
  if (String(activePreset) !== "default") return "default"
  return Number(warmth) >= 0.5 ? dayPreset : nightPreset
}

if (typeof module !== "undefined") {
  module.exports = { toggleTarget: toggleTarget }
}

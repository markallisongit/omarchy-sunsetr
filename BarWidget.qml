import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "SunsetrColor.js" as ColorModel

// Live sunsetr readout and control surface: left-click toggles day/night,
// middle-click refreshes, right-click opens a popup with Auto/Day/Night
// buttons. The icon's color runs from cool to warm amber as sunsetr's
// current temperature moves from dayTemp to nightTemp, and its opacity
// tracks gamma the same way your screen is actually dimming; at true peak
// daytime the icon collapses to width 0, reappearing on hover.
BarWidget {
  id: root
  moduleName: "mark.sunsetr"

  readonly property var service: bar?.shell?.serviceFor("mark.sunsetr") ?? null

  // shell.qml's ensureService() only injects omarchyPath/shell/manifest/
  // barWidgetRegistry/pluginRegistry onto a service singleton - never
  // settings. Settings only ever reach a widget instance, pushed by the bar
  // host's own injectProps() (see Bar.qml's ModuleSlot.injectProps and
  // Indicators.qml's IndicatorSlot.injectProps, both of which do
  // `target.settings = moduleSettings`) whenever this widget's settings
  // property changes. Since Service.qml drives dayTemp/nightTemp/dayPreset/
  // nightPreset/forceTransitionSeconds directly (toggle(), the IPC on()/
  // off(), ensureRunningAndApply()), it needs the same object mirrored onto
  // it here. Pushed on every settings change, every service-availability
  // change, and once at completion, since none of those three orderings
  // relative to each other is guaranteed.
  function pushSettingsToService() {
    if (service) service.settings = settings
  }
  onSettingsChanged: pushSettingsToService()
  onServiceChanged: pushSettingsToService()
  Component.onCompleted: pushSettingsToService()

  readonly property int dayTemp: Number(setting("dayTemp", 6500))
  readonly property int nightTemp: Number(setting("nightTemp", 3500))
  readonly property color coolColor: String(setting("coolColor", "#9fb4c7"))
  readonly property color warmColor: String(setting("warmColor", "#ff9d54"))

  readonly property string dayPresetName: String(setting("dayPreset", "day"))
  readonly property string nightPresetName: String(setting("nightPreset", "night"))

  // Zero at true peak daytime (temp at/above dayTemp AND gamma at/above
  // day_gamma) - any other state (dusk starting, night, dawn, or a forced
  // non-day preset) keeps the full continuous animation. Reuses the exact
  // "how far from neutral" value BarWidget already needed for opacity, so
  // collapse and opacity can never disagree about what "neutral" means.
  readonly property real activity: serviceReady
    ? ColorModel.activity(warmth, service.currentGamma) : 1
  readonly property bool collapsed: serviceReady && activity === 0
  // The bar already tracks "is the pointer anywhere over the center
  // section" for exactly this purpose (built-in indicators use the same
  // flag to reveal otherwise-hidden icons on hover).
  readonly property bool revealed: !!root.bar && root.bar.centerSectionRevealHeld === true
  readonly property bool peeked: collapsed && revealed

  property bool popupOpen: false
  function close() { popupOpen = false }

  // The service reports what sunsetr said; turning that into a color, an
  // opacity and a line of text is this widget's job, since it's the half that
  // owns the shell.json settings all three depend on.
  readonly property bool serviceReady: !!service && service.stateLoaded
  readonly property bool stale: serviceReady && service.stale
  readonly property real warmth: serviceReady
    ? ColorModel.warmth(service.currentTemp, dayTemp, nightTemp) : 0
  readonly property real iconOpacity: serviceReady
    ? ColorModel.opacityForState(warmth, service.currentGamma) : 1

  // Colors move as {r,g,b,a} floats rather than hex strings, so a `color`
  // never has to survive a stringify/parse round trip to get mixed.
  readonly property color liveColor: {
    var m = ColorModel.mixChannels(coolColor, warmColor, warmth)
    return Qt.rgba(m.r, m.g, m.b, m.a)
  }

  // Once the connection drops, the temperature driving this color is
  // last-known rather than live. Draining the color to grey says the hue has
  // stopped meaning anything, without touching the opacity channel - that one
  // is already spoken for, reporting how hard sunsetr is working.
  readonly property color iconColor: stale
    ? Qt.hsla(0, 0, liveColor.hslLightness, liveColor.a) : liveColor

  // Hover glance, not a debug dump: the two numbers the icon's color and
  // opacity are actually drawing from. (period/nextPeriod stay available via
  // the mark.sunsetr IPC status call for anyone who wants the fuller picture.)
  readonly property string tooltip: {
    if (!service) return "sunsetr service not loaded"
    if (service.sunsetrMissing) return "sunsetr is not installed"
    if (!service.stateLoaded) return "loading…"
    var temp = service.currentTemp
    var gamma = service.currentGamma
    return (temp !== null && temp !== undefined ? temp + "K" : "—") + " · " +
      (gamma !== null && gamma !== undefined ? Math.round(gamma) + "% brightness" : "—") +
      (stale ? " · sunsetr disconnected" : "")
  }

  implicitWidth: collapsed && !revealed ? 0 : button.implicitWidth
  implicitHeight: button.implicitHeight

  // Activity opacity rides on the widget root rather than on the button. The
  // button's own `opacity` is a binding in WidgetButton that the bar uses to
  // conceal and dim widgets; setting it here would replace that outright.
  // Nested opacities multiply, so on the root both survive - and the easing
  // can match the 600ms the color runs at, instead of inheriting the base
  // class's 140ms and snapping while the color glides.
  // While peeked, WidgetButton's own `dimmed` (below) supplies the fixed
  // ~0.45 "peeked" opacity by itself - forcing root opacity to 1 here stops
  // it multiplying against that value, which would otherwise wash the icon
  // out to ~0.16 (opacities nest, as the comment on iconColor above notes).
  opacity: peeked ? 1 : root.iconOpacity

  Behavior on opacity {
    NumberAnimation { duration: 600; easing.type: Easing.OutCubic }
  }

  property double nowMs: Date.now()

  Timer {
    // Only ticks while the popup is actually visible - this is a local
    // display refresh, not polling sunsetr; the socket is still the only
    // source of new state.
    interval: 15000
    running: root.popupOpen
    repeat: true
    triggeredOnStart: true
    onTriggered: root.nowMs = Date.now()
  }

  readonly property double nextPeriodAtMs: {
    if (!serviceReady || !service.nextPeriod) return NaN
    var d = new Date(service.nextPeriod)
    return isNaN(d.getTime()) ? NaN : d.getTime()
  }
  readonly property string periodText: serviceReady ? ColorModel.periodLabel(service.period) : ""
  readonly property string nextPeriodText: serviceReady ? ColorModel.periodLabel(ColorModel.nextPeriodName(service.period)) : ""
  readonly property string countdownText: isNaN(nextPeriodAtMs) ? "" : ColorModel.formatCountdown(nextPeriodAtMs - nowMs)
  // "begins in" rather than the bare "in" this used to read as ("Day ->
  // Sunset in 11h") - confirmed via `sunsetr --debug --simulate`: sunsetr's
  // "Sunset"/"Sunrise" are named ~70-minute transition periods bounded by
  // solar elevation thresholds (+10 deg to -2 deg for Sunset), not the
  // instant of the astronomical event. The countdown here is to that period
  // *starting*, which lands roughly an hour before the sun is actually at
  // the horizon for a sunset (the gap is much smaller, only ~12 minutes,
  // heading into a sunrise - the thresholds aren't symmetric around 0 deg).
  readonly property string periodLine: (periodText && nextPeriodText && countdownText)
    ? (periodText + " → " + nextPeriodText + " begins in " + countdownText)
    : ""

  readonly property string locationLine: {
    var loc = service ? ColorModel.formatLocation(service.latitude, service.longitude) : ""
    return loc ? "Location: " + loc + " (change with sunsetr geo)" : ""
  }

  readonly property string statusLine: {
    if (service && service.sunsetrMissing) return "not installed"
    if (!serviceReady) return ""
    var temp = service.currentTemp
    var gamma = service.currentGamma
    return (temp !== null && temp !== undefined ? temp + "K" : "—") + " · " +
      (gamma !== null && gamma !== undefined ? Math.round(gamma) + "% brightness" : "—")
  }

  readonly property string connectionLine: {
    if (service && service.sunsetrMissing) return "Install sunsetr, then run bin/setup again - see the plugin README"
    if (serviceReady && service.lastError) return service.lastError
    if (stale) return "Reconnected once sunsetr is back — showing last-known values"
    return ""
  }

  readonly property string presetValue: {
    if (!serviceReady) return ""
    if (service.activePreset === "default") return "auto"
    if (service.activePreset === dayPresetName) return "day"
    if (service.activePreset === nightPresetName) return "night"
    return ""
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    pressable: true
    dimmed: root.peeked
    text: "󰔎"
    slotSize: Style.bar.statusSlot
    fontSize: Style.font.caption
    // Peeked shows a fixed, non-gradient color - there's nothing meaningful
    // to convey about a live temperature at neutral daytime.
    foreground: root.peeked ? (root.bar ? root.bar.barForeground : root.iconColor) : root.iconColor
    useActiveColor: false
    tooltipText: root.tooltip

    onPressed: function(buttonCode) {
      if (!root.service) return
      // Any click just explains why, rather than left/middle-click each
      // silently doing nothing (toggle()/refresh() are now no-ops here -
      // see Service.qml) while only right-click's popup carried the reason.
      if (root.service.sunsetrMissing) { root.popupOpen = true; return }
      if (buttonCode === Qt.RightButton) root.popupOpen = !root.popupOpen
      else if (buttonCode === Qt.MiddleButton) root.service.refresh()
      else root.service.toggle()
    }

    Behavior on foreground {
      ColorAnimation { duration: 600; easing.type: Easing.OutCubic }
    }
  }

  PopupCard {
    id: popup
    anchorItem: root
    bar: root.bar
    owner: root
    open: root.popupOpen
    contentWidth: popup.fittedContentWidth(Style.space(260))
    contentHeight: popup.fittedContentHeight(column.implicitHeight)

    Column {
      id: column
      anchors.fill: parent
      spacing: Style.space(8)

      Row {
        spacing: Style.space(6)
        Text {
          text: "󰔎"
          color: root.bar.foreground
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.subtitle
        }
        Text {
          text: "Night Light"
          color: root.bar.foreground
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.subtitle
          font.bold: true
        }
      }

      Row {
        spacing: Style.space(6)
        Rectangle {
          width: Style.space(8)
          height: Style.space(8)
          radius: width / 2
          anchors.verticalCenter: parent.verticalCenter
          color: root.iconColor
        }
        Text {
          text: root.statusLine
          color: root.bar.foreground
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
      }

      Text {
        visible: root.periodLine !== ""
        width: parent.width
        text: root.periodLine
        color: Qt.darker(root.bar.foreground, 1.3)
        font.family: root.bar.fontFamily
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideRight
      }

      Text {
        visible: root.locationLine !== ""
        width: parent.width
        text: root.locationLine
        color: Qt.darker(root.bar.foreground, 1.3)
        font.family: root.bar.fontFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
      }

      Text {
        visible: root.connectionLine !== ""
        width: parent.width
        text: root.connectionLine
        color: root.bar.urgent
        font.family: root.bar.fontFamily
        font.pixelSize: Style.font.caption
        wrapMode: Text.WordWrap
      }

      PanelSeparator {
        foreground: root.bar.foreground
      }

      ButtonGroup {
        anchors.horizontalCenter: parent.horizontalCenter
        options: [
          { value: "auto", label: "Auto" },
          { value: "day", label: "Day" },
          { value: "night", label: "Night" }
        ]
        value: root.presetValue
        foreground: root.bar.foreground
        onChanged: function(v) {
          if (!root.service) return
          if (v === "auto") root.service.applyPreset("default")
          else if (v === "day") root.service.applyPreset(root.dayPresetName)
          else root.service.applyPreset(root.nightPresetName)
        }
      }
    }
  }
}

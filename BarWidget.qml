import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "PulseLogic.js" as Pulse

BarWidget {
  id: root
  moduleName: "smf.neural-pulse"

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  readonly property bool pulseBusy: panelLoader.item ? panelLoader.item.busy === true : false
  readonly property real pulseActivity: panelLoader.item ? Number(panelLoader.item.activity || 0) : 0
  readonly property string pulseTooltip: panelLoader.item && panelLoader.item.statusLine
    ? panelLoader.item.statusLine
    : "Neural Pulse"
  readonly property string pulseBarLabel: panelLoader.item ? String(panelLoader.item.barLabel || "") : "DEMO"
  readonly property bool pulseMuted: pulseBarLabel !== ""

  readonly property color pulseCyan: Color.accent
  readonly property color pulseMagenta: (bar && bar.urgent) ? bar.urgent : Color.urgent
  readonly property color pulseForeground: bar ? bar.foreground : Color.foreground
  readonly property color wavePrimary: pulseMuted ? pulseForeground : pulseCyan
  readonly property color waveSecondary: pulseMuted ? pulseForeground : pulseMagenta

  property var samples: Pulse.emptyBuffer()

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function toggle() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  function togglePanel() {
    root.toggle()
  }

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  function cssColor(c, a) {
    return "rgba("
      + Math.round(c.r * 255) + ","
      + Math.round(c.g * 255) + ","
      + Math.round(c.b * 255) + ","
      + a + ")"
  }

  function paintWave(canvas) {
    var ctx = canvas.getContext("2d")
    if (!ctx) return
    var w = canvas.width
    var h = canvas.height
    ctx.reset()
    ctx.clearRect(0, 0, w, h)
    if (w < 2 || h < 2) return

    var vertical = button.vertical === true
    var values = root.samples && root.samples.length ? root.samples : Pulse.emptyBuffer()
    var last = values.length - 1
    if (last < 1) return
    var glow = root.pulseMuted ? 0.08 : 0.16
    var mid = root.pulseMuted ? 0.12 : 0.22
    var edge = root.pulseMuted ? 0.35 : 0.7
    var core = root.pulseMuted ? 0.45 : 0.95

    function strokeWave(offset, color, width, alpha, phase) {
      ctx.beginPath()
      ctx.lineWidth = width
      ctx.strokeStyle = root.cssColor(color, alpha)
      ctx.lineJoin = "round"
      ctx.lineCap = "round"
      for (var i = 0; i <= last; i++) {
        var t = i / last
        var amp = Pulse.clamp(Number(values[i] || 0) + Math.sin((t + phase) * Math.PI * 2) * offset, 0, 1)
        var x, y
        if (vertical) {
          x = w * (0.5 + (amp - 0.5) * 0.86)
          y = h * t
        } else {
          x = w * t
          y = h * (0.5 + (0.5 - amp) * 0.86)
        }
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    strokeWave(0.08, root.waveSecondary, 7.5, glow, 0.18)
    strokeWave(0.0, root.wavePrimary, 5.5, mid, 0.0)
    strokeWave(0.06, root.waveSecondary, 2.4, edge, 0.18)
    strokeWave(0.0, root.wavePrimary, 1.35, core, 0.0)
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    enabled: true
    target: "smf.neural-pulse"
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): void {
      if (panelLoader.item && panelLoader.item.refresh) panelLoader.item.refresh()
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "NP"
    labelVisible: false
    keepSpace: true
    active: root.opened
    tooltipText: root.pulseTooltip
    fixedWidth: vertical ? barSize : Style.space(78)
    fixedHeight: vertical ? Style.space(78) : barSize
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.LeftButton) root.toggle()
      else if (buttonCode === Qt.MiddleButton && panelLoader.item && panelLoader.item.refresh)
        panelLoader.item.refresh()
    }

    Canvas {
      id: wave
      z: 1
      anchors.fill: parent
      anchors.leftMargin: Style.spaceReal(6)
      anchors.rightMargin: Style.spaceReal(6)
      anchors.topMargin: Style.spaceReal(4)
      anchors.bottomMargin: Style.spaceReal(4)
      renderStrategy: Canvas.Cooperative
      onPaint: root.paintWave(wave)
    }

    Text {
      z: 2
      anchors.centerIn: parent
      visible: root.pulseBarLabel !== ""
      text: root.pulseBarLabel
      color: root.pulseForeground
      font.family: bar ? bar.fontFamily : Style.font.family
      font.pixelSize: Style.font.caption
      font.bold: true
      font.letterSpacing: 1.2
    }
  }

  Timer {
    interval: Pulse.FRAME_MS
    running: true
    repeat: true
    onTriggered: {
      var t = Date.now() / 1000
      root.samples = Pulse.pushSample(root.samples, Pulse.sampleAt(t, root.pulseBusy, root.pulseActivity))
      wave.requestPaint()
    }
  }
}

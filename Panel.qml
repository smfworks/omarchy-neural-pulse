import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "PulseLogic.js" as Pulse

Panel {
  id: root
  moduleName: "smf.neural-pulse"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var snapshot: Pulse.demoSnapshot()
  property var sessions: []

  readonly property string probeScript: {
    var u = Qt.resolvedUrl("probe.py").toString()
    if (u.indexOf("file://") === 0)
      return decodeURIComponent(u.substring(7))
    return u
  }
  readonly property bool busy: snapshot && snapshot.busy === true && snapshot.stale !== true
  readonly property bool hermesPresent: snapshot && snapshot.present === true
  readonly property bool demo: Pulse.barMode(snapshot) === "demo"
  readonly property string barLabel: Pulse.barLabel(snapshot)
  readonly property real activity: Pulse.activityFrom(snapshot)
  readonly property string statusLine: Pulse.statusLine(snapshot)
  readonly property string costLine: Pulse.knownCostUsd(snapshot)
  readonly property string totalsLine: Pulse.headerTotalsLine(snapshot)
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property color pulseCyan: Color.accent
  readonly property color pulseMagenta: (bar && bar.urgent) ? bar.urgent : Color.urgent
  readonly property color glass: Color.popups && Color.popups.background ? Color.popups.background : Color.background
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  function open() {
    setCenterHoverRevealSuppressed(false)
    root.controller.show()
    root.refresh()
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.hostWidget || root, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && "centerHoverRevealSuppressed" in root.bar)
      root.bar.centerHoverRevealSuppressed = value
  }

  function refresh() {
    if (probe.running)
      return
    probe.running = true
  }

  function applyProbe(text) {
    var next = Pulse.mergeProbe(root.snapshot, text)
    root.snapshot = next
    root.sessions = next && next.present === true ? (next.sessions || []) : []
  }

  function glassFill(alpha) {
    return Qt.rgba(glass.r, glass.g, glass.b, alpha)
  }

  function accentFill(color, alpha) {
    return Qt.rgba(color.r, color.g, color.b, alpha)
  }

  Process {
    id: probe
    command: ["python3", root.probeScript]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.applyProbe(text)
    }
    onExited: function(code) {
      if (code !== 0)
        root.applyProbe("")
    }
  }

  Timer {
    interval: Pulse.POLL_MS
    running: true
    repeat: true
    onTriggered: root.refresh()
  }

  Component.onCompleted: root.refresh()

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(420))
    contentHeight: panel.fittedContentHeight(body.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "r" || t === "R") root.refresh()
      }

      Column {
        id: body
        width: parent.width
        spacing: Style.space(12)
        leftPadding: Style.space(16)
        rightPadding: Style.space(16)
        topPadding: Style.space(14)
        bottomPadding: Style.space(14)

        Rectangle {
          id: headerCard
          width: parent.width - Style.space(32)
          implicitHeight: headerColumn.implicitHeight + Style.space(18)
          radius: Style.cornerRadius
          color: root.accentFill(root.pulseCyan, 0.08)
          border.width: 1
          border.color: root.accentFill(root.pulseMagenta, 0.45)

          Column {
            id: headerColumn
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: Style.space(12)
            anchors.rightMargin: Style.space(12)
            spacing: Style.space(4)

            Text {
              text: "NEURAL PULSE"
              color: root.pulseCyan
              font.family: root.fontFamily
              font.pixelSize: Style.font.heading
              font.bold: true
              font.letterSpacing: 2.4
            }

            Text {
              width: parent.width
              wrapMode: Text.WordWrap
              text: root.statusLine
              color: root.busy ? root.pulseMagenta : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }

            Text {
              width: parent.width
              wrapMode: Text.WordWrap
              visible: root.hermesPresent && root.totalsLine !== ""
              text: root.totalsLine
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }
        }

        Text {
          width: parent.width - Style.space(32)
          visible: root.demo
          wrapMode: Text.WordWrap
          text: "Idle demo. The bar shows DEMO until Neural Pulse can open ~/.hermes/state.db (and named profiles). USD is shown only when Hermes stored a cost."
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        Repeater {
          model: root.sessions

          delegate: Rectangle {
            required property var modelData
            width: body.width - Style.space(32)
            implicitHeight: rowColumn.implicitHeight + Style.space(14)
            radius: Style.cornerRadius
            color: root.glassFill(0.42)
            border.width: 1
            border.color: root.accentFill(modelData && modelData.active ? root.pulseMagenta : root.pulseCyan, 0.35)

            Rectangle {
              width: Style.space(3)
              radius: width / 2
              anchors.left: parent.left
              anchors.top: parent.top
              anchors.bottom: parent.bottom
              anchors.margins: Style.space(6)
              color: modelData && modelData.active ? root.pulseMagenta : root.pulseCyan
            }

            Column {
              id: rowColumn
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.leftMargin: Style.space(16)
              anchors.rightMargin: Style.space(12)
              spacing: Style.space(2)

              Row {
                width: parent.width
                spacing: Style.space(8)

                Text {
                  width: parent.width - metaLabel.implicitWidth - Style.space(8)
                  elide: Text.ElideRight
                  text: Pulse.sessionHeading(modelData, root.snapshot && root.snapshot.profileCount)
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.subtitle
                  font.bold: true
                }

                Text {
                  id: metaLabel
                  text: {
                    var bits = [Pulse.formatTokens(Pulse.sessionTokens(modelData)) + " tok"]
                    var cost = Pulse.formatCost(modelData)
                    if (cost !== "") bits.push(cost)
                    return bits.join("  ")
                  }
                  color: root.pulseCyan
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }
              }

              Text {
                width: parent.width
                wrapMode: Text.WordWrap
                text: {
                  var bits = [Pulse.sessionStatus(modelData)]
                  if (modelData && modelData.model) bits.push(String(modelData.model))
                  if (modelData && modelData.source) bits.push(String(modelData.source))
                  if (root.snapshot && root.snapshot.profileCount > 1 && modelData && modelData.profile)
                    bits.push(String(modelData.profile))
                  var when = modelData && modelData.lastActivityAt ? modelData.lastActivityAt : (modelData && modelData.startedAt)
                  var ago = Pulse.relativeTime(when)
                  if (modelData && modelData.active) bits.push("running")
                  else if (ago !== "") bits.push(ago)
                  return bits.join(" · ")
                }
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }
            }
          }
        }

        Text {
          visible: root.hermesPresent && root.sessions.length === 0
          text: "No Hermes sessions logged yet."
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }

        Text {
          text: "Click the waveform to close · R refresh · Esc close"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }
}

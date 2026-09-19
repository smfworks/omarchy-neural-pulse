# Neural Pulse

Futuristic Omarchy Quattro `bar-widget` from SMF Works. The bar shows a glowing
neural waveform of Hermes agent activity. Click it for a holographic session
strip: recent Hermes sessions, tokens, status, and cost **only when Hermes
stored one**.

Plugin id: `smf.neural-pulse`. Adversarial review of whether the pulse/strip is screenshot-trustworthy: [docs/OPPOSITION.md](docs/OPPOSITION.md).

## Install

```sh
omarchy plugin add https://github.com/smfworks/omarchy-neural-pulse.git --enable
omarchy bar move smf.neural-pulse --section right
```

## Usage

- Left click the waveform to open or close the session strip
- Middle click or press `R` to refresh
- Escape closes the panel

Idle machines without `~/.hermes` stay on a gentle demo breath. The widget
never invents USD from token counts.

## Data

When present, Neural Pulse reads the Hermes home used by
[Hermes Agent](https://hermes-agent.nousresearch.com/docs/developer-guide/session-storage)
and [smf.hermes](https://github.com/smfworks/smf-hermes):

- `$HERMES_HOME/state.db` or `~/.hermes/state.db`
- named-profile databases under `~/.hermes/profiles/*/state.db`

SQLite is opened read-only. A 4s poll plus `pgrep -x hermes` keeps the
waveform between idle breath and busy amplitude. Cost fields are copied from
`actual_cost_usd` / `estimated_cost_usd` when those values are positive.

## Contract

- `schemaVersion: 1`, id `smf.neural-pulse` (not `omarchy.*`)
- `kinds: ["bar-widget"]`, `entryPoints.barWidget: "BarWidget.qml"`
- Nested details panel loaded from `BarWidget.qml` via `Loader`
- `moduleName` matches the plugin id; `injectPanel`, `open`, `close`,
  `toggle`, and `closeForPopoutSwitch` are forwarded to the panel
- Imports `qs.Ui` / `qs.Commons`; no symlinks

```sh
omarchy plugin validate .
```

## Remove

```sh
omarchy plugin remove smf.neural-pulse
```

## License

MIT. Copyright (c) 2026 SMF Works.

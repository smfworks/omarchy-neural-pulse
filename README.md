# Neural Pulse

Futuristic Omarchy Quattro `bar-widget` from SMF Works. The bar shows a glowing
neural waveform of Hermes agent activity. Click it for a holographic session
strip: recent Hermes sessions, tokens, status, and cost **only when Hermes
stored one**.

Plugin id: `smf.neural-pulse`. Adversarial review of whether the pulse/strip is screenshot-trustworthy: [docs/OPPOSITION.md](docs/OPPOSITION.md).

## Requirements

- **python3** — the widget probes Hermes `state.db` with `probe.py` every 4s.
  Without it the bar shows **ERR**, not a live install.
- Omarchy Quattro / Quickshell (this is a `bar-widget` plugin)

## Install

```sh
omarchy plugin add https://github.com/smfworks/omarchy-neural-pulse.git --enable
omarchy bar move smf.neural-pulse --section right
```

`defaultSection` is already `right`; `bar move` is optional configure.

## Usage

- Left click the waveform to open or close the session strip
- Middle click or press `R` to refresh
- Escape closes the panel

The bar labels its mode so a screenshot is self-describing:

- **DEMO** — no readable Hermes home (`~/.hermes/state.db` not opened). The
  waveform is a muted idle breath, not live activity.
- **ERR** — probe failed or `state.db` exists but could not be opened
- **STALE** — showing the last good snapshot after a failed refresh
- unmarked — last probe succeeded against an opened `state.db`

An empty `~/.hermes` directory is demo, not “Idle · no sessions yet.” The
widget never invents USD from token counts.

## Data

When present, Neural Pulse reads the Hermes home used by
[Hermes Agent](https://hermes-agent.nousresearch.com/docs/developer-guide/session-storage)
and [smf.hermes](https://github.com/smfworks/smf-hermes). `HERMES_HOME` is taken
from the **Omarchy shell** process, not from an interactive terminal:

- `$HERMES_HOME/state.db` or `~/.hermes/state.db`
- named-profile databases under `$HERMES_HOME/profiles/*/state.db` and
  `~/.hermes/profiles/*/state.db`

SQLite is opened read-only. **Busy** is a ~30s recency window on real session
activity (`last_activity_at`, latest message time, or `started_at`). Ghost open
stubs (`ended_at IS NULL` with no messages and no tokens) are ignored. File
mtime and `pgrep` are not used.

Header tokens / USD / session counts come from the **same** population: non-archived,
non-ghost sessions with activity in the **last 24h**, labeled as such. Actual and
estimated USD are both shown when Hermes stored both.

**Named profiles are aggregated.** If more than one home is readable, rows are
badged with the profile/home name (`[work] …`) and the header notes how many
profiles contributed. This is not Hermes isolation; treat the strip as a union
view.

## Tests

```sh
python3 -m pytest tests
node tests/test_pulse_logic.js
```

`pytest` is a test-only dependency (`pip install pytest`).

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

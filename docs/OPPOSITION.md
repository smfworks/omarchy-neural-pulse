# Opposition: do not trust Neural Pulse

Adversarial review of `smf.neural-pulse` (Omarchy Quattro `bar-widget`).
Scope: `BarWidget.qml`, `Panel.qml`, `PulseLogic.js`, `manifest.json`, `README.md`.
**No product tests exist** — no `tests/`, no `qmltestrunner` targets, no extracted probe module. `PulseLogic.js` is a `.pragma library` of pure helpers plus a stringly-typed Python blob (`probeSource()`); none of it is executed in CI.

Method: assume a user screenshots the bar waveform and the session strip and believes them. Argue against that trust. Example inputs are concrete.

---

## 1. Executive opposition

Neural Pulse sells a glowing cyan/magenta waveform as “Hermes activity” and a holographic strip as tokens, status, and cost. The bar never labels demo vs live vs error, so a screenshot of the idle breath is indistinguishable from a working install. “Busy” is a triple-OR of `pgrep -x hermes` (wrong process name for Desktop/gateway), `state.db` / WAL mtime within 180s, and any `ended_at IS NULL` row — including the ghost open stubs Hermes itself documents. The strip then captions lifetime `COUNT(*)` next to token and USD totals taken from the last 24 rows per database, prefers a tiny `actual_cost_usd` sum over a large estimated remainder, and merges every named profile under `~/.hermes/profiles/*` even when `HERMES_HOME` already selected one. Unreadable or empty homes collapse to “Hermes not found” or “no sessions yet” with no error. Until the pulse and the strip share one honest activity definition, this widget is a mood light, not an instrument.

---

## 2. P0 trust breakers

### P0-1 — Waveform looks busy when Hermes is idle (and quiet when it is not)

`Panel.qml` defines busy as:

```qml
readonly property bool busy: processRunning || (snapshot && snapshot.busy === true)
```

`BarWidget.qml` paints from that flag every `FRAME_MS` (46ms) via `Pulse.sampleAt(t, root.pulseBusy, root.pulseActivity)`. Three independent false-busy paths all drive the high-amplitude neural stroke (`PulseLogic.js` `sampleAt`, the `busy` branch: `sin(t*7.4)`, `sin(t*13.05)`, spark at `sin(t*31)>0.94`).

**A. `pgrep -x hermes` (`Panel.qml` `desktopProbe`)**

- Exact comm match. Hermes Desktop’s Linux binary is `Hermes` (capital H); the backend is `python -m hermes_cli.main serve`. Gateway is `python -m hermes_cli.main gateway`. Sibling plugin `smf.hermes` already probes `pgrep -f "hermes desktop"` instead.
- **Quiet when busy:** Desktop open, agent mid-turn, `pgrep -x hermes` exits 1. If the DB is between writes, `snapshot.busy` can also be false → idle breath on a live machine.
- **Busy when idle:** any leftover `~/.local/bin/hermes` CLI, installer, or unrelated binary named `hermes` (email clients, tooling) keeps `processRunning === true` forever. The waveform stays in the busy branch even with zero sessions.

**B. File mtime window (`probeSource()` `recently_active`, `BUSY_WINDOW = 180`)**

Any `state.db` or `state.db-wal` mtime within 180 seconds sets `busy = True` before a single session row is read. WAL mode is how Hermes writes; a finished CLI turn, a compaction, a gateway heartbeat, or a checkpoint lights the pulse for **three minutes after work stopped**. Short `hermes ask` jobs invert the signal: missed by the 4s poll while running, then “busy” after they exit because mtime just changed.

**C. `ended_at IS NULL` means live (`scan()`, then `sessionStatus()`)**

```python
active = ended is None
if active:
    busy = True
    totals['active'] += 1
```

```javascript
if (session.active === true || session.endedAt == null || session.endedAt === "")
  return "active"
```

Hermes issue [NousResearch/hermes-agent#12029](https://github.com/NousResearch/hermes-agent/issues/12029) documents leaked open rows at scale (example report: 1786 untitled sessions with `ended_at IS NULL`, including `message_count = 0` ghost stubs). One stale row → magenta “active” chip, `Busy · Hermes activity` (`statusLine`), and a frantic waveform until someone ends the row.

`sessionStatus` also treats empty `endedAt` as active even if Python set `active: false`. `PulseLogic.js` `BUSY_WINDOW_SEC = 180` is unused; only the Python copy applies.

### P0-2 — Session strip lies about tokens, cost, and status

Header in `Panel.qml` (visible when `hermesPresent`):

```qml
bits.push(Pulse.formatTokens(totals.tokens) + " tokens")
if (cost !== "") bits.push("logged " + cost)
bits.push((totals.sessionCount || 0) + " sessions")
```

Those three numbers are not the same population.

| Field | Actual source in `scan()` / merge loop | What the screenshot implies |
| --- | --- | --- |
| `totals.sessionCount` | `SELECT COUNT(*) FROM sessions` **per DB**, then summed | Lifetime sessions |
| `totals.tokens` | Token columns on **`ORDER BY started_at DESC LIMIT 24`** rows only, then only those 24 are summed (display list is further cut to 8) | Lifetime tokens |
| `actualCostUsd` / `estimatedCostUsd` | Same last-24 window, summed separately | Lifetime spend |

**Example.** Default home has 312 sessions. Last 24 hold 45,200 cache-read tokens and $0.01 actual on one row, plus ~$5.00 estimated on each of the other 23. Header renders **`45.2k tokens · logged $0.01 · 312 sessions`**. The user believes $0.01 across 312 sessions. `knownCostUsd()` prefers any positive actual total and **drops the estimated remainder entirely**. Cache/read/write/reasoning tokens are added into the same “tokens” number (`token_sum` / `sessionTokens`).

Status lies on the same strip:

- `source` is Hermes platform (`cli`, `telegram`, `cron`, `subagent`, `desktop`), **not** the profile name. A cron night run and a kids-profile chat look like peer “sessions”.
- `relativeTime(modelData.startedAt)` — a two-hour live turn shows `2h ago`, not “running”.
- `archived` is never selected. Hermes hides `archived=1` from listings; Neural Pulse will still surface an archived title if it falls in the last 24.
- `cost_status` / `cost_source` are SELECTed in SQL and then discarded. Hermes often has `estimated_cost_usd` only (`actual_cost_usd` unused until reconciliation). The strip still says “logged $X” as if billed.

### P0-3 — Silent empty vs unread homes / `state.db` failures

`state_paths()` then:

```python
present = home.is_dir() or len(paths) > 0
```

| Input | What happens | What the user sees |
| --- | --- | --- |
| No `~/.hermes` | `demoSnapshot()` / `present: false` | Idle breath + tooltip `Demo idle · ~/.hermes not found`. **No DEMO mark on the bar.** |
| `mkdir ~/.hermes` (empty) | `present=true`, `paths=[]` | Panel hides the demo caption (`demo: !hermesPresent`). Status: `Idle · no sessions yet`. Looks installed and healthy. |
| `state.db` exists, `chmod 000`, lock, or missing `id`/`started_at` | `connect` / column check fails; `scan` returns empty lists; `busy` may still be true from mtime | `Idle · no sessions yet` or a busy waveform over an empty list. No `ERR`. |
| `python3` missing or probe `ValueError` (e.g. `ended_at = ''` → `float('')`) | `Process.onExited`: if `snapshot.present !== true`, `applyProbe("")` → demo; **if a prior probe succeeded, stale snapshot is kept** | First failure: “Hermes not found” on a machine that has Hermes. Later failure: yesterday’s tokens/cost presented as current. |
| JSON parse fail (`parseSnapshot`) | any stdout noise → `demoSnapshot()` | Same as missing home. |

`last_read_at` exists on Hermes `sessions` and is never read. Unread gateway/desktop sessions are not distinguished from read ones. There is no unread-home or unread-session signal — only “present” vs “demo”.

### P0-4 — Multi-profile mix violates Hermes isolation (and leaks titles)

Hermes docs (`get_hermes_home()`): a named profile is `$HERMES_HOME/state.db` (e.g. `~/.hermes/profiles/coder/state.db`). **Falling back to the default root mixes the wrong profile.** Neural Pulse does worse. `state_paths()` always adds:

1. `$HERMES_HOME/state.db`
2. `~/.hermes/state.db`
3. **every** `~/.hermes/profiles/*/state.db`

Dedup is by `path.resolve()` only. Example: `HERMES_HOME=~/.hermes/profiles/work` still loads default `~/.hermes/state.db` plus `personal`, `work`, and any WisdomForge kids profiles under `profiles/*`. Session titles from those DBs are merged, sorted by `startedAt`, and shown as one strip with no `profile_name` (column exists in Hermes schema; probe never selects it). Token/cost totals are summed across all of them.

`$HERMES_HOME/profiles/*` is **not** scanned. A custom root `HERMES_HOME=/opt/hermes` with profiles only there is a blind spot; leftover `~/.hermes/profiles` still leak into the strip.

`snapshot.home` is emitted as the unresolved `HERMES_HOME` / `~/.hermes` string (not shown in QML today, but it is in the in-memory snapshot).

---

## 3. P1 gaps / correctness

### Polling: too hot on the bar, too cold on the truth

- `POLL_MS = 4000` plus `python3 -c` of the entire probe, every four seconds, **while the panel is closed**. Plus `pgrep` on the same timer (`Panel.qml` `Timer` `repeat: true`, `Component.onCompleted: refresh()`).
- `FRAME_MS = 46` Canvas `requestPaint` forever (`BarWidget.qml` `Timer` always `running: true`). ~22 fps neon whether idle or not.
- Official clock widget ticks on `SystemClock`. This widget is a permanent process factory.
- 4s sampling misses sub-4s CLI turns (quiet while busy); mtime then overcorrects (busy while idle). No `inotify` / WAL watch.
- `refresh()` kills a running probe (`probe.running = false`) if the previous `python3` is still inside a 1.5s lock wait × N databases. Torn JSON → `parseSnapshot` → demo.

### QML / Omarchy contract (mostly copied; a few sharp edges)

Holds vs [plugins.omarchy.org/develop.html](https://plugins.omarchy.org/develop.html) and first-party `omarchy.clock`:

- `manifest.json`: `schemaVersion: 1`, id `smf.neural-pulse` (not `omarchy.*`), `kinds: ["bar-widget"]`, `entryPoints.barWidget: "BarWidget.qml"`. Nested panel is not a second kind.
- `moduleName` matches in `BarWidget.qml` and `Panel.qml`.
- `opened`, `popoutSwitchClosing`, `open` / `close` / `toggle` / `closeForPopoutSwitch`, `injectPanel` (guarded `"bar" in target` style, same as clock), `Loader` + `Qt.callLater(injectPanel)`.
- `manageIpc: false`. `WidgetButton` is the documented control (not `BarIconButton`).

Gaps:

- Official troubleshooting: *“A Panel Opens Once but Not Again”* if `opened`/`open`/`close` are not forwarded. They are forwarded — **but** `closeForPopoutSwitch` is not defined on `Panel.qml`. It only works if `qs.Ui.Panel` implements it (clock relies on the same inheritance). If a shell build ever stops putting that method on the base type, `Bar.requestPopout` calls into a missing function and the next widget’s panel will not replace this one.
- No `ipcTarget` on `Panel` (sibling `smf.hermes` sets it). `IpcHandler` lives on `BarWidget` with `target: "smf.neural-pulse"`. One handler per monitor instance; first claimant wins. `omarchy-shell shell summon smf.neural-pulse` should still hit `Bar.findPanelWidget` → `open()`, which is implemented.
- `toggle()` on the panel does not use an `openFromHotkey` path; `setCenterHoverRevealSuppressed` is only ever set `false`. Hotkey/IPC open can fight center hover-reveal (smf.hermes sets `true` on hotkey open).
- README tells people to run `omarchy plugin validate .` but not `qmllint -I "$OMARCHY_PATH/shell" BarWidget.qml Panel.qml`. No `preview.png`.
- `Canvas` is a child of `WidgetButton` with `z: -1`. If the button fills an opaque theme background, the waveform paints *behind* the chrome and the bar shows an empty `NP` slot (`labelVisible: false`). That is “quiet when busy” with no data bug at all.

### Theme / hardcoded neon

`BarWidget.qml` and `Panel.qml` both hardcode:

```qml
Qt.tint(..., "#7300E8FF")  // cyan
Qt.tint(..., "#73FF40B4")  // magenta
```

Official panel text uses `root.barForeground`. Neural Pulse uses tinted neon for header, borders, meta, and the wave. On a light theme (`bar.foreground` dark, `Color.popups.background` light) the 0.08 cyan fill + 0.45 magenta border is a cyberpunk sticker, not a theme. `Qt.darker(foreground, 1.55)` for `dim` is fine on dark text; the tints are not. Duplicated hex in two files will drift.

### Process name collisions (beyond P0-1)

| Process | `pgrep -x hermes` | Reality |
| --- | --- | --- |
| `~/.local/bin/hermes` CLI idle REPL | match | not “agent activity” |
| `Hermes` Electron desktop | no match | the thing users mean |
| `python3 -m hermes_cli.main serve` | no match | Desktop backend |
| `hermes-agent` (`[project.scripts]`) | no match | alternate entry |
| Unrelated `/usr/bin/hermes` | match | false busy |

### Security

Plugins are **unsandboxed in the Omarchy shell** (official develop guide). This one:

- Follows symlinks: `path.is_file()` + `resolve()` on `HERMES_HOME/state.db` and every profile dir. A profile folder that is a symlink to another user’s home, or `state.db` → some other SQLite file, is read and titled into the panel.
- Does not constrain `HERMES_HOME` to `$HOME`. The desktop session’s env is whoever started Quickshell.
- Spawns `python3 -c <full probe>` — the script (and thus home-resolution logic) is visible in `ps`.
- Opens SQLite `mode=ro` + `PRAGMA query_only = ON` (good) with `timeout=1.5`.
- `PRAGMA table_info("%s" % table)` is safe today because `table` is the literal `'sessions'`.
- Session titles, models, and `source` from every profile are screenshot-ready. That is the feature; mixing kids/work profiles makes it a leak.
- `snapshot.home` carries the resolved home path in process memory.

No path-traversal in the SQL itself. The danger is **which files** are considered in-scope, not string concat into `FROM`.

### README install gaps

Install block:

```sh
omarchy plugin add https://github.com/smfworks/omarchy-neural-pulse.git --enable
omarchy bar move smf.neural-pulse --section right
```

Missing, vs official plugin README + develop guide:

- **python3** is a hard runtime dependency (`Process.command: ["python3", "-c", Pulse.probeSource()]`). Not listed. Without it the widget lies (P0-3).
- **pgrep** assumed present.
- No Omarchy Quattro / Quickshell version pin.
- No `omarchy plugin add … --yes`; no `omarchy-shell shell rescanPlugins` if validate-but-not-listed.
- `bar move` is presented as required install, not optional configure (`defaultSection` is already `"right"`).
- Pins **git HEAD**, not a tag/`v0.1.0`.
- Does not say the bar pulse is a **demo animation** when Hermes is absent — only that machines “stay on a gentle demo breath.”
- Does not warn that all named profiles are aggregated.
- Does not document `HERMES_HOME` inheritance from the **shell** process (not the user’s interactive terminal).
- No `qmllint` / summon / hide verification commands from the official contract page.
- “never invents USD from token counts” is true and too narrow — the strip still invents a **lifetime** story from a 24-row window.

---

## 4. P2 improvements

- Extract `probeSource()` into `probe.py` (or a small hermes-state helper). The 190-line JS string is unreviewable and untestable.
- Use Hermes’ own recency expression (`last_activity_at` ∪ `MAX(messages.timestamp)` ∪ `started_at` in `hermes_state_common._sql_session_last_active`) instead of file mtime.
- Filter `archived = 0`, skip ghost stubs (`message_count = 0` and no tokens), and optionally hide `source IN ('subagent','cron')` or label them.
- Select `profile_name` and show it; or honor **only** `HERMES_HOME` (plus an explicit “all profiles” toggle).
- `session_model_usage` is the attribution table; per-session token columns are aggregates that compression/splits duplicate via `parent_session_id`.
- `formatTokens(14900)` → `14.9k`; `formatTokens(9999)` → `10k`. Fine for a badge; not for a “receipt.”
- `formatUsd(0.00001)` → `$0.0000` because `amount > 0` still passes and `toFixed(4)` underflows.
- `activityFrom()` returns 0.16–0.55 for idle-with-tokens, but `sampleAt` **ignores** `activity` when `!busy`. Dead code; the idle wave cannot encode history.
- `KeyboardPanel` has no `centerOnBar: true` (smf.hermes does). Positioning may differ from the sibling Hermes widget.
- `IpcHandler.refresh` only refreshes this instance’s panel, not `broadcast` (clock pattern).
- Add `preview.png` and a bar-face `DEMO`/`LIVE`/`STALE`/`ERR` glyph so a screenshot is self-describing.
- Stop the frame timer when the bar is hidden / screen locked; stop the probe timer when Hermes is absent (probe once, then back off).

---

## 5. Quick wins (≤ 1 day)

1. **Bar face must name its mode.** Tooltip is not enough. Paint `DEMO` / `ERR` / `STALE` on the `WidgetButton` (or change the wave color to `bar.foreground` at 0.35 alpha in demo). Screenshot-proof.
2. **Delete `desktopProbe` (`pgrep -x hermes`)** or replace with `pgrep -f 'hermes_cli.main|hermes desktop'` and **do not** OR that into waveform busy — at most a “process seen” caption.
3. **Delete `recently_active()` mtime.** Three-minute afterglow is the main idle→busy lie.
4. **Caption the header honestly:** `last 24 · 45.2k tok · ~$115 est` or run `SELECT SUM(...) FROM sessions` / `COUNT(*)` as a matched pair. Never pair `COUNT(*)` with a 24-row sum.
5. **`knownCostUsd`:** if both actual and estimated exist, show both (`$0.01 actual · ~$115 est`), not actual-only.
6. **Probe errors:** on `code !== 0`, set `snapshot.stale = true` / `snapshot.error`, do not `applyProbe("")` on first fail, do not keep a silent yesterday.
7. **`present`:** require a readable `state.db`, not merely `home.is_dir()`. Empty `~/.hermes` is demo, not “no sessions yet.”
8. **README:** list `python3`; say profiles are merged; say the bar animates without Hermes.
9. **Unit-test `parseSnapshot`, `statusLine`, `knownCostUsd`, `sessionStatus`, `sampleAt`** in a tiny Node/QML test — these are already pure JS.
10. **Raise Canvas `z`** above the button fill (or paint into a dedicated item beside the button) so the wave cannot disappear on opaque themes.

---

## 6. Suggested next ship (one concrete fix PR)

**Title:** `Honest pulse: stop false busy, label demo/error, match totals to COUNT(*)`.

**Do not** restyle the hologram. Change the trust contract:

1. Busy iff Hermes recency (`last_activity_at` or latest message time) is within ~30s, **or** a row with `ended_at IS NULL` **and** `message_count > 0` **and** recency within that window. No `pgrep -x`, no WAL mtime.
2. Bar glyph: `DEMO` when `present !== true`; `ERR` when the probe failed; `STALE` when showing a previous snapshot; unmarked only when the last probe succeeded.
3. Header totals from the same SQL population (full `SUM`/`COUNT`, or both labeled “last 24”). Show actual and estimated separately. Filter `archived=0`.
4. `present` requires an opened `state.db`, not a directory.
5. Tests for the JS helpers plus a fixture `state.db` with: empty home, ghost open stub, last-24 vs 100-row totals, mixed actual/estimated, two profiles.

That single PR makes a screenshot of the bar and strip *disprovable*. Visual polish can follow.

---

## 7. What already holds

- **USD is not invented from tokens.** `formatUsd` / `cost_payload` require a stored amount `> 0`. README’s “never invents USD” claim is literally true.
- **SQLite is opened read-only** (`mode=ro` URI + `PRAGMA query_only = ON`), command argv is a list (no shell interpolation), timeout 1.5s.
- **Quattro bar-widget shape is largely correct:** id namespace, kinds, entry point, nested `Loader` panel, `injectPanel`, `opened` / `open` / `close` / `toggle` / `closeForPopoutSwitch` on the bar root, `manageIpc: false`, `qs.Ui` / `qs.Commons`, no `omarchy.*` id, no symlinks. Matches the official clock pattern more closely than it misses.
- **Demo path exists** in the *panel* (`Idle demo. Neural Pulse reads ~/.hermes/state.db…`) when `present !== true`. The failure is that the *bar* does not say so.
- **Resolved-path dedup** prevents reading the same `state.db` twice when `HERMES_HOME` is `~/.hermes`.
- **`sessionCount` tries to be global** via `COUNT(*)` after the `LIMIT 24` select — the bug is pairing it with windowed sums, not the count query itself.
- **Vertical bar drawing exists** (`paintWave` `button.vertical` branch).
- **IPC surface** (`open`/`close`/`show`/`hide`/`toggle`/`refresh`) is wired on the widget.
- **MIT** `LICENSE` and `manifest.json` metadata are in place.

None of that makes the pulse screenshot-safe. It means the next PR can stay small: honest busy, honest totals, visible failure, tests.

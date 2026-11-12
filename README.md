# omp-usage-statusbar

Extension for [OMP](https://github.com/can1357/oh-my-pi) that shows the remaining quota of your subscriptions in the footer.

## What it does

Shows one footer row per subscription (a provider account), with the **remaining** percentage for each quota window and the time left until its reset, like the cards in `/usage`. The data comes from the same reports as `/usage`.

Example row:

```
anthropic/user@example.com (Org) Claude 5 Hour ███████░░░ 69% 2h30m · Claude 7 Day ███████░░░ 73% 3d2h
```

Each window shows a bar of the remaining quota: green above 25%, yellow down to 25%, red down to 10%.

The row text can also take the colors of its level: `textColor` chooses which parts are colored.

The footer updates when the session starts, after every turn, and every 60 s. OMP's cache keeps data for about 5 minutes, so the numbers change more slowly. `/usage` + `r` refreshes the dashboard, not the footer.

The extension is visible only in the interactive TUI (not with `-p` or in RPC) and only for the main agent.

## Requirements

- OMP `18.13.2`
- [Bun](https://bun.sh)

## Installation

```sh
git clone https://github.com/JohnConnor94/omp-usage-statusbar.git
cd omp-usage-statusbar
bun install
```

If `bun install` fails because of a private registry in `.npmrc`, use `bun install --registry=https://registry.npmjs.org`.

Quick install without cloning: `omp plugin install github:JohnConnor94/omp-usage-statusbar`.

Or register the plugin from the clone (a symlink to the repository, enabled by default) and start OMP with no other arguments:

```sh
omp plugin link .
omp
```

The rows appear only once. Alternative without linking: `omp --extension ./`. Use only one of the two modes: combining them did not produce duplicate rows in the test I ran, but it is not a supported configuration.

## Usage

With `label: full` (default) each row has the form `<provider>/<account> <window> [<bar>] <remaining>% [<reset>] · …`, sorted by provider, account and window. The `provider` and `none` modes shorten the prefix (see `Configuration`). Windows without a resolvable value are omitted. The reset appears only if the provider reports it and it has not already passed; the countdown drops to whole minutes, with a minimum of `1m`.

Status messages:

- `Usage: loading`: first load in progress.
- `Usage: no quota data`: no subscription with quota data.
- `Usage: unavailable`: the fetch failed before any data was available. If it fails later, the last valid rows remain.

## Configuration

Settings are read from two JSON files, written by the `/usage-statusbar` command or editable by hand:

- global: `~/.omp/agent/usage-statusbar.json`, default values for all projects;
- project: `<project>/.omp/usage-statusbar.json`, overrides the global file.

```json
{ "enabled": true, "label": "provider", "resets": "clock", "bar": "below", "barWarn": 30, "barCritical": 5, "textColor": "split", "hidden": ["github-copilot/octocat"] }
```

- `enabled`: `true` shows the rows, `false` hides them.
- `label`: the account name in the row.
  - `full` (default): `anthropic/user@example.com (Org) Claude 5 Hour ███████░░░ 69% 2h30m · Claude 7 Day ███████░░░ 73% 3d2h`
  - `provider`: `anthropic Claude 5 Hour ███████░░░ 69% 2h30m · Claude 7 Day ███████░░░ 73% 3d2h`
  - `none`: `Claude 5 Hour ███████░░░ 69% 2h30m · Claude 7 Day ███████░░░ 73% 3d2h` (windows only).
- `resets`: how each window shows its reset (local time; the verb `resets` can become `tick` or `regen` if the provider indicates so).
  - `countdown` (default): `Claude 5 Hour ███████░░░ 69% 2h30m`
  - `verbose`: `Claude 5 Hour ███████░░░ 69% (resets in 2h30m)`
  - `clock`: `Claude 5 Hour ███████░░░ 69% (resets 18:00)`; `(resets Tue 18:00)` within 6 days, `(resets 3 Oct)` beyond that.
  - `off`: `Claude 5 Hour ███████░░░ 69%` (percentages only).
- `bar`: position of the bars (default `beside`).
  - `beside`: bar between the window name and the percentage, for example `Claude 5 Hour ███████░░░ 69%`.
  - `below`: a second line with the bars aligned under each window, for example `Claude 5 Hour 69%` followed by `└  ███████░░░`.
  - `overlay`: for example the text `Claude 5 Hour` is colored by the bar.
  - `off`: no bar (`bar: off`), for example `Claude 5 Hour 69%`.
- `barWarn` (default 25): number 0–100; at or below this value the bar turns yellow. Invalid values are ignored.
- `barCritical` (default 10): number 0–100; at or below this value the bar turns red. Invalid values are ignored.
- `textColor` (default `off`): how to color the text based on the quota level.
  - `off`: colors only the bar.
  - `percent`: colors only `NN%` in the level color.
  - `window`: colors the name, percentage and reset of each window in its level.
  - `split`: like `window`, plus the prefix in the worst level of the row.
  - `row`: colors the whole row, including prefix and separators, in the worst level.
  - `parts`: accent prefix, neutral name, percentage per level and dimmed reset.
  In `overlay` mode, only `window`, `split` and `row` color the non-shaded part.
- `hidden`: subscriptions to hide, identified by the `<provider>/<account>` part of the `full` mode.

Precedence per key: defaults < global < project. The project `hidden` replaces the entire global list, it does not merge with it. An unreadable or invalid file is ignored with a warning. Manual edits to the files apply when OMP restarts.

### The `/usage-statusbar` command

Edits the files without touching them by hand, and applies the change to the footer immediately (it re-reads data already loaded, without a new fetch, unless re-enabled). Esc goes back.

1. Choose the scope: `Global` (default for all projects) or `Project` (overrides the global file in the current folder).
2. In the menu:
   - `Enabled: on|off`: turns the rows on or off.
   - `Account label`: `Full`, `Provider only` or `None — windows only`. In the `Project` scope, values not written in the project file are marked `(inherited)`.
   - `Reset times`: `Countdown`, `Countdown with verb`, `Clock` or `Off` (same `(inherited)` marking).
   - `Bar`: `Beside`, `Below`, `Overlay` or `Off` (same `(inherited)` marking).
   - `Bar thresholds`: two numeric fields; an empty value keeps the current one, and red cannot exceed yellow.
   - `Text color`: `Off`, `Percent`, `Window`, `Window + prefix`, `Row` or `Parts`.
   - `Subscriptions…`: chooses the visible subscriptions (see below).
   - `Reset project overrides` (`Project` only): deletes `<project>/.omp/usage-statusbar.json`.
   - `Done`: exits.

The `Subscriptions…` menu lists the loaded subscriptions: `[x]` visible, `[ ]` hidden; select one to toggle it. Hidden keys that no longer appear in the reports stay in the list marked `(not reported)`. Every change writes the entire `hidden` list to the file of the chosen scope, so in `Project` it saves a full copy of the effective list. If there is no data yet, the menu asks you to wait for the first update.

## Enabling and disabling

Live, without restarting: `/usage-statusbar` → scope → `Enabled`. With `off` the rows disappear and fetches stop; with `on`, `Usage: loading` appears and then the rows. The `enabled` value is saved in the file of the chosen scope.

From the plugin (if installed with `omp plugin link .`):

```
/plugins disable omp-usage-statusbar
/plugins enable omp-usage-statusbar
```

The change is **not immediate**: the rows remain until you restart `omp`. After restarting with the plugin disabled, no rows appear and `/usage-statusbar` no longer exists (the text is sent to the model as a normal message). After `/plugins enable` and a restart the rows come back. For an on/off without restarting, use `Enabled`.

## Uninstalling

If you installed the plugin with `omp plugin link .`:

```sh
omp plugin uninstall omp-usage-statusbar
```

This removes only the link: the repository folder stays intact. If you loaded it with `omp --extension ./`, stop passing `--extension ./`.

Optional: delete the settings, that is `~/.omp/agent/usage-statusbar.json` and the `.omp/usage-statusbar.json` file of each project.

## Development

```sh
bun install
bun test
bun run typecheck
```

The type check must print nothing.

Feature and release branches are squash-merged into `develop`; `master` only fast-forwards to `develop` at release. See CONTRIBUTING.md.

Structure of `src/`:

- `index.ts`: OMP extension (lifecycle, report fetching, footer rows).
- `usage-summary.ts`: pure formatting of the reports into text rows (label modes, hidden subscriptions).
- `usage-summary.test.ts`: formatter tests.
- `config.ts`: reading, merging and writing the configuration files.
- `config.test.ts`: configuration tests.

## License

MIT, see [LICENSE](LICENSE).

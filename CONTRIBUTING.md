# Contributing

Thanks for considering a contribution.

## Setup

```sh
bun install
```

## Checks

Run both before opening a pull request:

```sh
bun test
bun run typecheck   # must print nothing
```

CI runs the same two commands on every push to `develop` and `master`, and on every pull request.

## Branching

- Feature branches are created from `develop`: `feature/<name>`.
- Rebase the feature branch on `develop` before integrating it.
- Integrate with `git merge --squash`, producing one conventional commit on `develop`. The commit body lists the original commits under `Squash of <branch>:`.
- Releases use a `release/X.Y.0` branch from `develop`. It bumps `version` in `package.json` and adds the release section to `CHANGELOG.md`, then is squashed into `develop` as `chore(release): X.Y.0`.
- `master` only fast-forwards to `develop` at release time. After the fast-forward, create an annotated tag `vX.Y.0`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `build:`, `ci:`, `chore:`, optionally with a scope.

## Changelog

Every user-visible change adds an entry under `## [Unreleased]` in `CHANGELOG.md`, following [Keep a Changelog](https://keepachangelog.com/).

## Pull requests

Use the pull request template. Keep pull requests focused on one change.

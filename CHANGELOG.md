# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.5.0] - 2026-10-28

### Added

- Remaining-quota bars in footer rows.
- Configurable bar position (`bar`) and thresholds (`barWarn`, `barCritical`).
- Row text colored by quota level (`textColor`).

## [0.4.0] - 2026-10-28

### Added

- Configurable reset time format (`resets`), also settable from `/usage-statusbar`.

### Documentation

- Label modes described in the usage section.

## [0.3.0] - 2026-10-28

### Added

- `/usage-statusbar` menu for scope, labels, on/off toggle and visible subscriptions.

### Documentation

- Plugin install, toggle and uninstall instructions.

## [0.2.0] - 2026-10-28

### Added

- Label modes and hidden subscriptions in the formatter.
- Global and project config files are read, merged and written, and applied at session start.

## [0.1.0] - 2026-10-28

### Added

- Usage status-bar extension.

### Fixed

- One status row per quota account.
- Quota status preserved during fetch failures.

### Documentation

- README and inline module documentation.

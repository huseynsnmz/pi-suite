# Changelog

## 0.2.0

### Added

- `/effort` picks the effort, and `/effort high` sets it directly.
- With pi-modes, the editor frame's color follows the mode.

### Changed

- The effort shows as a divider and its level, without the meter.

### Fixed

- With pi-modes, the start card no longer says `shift+tab` changes the effort. It says `shift+tab mode`, and names `/effort` or your other effort key.

## 0.1.0

First release, forked from `@adeildo/pi-look` 6.0.0.

### Security

- `git status` no longer runs what a repository configures: `core.fsmonitor`, filters, hooks, submodule config or partial clone downloads.
- Escape sequences, control characters and bidirectional overrides are removed from what is drawn. Colors stay. This covers tool boxes, the `Alt+O` view, the start card, the editor frame and the footer.
- The visits file is readable only by you and written atomically. Entries of the wrong shape are ignored.

### Fixed

- `auto` icons no longer need a Nerd Font.
- `gh` starts only for a remote on a GitHub host.

### Changed

- Renamed to `pi-frame`: the package, settings keys, session entries and start card.
- Removed the screenshots, which showed the old name.

# Changelog

## 0.3.0

### Added

- With a GitLab remote, the start card shows a failed pipeline and merge requests waiting on you, through `glab`.
- `Ctrl+C` while something runs stops it and says `Aborted`. With nothing running, it clears the editor and says to press it again within 2 seconds to exit.
- The red `yolo` frame for the new pi-modes mode.

### Changed

- What Pi loaded at startup (context, skills, prompts, extensions) is drawn in frames.
- On a Mac, key hints say `option+` instead of `alt+`.
- A status with no color of its own, like `perm-judge:`, is drawn dim like the rest of the footer.
- When the start card's bottom edge is short of room, the key hints go before the count of what waits on you.

## 0.2.0

### Added

- `/effort` picks the effort, and `/effort high` sets it directly.
- With pi-modes, the editor frame's color follows the mode.

### Changed

- The effort shows as a divider and its level, without the meter.

### Fixed

- With pi-modes, the start card no longer says `shift+tab` changes the effort. It says `shift+tab mode`, and names `/effort` or your other effort key.

## 0.1.0

First release, forked from `@adeildo/pi-look` 6.0.0 and renamed to `pi-frame`: the package, settings keys, session entries and start card.

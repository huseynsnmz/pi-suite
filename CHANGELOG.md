# Changelog

## 0.3.5

### Changed

- Option+S turns the sandbox on and off on a Mac even when the terminal types `ß`.
- The extensions on the start card show their versions, like `pi-subagents@0.84.0`.
- Updated `diff` to 9.0.0.

## 0.3.4

### Changed

- Settings open with `Ctrl+S`, because `pi-sandbox` needs `Alt+S`. `Cmd+S` still works where the terminal can send it.
- The start card no longer lists effort. `/effort` is unchanged.

### Added

- With `pi-sandbox` installed, the start card shows its on/off key, and the bottom line shows `sandbox: on` or `sandbox: off` after the mode.

## 0.3.3

### Changed

- The bottom line starts with the mode, then a divider and the other statuses, then the session's numbers.

## 0.3.2

### Changed

- The context, skills, prompts and extensions Pi loaded are rows in the start card, with `+N` for what doesn't fit. `Ctrl+O` still shows them in full, and problems still get their own frame.

## 0.3.1

### Added

- `Cmd+S` and `Cmd+O` on a Mac, in a terminal with the kitty keyboard protocol, and the start card says so.

## 0.3.0

### Added

- With a GitLab remote, the start card shows a failed pipeline and merge requests waiting on you, through `glab`.
- `Ctrl+C` while something runs stops it and says `Aborted`. With nothing running, it clears the editor and says to press it again within 2 seconds to exit.
- The red `yolo` frame for the new pi-modes mode.

### Changed

- What Pi loaded at startup (context, skills, prompts, extensions) is drawn in frames.
- On a Mac, key hints say `option+` instead of `alt+`, or `cmd+` where it works: `Cmd+S` and `Cmd+O` in a terminal with the kitty keyboard protocol.
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

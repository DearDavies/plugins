# Changelog

## 0.1.1 · 2026-10-31

### Fixed

- An agent another agent ran and then interrupted from the shell (`claude -p` or `codex exec` killed by SIGTERM or SIGKILL) no longer stays in the office as at work, then stuck, until its session is deleted in magpie. A Claude Code session with no running process in Claude Code's `sessions/<pid>.json` files is stopped (also Qoder, WorkBuddy and CodeBuddy when their folder keeps such files).
- **Clear** (清除) in an agent's panel takes a stuck, failed, stopped, finished or waiting agent out of the office until its session moves again. Before, nothing could take one out but `hideAfter`, and a waiting one never left.

## 0.1.0 · 2026-10-29

首个公开发布版本。First public release.

### Added

- Live session readers for Claude Code, Codex, DeepSeek Harness, Gemini CLI, Qwen Code, Pi, omp, Qoder, WorkBuddy and CodeBuddy, with a gateway-hook fallback for other agents.
- Isometric 3D and top-down 2D office, live list, per-agent details and resume commands, plus a draggable and resizable in-page floating window.
- Real-time statuses, current tool steps, approval requests, completed and failed sessions.
- Varied idle gestures: stretching, glancing, leg swinging and dozing, with reduced-motion support.
- Front-aisle sofa boarding and exit, collision-safe pathfinding, worker separation and non-overlapping name tags.
- Correct seating orientation, monitor screens, chair backs and sitting legs for every seat.
- Real agent icons for the agents magpie knows, English and Chinese UI, and local-only text privacy controls.
- Furniture and seated-worker compositing, with no workers painted through sofas, cushions, backrests or consoles.
- The page follows magpie's window background without an outer grey ring.
- 44 automated tests covering session parsing, package safety, pathfinding, sofa compositing, orientation and idle gestures.

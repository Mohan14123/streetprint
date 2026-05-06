# AGENTS.md

## Project
Route Memory Platform — geospatial route tracking MVP.

## Rules
All agents must read and strictly follow `rules.md` before writing any code.
Never simplify routes. Never write GPS coordinates directly to MongoDB. See rules.md for full constraints.

## Build Instructions
The full scaffold prompt is in `claude_code_prompt.md`. Follow the directory structure and build order defined there: config → models → utils → services → controllers → routes → middleware → app → server → jobs → tests → Docker.
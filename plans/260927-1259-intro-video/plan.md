---
title: "GitDash 4.5 introduction video"
status: in-progress
created: 2026-09-27
---

# GitDash 4.5 introduction video

Project: `assets/videos/gitdash-4-5-intro/` (motion-video skill, glass keynote style in the GitDash
graphite palette). Brief, feature inventory and storyboard: `docs/intro-video-prompt.md`.

## Done
- `data/script.json`: 10 scenes, 152 words of narration (voice Puck, calm keynote style).
- `index.html`: 10 scenes, all UI rebuilt with neutral sample names (no real org, repo or people names).
- Silent cut rendered on draft timing (`scripts/draft-timing.mjs`, 120 BPM grid):
  `renders/gitdash-4-5-intro-silent.mp4` (1920×1080, 30 fps, 90.0 s) and `-social.mp4` (13.5 MB).
  `hyperframes lint` 0 errors, `check` passed, snapshots of every scene reviewed.

## Blocked: voice-over and music
multix has no provider keys (`multix check`). Needs `GEMINI_API_KEY` (voice) and an ElevenLabs key
(music, SFX, forced alignment) in `~/.multix/.env`. Then, from the project dir:

1. Fill `data/music-plan.json` / `outro-plan.json` / `sfx.json` / `cues.json` (examples copied in).
2. `node scripts/generate-audio-assets.mjs vo` · `sfx` · `music`
3. `node scripts/align-voiceover.mjs`
4. `python scripts/fit-beat-grid.py assets/audio/music/bgm-raw.mp3` → edit `data/music-arrangement.json`
   → `node scripts/arrange-music.mjs` → `verify-arrangement.py`
5. Edit the EDIT block of `scripts/build-timeline.mjs` (DURATION ~90, anchors) → `node scripts/build-timeline.mjs`
   (replaces the draft TIMING and the silent `mix.m4a`) → `--stems` + `measure-mix-balance.py`
6. lint → check → snapshot → render → remux `mix.m4a` → ebur128 (≈ −14 LUFS, peak ≤ −1 dBFS) → social encode.

`.gitignore` in the project keeps `renders/` and `assets/audio/` out of git.

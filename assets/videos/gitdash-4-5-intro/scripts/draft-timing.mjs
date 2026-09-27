// Draft timing for the silent cut, before voice-over and music exist.
// Produces the same window.TIMING shape as build-timeline.mjs (scenes, lines,
// word onsets, captions, beat grid) from the storyboard durations and an
// estimated speaking rate, and injects it into index.html. Once real audio is
// generated and aligned, run build-timeline.mjs instead; it overwrites this.
// Usage: node scripts/draft-timing.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = JSON.parse(readFileSync(join(root, "data/script.json"), "utf8"));

const BPM = 120;
const BEAT = 60 / BPM;
const DURATION = 90;
const WPS = 2.55; // words per second of the planned narration
// Storyboard scene starts (seconds), from docs/intro-video-prompt.md.
const STARTS = {
  "s01-cover": 0, "s02-monitor": 7.5, "s03-table": 17, "s04-repo": 27, "s05-workflow": 38.5,
  "s06-team": 48, "s07-cost": 57, "s08-alerts": 64.5, "s09-montage": 72.5, "s10-outro": 82.5,
};
const LEAD = { "s01-cover": 1.2, "s10-outro": 0.8 }; // voice starts this long after the cut
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");

const ids = script.scenes.map((s) => s.id);
const scenes = {};
const captions = [];
script.scenes.forEach((s, i) => {
  const start = STARTS[s.id];
  const end = i < ids.length - 1 ? STARTS[ids[i + 1]] : DURATION;
  let t = start + (LEAD[s.id] ?? 0.6);
  const lines = s.lines.map((l) => {
    const toks = l.en.split(/\s+/).filter(Boolean);
    const dur = toks.length / WPS;
    const total = toks.reduce((a, w) => a + w.length + 2, 0);
    let c = t;
    const words = toks.map((w) => {
      const d = ((w.length + 2) / total) * dur;
      const out = [norm(w), +c.toFixed(3), +(c + d).toFixed(3)];
      c += d;
      return out;
    });
    const line = { on: +t.toFixed(3), off: +(t + dur).toFixed(3), words };
    // captions: chunks of at most 9 words, split at punctuation
    let cur = [];
    toks.forEach((w, j) => {
      cur.push([w, words[j][1]]);
      if (cur.length >= 9 || /[.,;:!?]$/.test(w) && cur.length >= 4 || j === toks.length - 1) {
        captions.push({ start: cur[0][1], words: cur, lineOff: line.off });
        cur = [];
      }
    });
    t += dur + 0.45;
    return line;
  });
  if (t > end) console.warn(`[draft] ${s.id} narration (${(t - start).toFixed(1)} s) runs past its scene (${end - start} s)`);
  scenes[s.id] = { start, end, lines };
});
captions.forEach((c, i) => {
  const next = captions[i + 1];
  c.end = +Math.min(next ? next.start : DURATION, c.lineOff + 0.5).toFixed(3);
  delete c.lineOff;
});

const TIMING = {
  duration: DURATION, fps: 30, beat0: 0, beatLen: BEAT,
  kick: [[8, 164]], drops: [12], outroBeat: 164,
  scenes, captions, sfx: [], env: [],
};
const file = join(root, "index.html");
const html = readFileSync(file, "utf8").replace(
  /\/\*TIMING:BEGIN\*\/[\s\S]*?\/\*TIMING:END\*\//,
  `/*TIMING:BEGIN*/window.TIMING=${JSON.stringify(TIMING)};/*TIMING:END*/`,
).replace(/data-duration="[\d.]+"/g, `data-duration="${DURATION}"`);
writeFileSync(file, html);
console.log(`draft timing: ${ids.length} scenes, ${captions.length} captions, ${DURATION}s`);

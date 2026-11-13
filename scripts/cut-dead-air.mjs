// Removes dead air without touching anything that moves: a span is cut only where the audio is silent AND the picture is frozen for at least `minLen`
// seconds (the page just sitting there). About `keepHead`/`keepTail` seconds of it stay, so a scene never jumps. Everything that moves, and every word, plays at normal speed.
//   node scripts/cut-dead-air.mjs in.mp4 out.mp4 [minLen=2.0] [keepHead=0.9] [keepTail=0.3] [workDir]
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [inp, out, minLen = "2.0", keepHead = "0.9", keepTail = "0.3", workDir = "/tmp/cut-dead-air"] = process.argv.slice(2);
const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inp]).toString());
const a = spawnSync("ffmpeg", ["-threads", "2", "-i", inp, "-af", "silencedetect=noise=-38dB:d=1.5", "-vn", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const v = spawnSync("ffmpeg", ["-threads", "2", "-i", inp, "-vf", "freezedetect=n=-55dB:d=1.0", "-an", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const sil = [...a.matchAll(/silence_start: ([\d.]+)/g)].map((m, i) => [+m[1], +[...a.matchAll(/silence_end: ([\d.]+)/g)][i]?.[1] || dur]);
const frz = [...v.matchAll(/freeze_start: ([\d.]+)/g)].map((m, i) => [+m[1], +[...v.matchAll(/freeze_end: ([\d.]+)/g)][i]?.[1] || dur]);
const cuts = [];
for (const [s0, s1] of sil) for (const [f0, f1] of frz) { const lo = Math.max(s0, f0), hi = Math.min(s1, f1); if (hi - lo >= +minLen) cuts.push([lo + +keepHead, hi - +keepTail]); }
cuts.sort((x, y) => x[0] - y[0]);
const merged = []; for (const c of cuts) { if (c[1] - c[0] < 0.3) continue; const last = merged[merged.length - 1]; if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]); else merged.push([...c]); }
const keep = []; let t = 0; for (const [x, y] of merged) { if (x > t) keep.push([t, x]); t = y; } if (t < dur) keep.push([t, dur]);
rmSync(workDir, { recursive: true, force: true }); mkdirSync(workDir, { recursive: true });
const V = ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-threads", "2", "-pix_fmt", "yuv420p", "-r", "30"], A = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"];
const list = [];
keep.forEach(([x, y], i) => { const f = join(workDir, `k${String(i).padStart(3, "0")}.mp4`); list.push(`file '${f}'`); execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-threads", "2", "-ss", String(x), "-i", inp, "-t", String(y - x), ...V, ...A, f]); });
writeFileSync(join(workDir, "list.txt"), list.join("\n") + "\n");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(workDir, "list.txt"), "-c", "copy", "-movflags", "+faststart", out]);
const removed = merged.reduce((s, [x, y]) => s + y - x, 0);
console.log(`cut ${merged.length} dead spans (${removed.toFixed(1)} s): ${dur.toFixed(1)} s -> ${(dur - removed).toFixed(1)} s`);

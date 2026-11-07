// Cuts long silent waits (e.g. waiting for the chain) down to a short beat, audio and video together.
//   node scripts/trim-silence.mjs in.mp4 out.mp4 [minSilenceSeconds=5] [keepSeconds=3.5]
import { spawnSync, execFileSync } from "node:child_process";
const [inp, out, minS = "5", keepS = "3.5"] = process.argv.slice(2);
const r = spawnSync("ffmpeg", ["-i", inp, "-af", `silencedetect=noise=-40dB:d=${minS}`, "-vn", "-f", "null", "-"], { encoding: "utf8" });
const starts = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
const ends = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
const cuts = starts.map((s, i) => [s + +keepS, ends[i]]).filter(([a, b]) => b !== undefined && b - a > 0.5);
console.log(`cutting ${cuts.length} waits:`, cuts.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(" "));
if (!cuts.length) { execFileSync("cp", [inp, out]); process.exit(0); }
const E = `not(${cuts.map(([a, b]) => `between(t,${a},${b})`).join("+")})`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", inp, "-filter_complex", `[0:v]select='${E}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${E}',asetpts=N/SR/TB[a]`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out]);

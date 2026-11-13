// Makes narration flow: every silent gap of at least `minGap` seconds is replaced by a short pause of `pause` seconds. The picture is not cut, it is
// sped up through the gap (the page keeps moving), and speech is never touched. Each piece is encoded on its own, so memory stays small.
//   node scripts/compress-gaps.mjs in.mp4 out.mp4 [minGap=1.0] [pause=0.7] [margin=0.15] [workDir]
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [inp, out, minGap = "1.0", pause = "0.7", margin = "0.15", workDir = "/tmp/compress-gaps"] = process.argv.slice(2);
const MIN = +minGap, PAUSE = +pause, M = +margin;
const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inp]).toString());
const r = spawnSync("ffmpeg", ["-threads", "2", "-i", inp, "-af", "silencedetect=noise=-38dB:d=0.4", "-vn", "-f", "null", "-"], { encoding: "utf8" });
const starts = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]), lens = [...r.stderr.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => +m[1]);
const gaps = starts.map((s, i) => [s + M, s + lens[i] - M]).filter(([a, b], i) => lens[i] >= MIN && b - a > PAUSE);
// pieces: normal speech/picture, and gaps to squeeze
const pieces = []; let t = 0;
for (const [a, b] of gaps) { if (a > t) pieces.push({ a: t, b: a, fast: false }); pieces.push({ a, b, fast: true }); t = b; }
if (t < dur) pieces.push({ a: t, b: dur, fast: false });
rmSync(workDir, { recursive: true, force: true }); mkdirSync(workDir, { recursive: true });
const V = ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-threads", "2", "-pix_fmt", "yuv420p", "-r", "30"], A = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"];
const list = [];
pieces.forEach((p, i) => {
  const f = join(workDir, `p${String(i).padStart(3, "0")}.mp4`); list.push(`file '${f}'`);
  if (!p.fast) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-threads", "2", "-ss", String(p.a), "-i", inp, "-t", String(p.b - p.a), ...V, ...A, f]);
  else { const k = (p.b - p.a) / PAUSE; // the picture runs k times faster; the sound is silence
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-threads", "2", "-ss", String(p.a), "-i", inp, "-t", String(p.b - p.a), "-f", "lavfi", "-t", String(PAUSE), "-i", "anullsrc=r=44100:cl=stereo",
      "-vf", `setpts=PTS/${k.toFixed(4)}`, "-map", "0:v", "-map", "1:a", "-t", String(PAUSE), ...V, ...A, f]); }
});
writeFileSync(join(workDir, "list.txt"), list.join("\n") + "\n");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(workDir, "list.txt"), "-c", "copy", "-movflags", "+faststart", out]);
console.log(`squeezed ${gaps.length} gaps (${gaps.reduce((s, [a, b]) => s + b - a, 0).toFixed(1)} s -> ${(gaps.length * PAUSE).toFixed(1)} s): ${dur.toFixed(1)} s -> ${(dur - gaps.reduce((s, [a, b]) => s + b - a, 0) + gaps.length * PAUSE).toFixed(1)} s`);

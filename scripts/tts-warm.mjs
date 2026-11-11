// Pre-generates every narration clip (so the real recording has no dead time): EDGE_TTS=/path/to/edge-tts REC_DIR=... node scripts/tts-warm.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { N, VOICE, ttsFile } from "./demo-script.mjs";
const EDGE = process.env.EDGE_TTS ?? "edge-tts";
for (const [k, text] of Object.entries(N)) {
  const f = ttsFile(text); mkdirSync(dirname(f), { recursive: true });
  if (existsSync(f)) { console.log(`cached ${k}`); continue; }
  for (let i = 1; ; i++) { try { execFileSync(EDGE, ["--voice", VOICE, "--rate=-2%", "--text", text, "--write-media", f], { stdio: "ignore" }); break; } catch (e) { if (i >= 8) throw e; execFileSync("sleep", ["6"]); } } // the free voice service sometimes returns no audio: retry
  console.log(`made   ${k}`);
}

# Intro film

A 14.5 second fly-over of the live landing page, used as the opening of `demo/rounds-demo.mp4`. One camera, no cuts: it glides down the page, rises to show the whole page as a strip, dives into the hero and lands it under the closing line. It is drawn by a WebGL2 page (`index.html`) from screenshots of the real page, so every frame is computed from time alone.

```
cd scripts/intro-film
node capture.mjs http://127.0.0.1:5173/      # screenshots of the page and of each card (assets/)
node render.mjs stills 0,1.6,2.5,5,6.5,9.3,11   # look at single frames (stills/)
node render.mjs frames 30                       # all 435 frames, resumable (frames/)
./assemble-intro.sh frames <introA.mp3> <introB.mp3> intro.mp4
```

It renders on the CPU (SwiftShader), at 30 fps and about 8 s per frame; a GPU renders far faster. Needs Chrome and ffmpeg. The narration clips come from `scripts/tts-warm.mjs`.

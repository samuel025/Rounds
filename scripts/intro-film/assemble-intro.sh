#!/bin/bash
# usage: assemble-intro.sh <frames dir> <introA.mp3> <introB.mp3> <out.mp4>
set -e
F="$1"; A="$2"; B="$3"; OUT="$4"; W=$(dirname "$OUT")
# picture: 30 fps film (1440x1152) on a 1280x800 canvas, with a blurred copy of itself behind, and the last frame held while the narration finishes
ffmpeg -y -loglevel error -framerate 30 -i "$F/f%05d.jpg" -vf "tpad=stop_mode=clone:stop_duration=3.0,split[a][b];[a]scale=1280:800:force_original_aspect_ratio=increase,crop=1280:800,boxblur=40:6[bg];[b]scale=-2:800[fg];[bg][fg]overlay=(W-w)/2:0,format=yuv420p" -c:v libx264 -crf 17 -preset medium "$W/intro-silent.mp4"
# sound: the two narration lines plus two soft whooshes and a low hit under the title card
ffmpeg -y -loglevel error -i "$W/intro-silent.mp4" -i "$A" -i "$B" \
 -f lavfi -i "anoisesrc=d=1.0:c=pink:a=0.6,highpass=f=250,lowpass=f=3500,afade=t=in:d=0.5,afade=t=out:st=0.5:d=0.5,volume=0.28" \
 -f lavfi -i "anoisesrc=d=1.0:c=pink:a=0.6,highpass=f=250,lowpass=f=3500,afade=t=in:d=0.5,afade=t=out:st=0.5:d=0.5,volume=0.28" \
 -f lavfi -i "aevalsrc=0.55*sin(2*PI*58*t)*exp(-5*t)+0.10*sin(2*PI*116*t)*exp(-9*t):d=0.9:s=44100" \
 -filter_complex "[1:a]adelay=400:all=1,volume=1.0[va];[2:a]adelay=13000:all=1,volume=1.0[vb];[3:a]adelay=8200:all=1[w1];[4:a]adelay=9350:all=1[w2];[5:a]adelay=9970:all=1[hit];[va][vb][w1][w2][hit]amix=inputs=5:normalize=0,aresample=44100,aformat=channel_layouts=stereo[aud]" \
 -map 0:v -map "[aud]" -c:v copy -c:a aac -b:a 160k -shortest -movflags +faststart "$OUT"
echo wrote "$OUT"

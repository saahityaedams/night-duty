#!/bin/sh
# Rebuilds public/music/ from the Freesound HQ previews (sources and licences in CREDITS.md).
# Usage: sh tools/music.sh <work_dir>
set -e
W=${1:?work dir}; O=public/music; mkdir -p "$W" "$O"
get() { [ -f "$W/$1.mp3" ] || curl -sfL -A 'Mozilla/5.0 (Macintosh) night-duty-build' -o "$W/$1.mp3" "$2"; }
get 868505 https://cdn.freesound.org/previews/868/868505_19169935-hq.mp3
get 218354 https://cdn.freesound.org/previews/218/218354_2806019-hq.mp3
get 663685 https://cdn.freesound.org/previews/663/663685_13159150-hq.mp3

# Build-up: the first 122 s; the last 4 s crossfade into 26-30 s so the loop (loopStart = 30 s,
# BUILD_LOOP_START in src/audio/score.ts) restarts without a seam.
ffmpeg -y -loglevel error -i "$W/868505.mp3" -filter_complex "[0:a]asplit=3[a][b][c];\
[a]atrim=0:118,asetpts=PTS-STARTPTS[head];\
[b]atrim=118:122,asetpts=PTS-STARTPTS,afade=t=out:st=0:d=4:curve=qsin[x];\
[c]atrim=26:30,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=4:curve=qsin[y];\
[x][y]amix=inputs=2:normalize=0[mix];[head][mix]concat=n=2:v=0:a=1,loudnorm=I=-18:TP=-1.5:LRA=9[o]" \
  -map "[o]" -ar 44100 -c:a aac -b:a 80k "$O/build.m4a"

# Swell: plays from the hammer's swing; its peak lands as the 3.2 s slow motion ends.
ffmpeg -y -loglevel error -i "$W/218354.mp3" -af "atrim=0.45:3.95,asetpts=PTS-STARTPTS,afade=t=in:d=0.15,\
afade=t=out:st=3.15:d=0.35,loudnorm=I=-14:TP=-1:LRA=11" -ar 44100 -c:a aac -b:a 128k "$O/finale.m4a"

# Dawn: gently compressed (the piano is very sparse) and faded out at 172 s.
ffmpeg -y -loglevel error -i "$W/663685.mp3" -af "atrim=0:172,asetpts=PTS-STARTPTS,\
acompressor=threshold=-30dB:ratio=2:attack=80:release=900:makeup=1,afade=t=out:st=160:d=12,\
loudnorm=I=-19:TP=-1.5:LRA=12" -ar 44100 -c:a aac -b:a 96k "$O/dawn.m4a"

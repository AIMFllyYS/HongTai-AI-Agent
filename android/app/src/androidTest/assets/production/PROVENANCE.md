# Production instrumentation video fixture

Generated on 2026-08-20 from lavfi synthetic color and sine audio. No user recording or internet media is present. Dedicated to the public domain under CC0-1.0.

Reproduction command from the repository root (Gyan FFmpeg full build):

```powershell
ffmpeg -y -f lavfi -i "color=c=0x105D52:s=720x1280:d=16:r=30" -f lavfi -i "sine=frequency=440:duration=16" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.1 -b:v 250k -preset veryfast -c:a aac -b:a 48k -ac 1 -ar 44100 -movflags +faststart -shortest android/app/src/androidTest/assets/production/portrait-16s.mp4
```

`portrait-16s.mp4` is 720×1280, 16 seconds, H.264 Baseline + AAC. The authoritative SHA-256 is in `fixtures.sha256`.

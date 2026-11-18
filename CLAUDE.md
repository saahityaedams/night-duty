# Night Duty

A short, realistic, highly polished mobile web destruction game, made as a personal gift for one player. She is a resident doctor at a private charity hospital in Bangalore, on a recent iPhone. The owner of this repo decides whether it ever gets sent.

**Design document (source of truth):** https://claude.ai/artifact/TpiXENvwiDcDuPQaK6jahB
Read it with the Claude Docs tools before changing gameplay, art, audio or text. Its "On-screen text (draft)" section holds every word that appears in the game.

## Non-negotiables

- Never name or depict her real hospital. No people, no medicine, no death or grief, nothing that implies neglecting patients.
- Dry hospital-admin voice for all text. No exclamation marks, no encouragement, no wellness language. No rage-meter label, no "Let it all out".
- Shadow-first realistic look: close camera, deep shadow, detail only where light falls.
- Universal resident life with only light local flavour. The owner said an earlier draft was "overboard with the Indianness".
- No ads, analytics, tracking or network calls beyond loading the game itself.
- Quality over speed. Verify visually with screenshots and iterate.

## Dependencies

- `.npmrc` sets `min-release-age=7`: npm only installs versions published at least 7 days ago, including transitive ones. Never bypass it with `--before` or by overriding the setting. If only a fresh release fixes a confirmed bug, ask the owner first.
- `save-exact=true`: versions are pinned.

## Commands

- `npm run dev`: dev server on the LAN, port 5173, for testing from a phone on the same Wi-Fi
- `npm run build` / `npm run preview`: production build, served on port 4173
- `npm run typecheck`
- `npm test`: Playwright in WebKit (iPhone 15 Pro emulation) and installed Chrome (Pixel 7). Screenshots go to `test-results/screens/`.
- `npm run blender -- <script.py> -- <args>`: headless Blender 5.3 for the asset pipeline (`tools/blender/`)
- `npm run ship`: typecheck, run every test, and deploy only if all pass. **Always deploy with this**, never `deploy:preview` directly.
- `npm run deploy:preview`: build and deploy to the Cloudflare Worker (`wrangler.jsonc`) without tests. Needs `npx wrangler login` once.

## Architecture

- `src/engine/`: renderer (Three.js, WebGL2, pixel ratio capped at 2) and physics (Rapier, fixed 60Hz step, settle system that stands in for rolling resistance)
- `src/debug/`: frame stats
- `window.__nd`: test hooks (ready flag, stats, simulated taps, awake-body diagnostics). Tests depend on these; keep them working.
- `tools/blender/`: Python scripts run headless for modelling, fracture and light baking
- `assets-src/`: source assets before processing
- `public/_headers`: noindex and caching headers for Cloudflare

## Session arc

- `src/game/arc.ts` owns the session: warm-up -> bat -> printer reveal -> hammer/locker reveal -> meter -> finale -> silence -> Pending: 0 -> dawn -> ending. Thresholds live in `src/game/arcConfig.ts`.
- Preview links: `?all=1` unlocks every tool and view; `?shot=desk|deskWide|left|right|finale|dawn` (case-insensitive) also unlocks everything.
- Words outside the 3D scene: `src/content/text.ts`, including `PERSONAL_MESSAGE` (empty until the owner writes it).
- Music: `public/music/build.m4a` (seamless loop from 30s, opened up by a low-pass filter as the meter fills), `finale.m4a` (swell from the hammer swing through the slow motion) and `dawn.m4a`. All CC0 from Freesound, rebuilt by `tools/music.sh`. A missing file falls back to the generative placeholder in `src/audio/score.ts`.
- Offline: `npm run build` runs `tools/gen-sw.mjs`, which precaches every file in `dist/` (bump `SW_REV` when changing caching logic).

## Known follow-ups

- Rapier compat inlines its 2.9MB WASM as base64 (4.9MB script, 1.8MB gzipped). Load the `.wasm` file separately before shipping.
- Textures are compressed JPGs (~0.5MB total). KTX2 would save GPU memory but isn't needed at this size.
- The resting scene is ~150 draw calls. Merge static set dressing (keyboard, papers, room) with baked lighting in milestone 2.
- Sound one-shots were picked by title and loudness envelope, not by ear. The owner should listen and flag bad ones (`public/audio/`, sources in `CREDITS.md`).
- The iOS haptic workaround (`Haptics` in `src/game/juice.ts`) is unverified on a real iPhone.
- Rapier panics ("unreachable", then "recursive use of an object") freeze the whole game. Never call into the world (collider.parent(), removals) from inside a query callback or filter, and re-fetch bodies by handle after anything that can break an object.
- "Another shift?" fades out and reloads the page (instant from the offline cache) instead of rewinding the room.

## Visual iteration

`node tools/shot.mjs <out.png> [--engine webkit|chrome] [--wait ms] [--eval "js"] [--url ...]` screenshots the running dev server (`npx vite`) as a phone, prints frame stats and errors. Test hooks on `window.__nd`: `flick`, `tap`, `breakAll`, `counts`, `mugScreenPositions`, `audio`, `stats`.

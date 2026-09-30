# Subliminal + Music Multi-Layer Player

A web app (installed on iPhone via Safari → Add to Home Screen) that plays several audio layers
mixed into one output: a subliminal looping underneath, plus any number of extra layers — music
playlists, ambient tracks, more subliminals — each with its own volume. Mixed through the Web Audio
API so iOS treats it as a single audio session with lock-screen controls and playback that survives
the screen locking.

**Current state: Phase 0 only — the lock-screen spike.** The full app is not built yet, on purpose.

## Why the spike exists

The whole design rests on one thing nobody has verified on this phone: whether a playlist layer
actually advances from track to track *while the screen is locked*. Several iOS/PWA reports say the
next track only starts once you unlock. A pure looping layer needs no mid-playback logic and should
be fine either way.

If rollover works, playlist layers are straightforward. If it doesn't, they need a different
mechanism (pre-concatenating tracks into one buffer, or pre-scheduling sources on the audio clock),
and that changes the core of the app. So: test first, build second.

`spike/` is disposable throwaway code. It is not the app.

## Deploying it

GitHub Pages, because iOS will not install a PWA to the home screen from a plain-HTTP origin.

```bash
git add -A && git commit -m "Lock-screen spike"
```

Then create an empty repo on GitHub and:

```bash
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO.git && git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.**
After a minute the spike is at:

```
https://YOUR_USERNAME.github.io/YOUR_REPO/spike/
```

Desktop smoke test first, if you want (proves the mixing works, proves nothing about iOS):

```bash
python3 -m http.server 8000
```

…then open http://localhost:8000/spike/

## The test

You need three MP3s on the phone: one long track for the loop layer, and **two short ones (~30s)**
for the playlist layer — short, so you aren't standing around with a locked phone for four minutes.

1. Open the Pages URL in **Safari** on the iPhone. Share → **Add to Home Screen**. Close Safari and
   open it from the new icon (it must run standalone, not in a Safari tab — the backgrounding
   behaviour differs).
2. Load the long track into **Layer 1**, and select **both** short songs for **Layer 2**.
3. Press **Play**. Check you can hear both at once, and that each volume slider moves only its own
   layer.
4. **Lock the phone.** Keep it locked, listening, past the end of song 1.
5. The question: **does song 2 start while it's still locked?** Note roughly how long after song 1
   ended, if it does.
6. While still locked, check the lock screen shows track info, and that the play/pause button there
   actually pauses and resumes.
7. Unlock. Read the event log at the bottom of the page and hit **Copy**.

### What the log tells us

- `[list] ended` then `[list] ADVANCING` with a **timestamp from while you were locked** → rollover
  works. Best case.
- Both stamped at the moment you **unlocked** → JS was frozen; playlist layers need the fallback.
- `beat` lines stopping during lock and then arriving in a burst → timers were throttled, same
  conclusion.
- `play() REJECTED` → iOS blocked the un-gestured start; also a fallback case, different cause.
- `ctx.statechange -> suspended`/`interrupted` → the audio session itself was torn down, which
  affects *every* layer, not just playlists.

Send me the copied log and we'll pick the design from there.

## Planned structure (Phase 1+, not built)

- `audio/mixer.js` — the `AudioContext`, master gain, and a map of layer id → node chain. A layer is
  just another entry, so there's no cap on layer count.
- `audio/layer.js` — one layer: source element, gain, mode (`loop` | `playlist`), track list,
  advance logic, mute, dispose.
- `storage/files.js` — IndexedDB store of uploaded MP3 blobs.
- `storage/presets.js` — named snapshots of a layer setup (files, modes, volumes, order).
- `sw.js` — caches the app shell only; audio blobs stay in IndexedDB.

Browser storage is not guaranteed permanent — iOS can evict it. **Keep your original MP3s in the
Files app as backup.**

## Notes

- The app icons in `icons/` are generated placeholders (`icons/` was produced by a script, not
  artwork). Swap them whenever.
- `navigator.audioSession.type = 'playback'` is set when available — the iOS 17.5+ fix for
  background suspension. The log says whether your phone supports it.

<p align="center"><img src="src/assets/logo.png" width="120" alt="HB Software"></p>

<h1 align="center">HB Mashup Studio</h1>
<p align="center"><b>Easy mashups and performance mixes — by <a href="https://hbcs.info">HB Software</a></b><br>
Free for anyone. Works on Windows, Mac, iPhone, Android and tablets. No account, no subscription, no internet needed.</p>

---

## What every button does

**Playing**

| Button | What it does |
|---|---|
| ▶ / ❚❚ | Play or pause the mix. |
| ⏮ Start | Jump back to the beginning. |
| ■ Stop | Stop and go back to the start. |
| Gold line | The playhead — where the music is playing. Tap the time numbers or an empty spot to move it. |

**Songs & clips**

| Button | What it does |
|---|---|
| ＋ Add Songs | Pick songs to use (MP3, WAV, M4A, AAC, FLAC, OGG). Each song gets its own row (track). |
| Drag a clip | Move it earlier or later, or onto another row so two songs play at the same time. |
| Drag a clip's edge | Trim — shorten the start or end. |
| ✂ Split | Cut a clip in two at the gold line. |
| ⧉ Copy Clip | Make a copy of the clip you picked, right after it. |
| 🗑 Delete Clip | Remove the clip you picked. |

**Sections**

| Button | What it does |
|---|---|
| Highlight | Drag across the time numbers at the top to highlight a section (shows in blue). |
| ✂ Cut Section | Remove the highlighted part from every row and close the gap. |
| ★ Keep Section | Throw away everything except the highlighted part. |
| ⏸ Add Pause | Add 1–10 seconds of silence at the gold line. |

**Sound**

| Button | What it does |
|---|---|
| ⚖ Even Out Volume | Makes the volume even, two ways: **Match every song** gives every clip the same overall volume, and **Smooth the whole mix** also fixes loud and quiet parts *inside* a song, so the volume stays steady from start to finish. |
| Old mixes | Add a mix you made before with ＋ Add Songs, then press Even Out Volume → **Smooth the whole mix**. The app recommends this automatically for a single long file. |
| 🎚 Smooth this clip | In a clip's settings: steady volume for just that one clip (turn it off the same way). |
| Even Out level | How loud Even Out Volume makes things: Loud (club), Standard or Softer. |
| Mute | Silence a row. |
| Solo | Hear only that row. |
| Row slider | Volume for that whole row. |
| Main volume | Volume for the whole mix. |
| Protect from distortion | Keep this on — it stops loud mixes from crackling. |
| Clip settings | Tap a clip to change its volume, fade in, fade out and speed (0.8×–1.5×; changes pitch too). |

**Other**

| Button | What it does |
|---|---|
| ↶ Undo / ↷ Redo | Take back a change, or bring it back. |
| Snap clips | When on, clips line up neatly as you drag them. |
| Zoom − Fit ＋ | Make the timeline bigger or smaller. Fit shows the whole mix. On phones you can also pinch. |
| ＋ Add Track | Add an empty row. |
| ✕ on a row | Remove that row and its clips. |
| ? Help | Shows this list inside the app. |

**Files**

| Button | What it does |
|---|---|
| New | Clear everything and start over. |
| Save | Save your project (`.hbmix`) to keep working later. The songs are saved inside it, so you can send it to a friend. |
| Open | Open a project you saved. |
| Export Mix | Make the finished MP3 or WAV to perform with. |

If a button can't do anything yet (for example Delete Clip before a clip is picked), it looks faded — tap it anyway and it tells you what to do first.

## For performers: how to get it

Nothing else to install — everything the app needs comes inside it.

| Device | How |
|---|---|
| **Windows 10 / 11** | [Download for Windows](https://github.com/HoeBeard/HB-Mashup-Studio/releases/latest/download/HB-Mashup-Studio-Setup.exe), then double-click it. It installs and opens by itself, and puts a shortcut on your desktop. If Windows shows "Windows protected your PC", click **More info → Run anyway**. |
| **Mac** (macOS 12 or newer) | [Download for Mac](https://github.com/HoeBeard/HB-Mashup-Studio/releases/latest/download/HB-Mashup-Studio-Mac.dmg), open it and drag the app into **Applications**. The first time you open it, macOS may say it can't check the app: open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. |
| **iPhone / iPad** | Open [the app link](https://hoebeard.github.io/HB-Mashup-Studio/) in **Safari** → tap **Share** → **Add to Home Screen**. |
| **Android** | Open [the app link](https://hoebeard.github.io/HB-Mashup-Studio/) in **Chrome** → tap **⋮** → **Install app** (or *Add to Home screen*). |

The Windows installer checks the computer first and explains clearly if it's too old (it needs 64-bit Windows 10 or 11).
On phones, exported mixes open the share sheet so you can save to Files, Google Drive, AirDrop or send in a message.

---

## For the owner: publishing it (one-time, ~10 minutes)

1. **Phone app link:** repo **Settings → Pages → Source: GitHub Actions**. Every push to `main` publishes it to
   `https://hoebeard.github.io/HB-Mashup-Studio/`
2. **Installers:** every push to `main` builds the Windows and Mac installers and puts them on the **Releases** page automatically.
   The download links above always point to the newest one. Raise `version` in `package.json` to start a new release instead of updating the current one.

### Changing the logo
Replace **`src/assets/logo.png`** with your logo (square PNG, at least 512×512). That one file is used for the app header, desktop icon, installer and phone home-screen icon. Push the change and the builds update.

### Running it on your own computer
Requires [Node.js](https://nodejs.org) (only for you as the developer — users never need it).
```
npm install
npm start          # open the app
npm test           # check the audio engine
npm run check      # make sure everything the installer needs is there
npm run dist:win   # build the Windows installer into dist/
```

### How it's built
- `src/` — the whole app (HTML/CSS/JS, Web Audio). Same code runs on desktop and phone.
- `src/engine.js` — editing, loudness measurement (ITU-R BS.1770), mixing, WAV/MP3 export, project files.
- `main.js` / `preload.js` — desktop window and file save/open dialogs.
- `src/sw.js` + `manifest.webmanifest` — offline support and "Add to Home Screen".

Fonts: Poppins (SIL Open Font License). MP3 encoding: lamejs (LGPL).

© 2026 HB Software · [hbcs.info](https://hbcs.info)

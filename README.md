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

| Device | How |
|---|---|
| **Windows** | Download `HB-Mashup-Studio-Setup.exe` from the **Releases** page and run it. If Windows shows "Windows protected your PC", click **More info → Run anyway**. |
| **Mac** | Download the `.dmg` from **Releases**, drag the app to Applications. The first time, **right-click the app → Open**. |
| **iPhone / iPad** | Open the app link in **Safari** → tap **Share** → **Add to Home Screen**. |
| **Android** | Open the app link in **Chrome** → tap **⋮** → **Install app** (or *Add to Home screen*). |

On phones, exported mixes open the share sheet so you can save to Files, Google Drive, AirDrop or send in a message.

---

## For the owner: publishing it (one-time, ~10 minutes)

1. Create a new repository on GitHub (e.g. `HB-Mashup-Studio`) and upload everything in this folder.
2. **Phone app link:** repo **Settings → Pages → Source: GitHub Actions**. Every push publishes it to
   `https://<your-github-name>.github.io/HB-Mashup-Studio/`
3. **Installers:** open the **Actions** tab → **Build installers** → **Run workflow**. When it finishes, the `.exe` and `.dmg` are under that run's *Artifacts*.
   To put them on a public download page, create a tag/release named `v1.0.0` — the installers attach to the Release automatically.

### Changing the logo
Replace **`src/assets/logo.png`** with your logo (square PNG, at least 512×512). That one file is used for the app header, desktop icon, installer and phone home-screen icon. Push the change and the builds update.

### Running it on your own computer
Requires [Node.js](https://nodejs.org) (only for you as the developer — users never need it).
```
npm install
npm start          # open the app
npm test           # check the audio engine
npm run dist:win   # build the Windows installer into dist/
```

### How it's built
- `src/` — the whole app (HTML/CSS/JS, Web Audio). Same code runs on desktop and phone.
- `src/engine.js` — editing, loudness measurement (ITU-R BS.1770), mixing, WAV/MP3 export, project files.
- `main.js` / `preload.js` — desktop window and file save/open dialogs.
- `src/sw.js` + `manifest.webmanifest` — offline support and "Add to Home Screen".

Fonts: Poppins (SIL Open Font License). MP3 encoding: lamejs (LGPL).

© 2026 HB Software · [hbcs.info](https://hbcs.info)

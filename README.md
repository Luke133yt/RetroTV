# RetroTV 📺

**Your own old-school television, built on the media you already watch in Stremio and Nuvio.**

RetroTV turns your library and your stream addons into real TV channels: daily schedules, complete
episodes, commercial breaks, a Teletext-style guide, channel watermarks and an addon that puts
those channels on your TV. It runs locally, keeps working with downloaded files when the internet
is down, and needs **no npm dependencies** — only Node.js.

[![Latest release](https://img.shields.io/github/v/release/Luke133yt/RetroTV?label=release)](https://github.com/Luke133yt/RetroTV/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Node.js 18+](https://img.shields.io/badge/node-18%2B-brightgreen)

> **Project status:** RetroTV 2.1.0. The web TV and the Stremio/Nuvio addon are stable. Firefox is
> **not** supported; use a Chromium-based browser (see [Known issues](#known-issues)).

---

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [First setup](#first-setup-about-5-minutes)
- [Updates](#updates)
- [Channels and scheduling](#channels-and-scheduling)
- [Video language and audio tracks](#video-language-and-audio-tracks)
- [Commercials](#commercials)
- [Channel watermarks](#channel-watermarks)
- [Downloaded / offline library](#downloaded--offline-library)
- [Stremio / Nuvio addon](#stremio--nuvio-addon)
- [Controls](#controls)
- [Data, backup and configuration](#data-backup-and-configuration)
- [Known issues](#known-issues)
- [Troubleshooting](#troubleshooting)
- [Development and tests](#development-and-tests)
- [Project structure](#project-structure)
- [Releasing](#releasing)
- [Security and privacy](#security-and-privacy)
- [License](#license)

---

## Features

| Feature | What it does |
|---|---|
| **Real channels** | Each channel has its own number, name, colour and schedule. Create as many as you want. |
| **Daily / weekly / monthly schedules** | One or more time slots per channel, with repeat rules and start/end dates. |
| **Complete episodes only** | An episode starts only if it can finish inside its slot. Commercials come **after** the episode, never in the middle. |
| **Deterministic playback** | The same channel and time always give the same programme. **RESHUFFLE** picks a new starting point. |
| **Sequential or random** | Continue a series in order, pick a random episode every airing, or loop a local folder. |
| **Commercial breaks** | Paste YouTube links; their duration is detected. Ads are shuffled after each episode up to the break length you choose. Muted, no captions. |
| **TV guide** | Press `G` for a Teletext-style grid with now/next information. Click a programme to tune in. |
| **Channel watermarks** | Upload a PNG/JPG/WEBP/GIF per channel; choose size, position, opacity and margin. Also used as the addon poster. |
| **Downloaded / offline mode** | Point RetroTV at folders of local videos. A Downloaded channel loops them with no internet and no ads. |
| **Video language** | Search metadata and streams in Italian, English, Japanese, Spanish, French, German or Portuguese — independently of the interface language. |
| **Forced audio track** | If a file has several audio tracks, RetroTV can remux it on the fly with ffmpeg and serve the selected language first — the same result as Nuvio's audio-track button. |
| **LAN mode** | One launcher for phones, tablets and TVs on your home network. |
| **In-app updates** | RetroTV checks GitHub Releases, shows a banner and updates itself with one button. Your `data/` folder is never touched. |
| **Backup / restore** | Export channels, settings, metadata and up to a year of schedule to a single JSON file. |
| **Stremio / Nuvio addon** | Your channels appear in the TV catalog, each with an “Open the vintage TV” link and the programme currently on air. |
| **CRT feel** | Scanlines, vignette, flicker, TV-static sound and a tuning blur/fade. Every effect can be turned off. |

---

## Requirements

- **[Node.js](https://nodejs.org) LTS, version 18 or newer** (Node 20/22/24 recommended).
- A **Chromium-based browser** for the web TV: Chrome, Edge, Brave, Opera, Vivaldi or Chromium.
- Optional: **Stremio** or **Nuvio** if you want the addon on a TV.
- Optional: a configured **stream addon** (for example Torrentio with your debrid service) for
  online channels. Metadata comes from Cinemeta by default.
- Optional: **ffmpeg** and **ffprobe** in `PATH` to force a specific audio track inside multi-audio
  files and to remux AC3/EAC3/DTS audio to AAC.

> **Firefox is not supported.** The web TV relies on HLS playback and other Chromium features and
> is only tested on Chromium-based browsers. See [Known issues](#known-issues).

---

## Installation

RetroTV is distributed as source code. There is nothing to build and no `npm install` step.

### Option A — download a release (recommended for normal use)

1. Open the [Releases page](https://github.com/Luke133yt/RetroTV/releases).
2. Download the latest `retrotv-<version>.zip` (or `.tar.gz`) and extract it anywhere.
3. Run the launcher for your system (see [Quick start](#quick-start)).
4. Updates are handled by the in-app updater.

### Option B — clone the repository (recommended for development)

```bash
git clone https://github.com/Luke133yt/RetroTV.git
cd RetroTV
node server.js
```

A git clone is updated with `git fetch` + `git reset --hard` by the in-app updater, so keep your
own changes in a branch or commit them: the updater refuses to overwrite tracked local changes.

### Option C — use GitHub Desktop

`File → Clone repository → URL` and paste `https://github.com/Luke133yt/RetroTV.git`. Then start
`RetroTV.bat` / `RetroTV.command` / `RetroTV.sh` from the cloned folder.

---

## Quick start

1. Install Node.js once.
2. Double-click the launcher for your system:

   | System | Normal mode | LAN mode |
   |---|---|---|
   | Windows | `RetroTV.bat` | `RetroTV-Server.bat` |
   | macOS | `RetroTV.command` | `RetroTV-Server.command` |
   | Linux | `RetroTV.sh` | `RetroTV-Server.sh` |

3. The browser opens `http://127.0.0.1:7777`. Keep the launch window open while RetroTV runs.

On macOS/Linux, if a launcher does not start, make it executable:

```bash
chmod +x RetroTV.command RetroTV.sh RetroTV-Server.command RetroTV-Server.sh
```

Or start it manually:

```bash
node server.js
```

Stop it with `Ctrl+C` in the terminal window (or close the TV with the power button first).

### LAN mode (phones and TVs)

Normal mode listens only on `127.0.0.1`, so other devices cannot connect. LAN mode listens on all
interfaces and prints the addresses to use:

```bash
# Windows (cmd)
set RETROTV_HOST=0.0.0.0
node server.js

# macOS / Linux
RETROTV_HOST=0.0.0.0 node server.js
```

Open **MENU → ADDON** to copy the LAN manifest address, for example
`http://192.168.1.20:7777/manifest.json`. On Windows, allow Node.js through the firewall on
**private networks** when asked.

> RetroTV has no password. Keep LAN mode on your home network and never expose the port to the
> internet.

---

## First setup (about 5 minutes)

1. Turn the TV on (⏻) and press **MENU** (or `M`).
2. **SOURCES** — choose the **video language** (English, Italiano, 日本語, Español, Français,
   Deutsch, Português) and paste the manifest URL (`…/manifest.json`) of the stream addon you use in
   Stremio/Nuvio, for example Torrentio configured with your debrid service. Press
   **CHECK SOURCES**. Episode lists come from Cinemeta, which is preconfigured.
3. **CHANNELS → + NEW CHANNEL**. Search for a title (for example “Dragon Ball”), choose a time slot
   (for example 20:00–23:00) and a playback mode. Save.
4. Add **commercials**: paste YouTube links one at a time; their duration is read automatically.
   After each complete episode, ads are queued until the chosen break length is reached.
5. In **LIBRARY**, optionally add the folders where your downloaded videos live and press
   **SAVE AND SCAN**. Then press **CREATE A DOWNLOADED CHANNEL** for an offline channel.
6. In **OPTIONS**, choose the **interface language** and turn the CRT effects on/off.
7. Press **SAVE ALL**.

The settings are stored in `data/config.json` and are read again on the next start.

---

## Updates

RetroTV 2.1.0 and newer check the latest **GitHub Release** when the page loads and when you press
**OPTIONS → CHECK FOR UPDATES**.

- If a newer version exists, a green **UPDATE AVAILABLE** banner appears at the bottom-left.
- **UPDATE NOW** downloads and installs the release, restarts the server and reloads the page.
- **LATER** hides the banner for the current browser session. The next launch checks again.

How the update is applied:

| Installation type | Method |
|---|---|
| Git clone (`.git` folder present) | `git fetch` of the release tag + `git reset --hard` (refused if tracked files have local edits) |
| Zip/tarball download (no `.git`) | Downloads the release `retrotv-<version>.tar.gz`, validates it and copies the source over the app |
| Started with a launcher | Exits with code `75`; the launcher loops and starts the new version in the same window |
| Started with `node server.js` | Relaunches itself as a background process on the same port |

**Your `data/` folder is never overwritten or deleted**, so channels, settings, keys, logos and
library folders survive the update. `node_modules` and `.git` are also left alone.

Update-related environment variables:

| Variable | Meaning |
|---|---|
| `RETROTV_UPDATE_DISABLE=1` | Disable update checks completely (useful for offline/kiosk setups). |
| `RETROTV_UPDATE_REPO=owner/repo` | Check a fork instead of `Luke133yt/RetroTV`. |
| `RETROTV_UPDATE_API=https://api.github.com` | Use a GitHub Enterprise or mirror API. |
| `RETROTV_UPDATE_TIMEOUT=20000` | Network timeout in milliseconds. |

If automatic restart fails, the banner tells you to close the window, start RetroTV again and
reload the page. The new files are already installed.

---

## Channels and scheduling

Each channel has one of three playback modes:

- **Sequential** — programmes start in their time slot, from a chosen episode, then continue in
  chronological order. The next day they resume from the following episode.
- **Random** — programmes still respect the time slot, but every airing picks a random episode.
  The result is deterministic: the same channel and time always give the same schedule.
- **Downloaded** — ignores slots and ads and loops the local library continuously. This channel
  works without internet.

Schedules can repeat **every day**, on selected **weekdays**, or on selected **days of the month**.
A channel can contain several slots (morning cartoons, evening films, and so on). You can limit
seasons (for example `1-3`) or force a different episode length.

### Complete episodes, no holes

Every episode always plays to the end. RetroTV only starts an episode if it can finish inside the
remaining slot time, so a one-hour slot with 25-minute episodes airs two complete episodes (plus
their commercial breaks) and then moves on.

- Commercials always come **after** a complete episode; they are never inserted in the middle.
- Leftover airtime up to **30 minutes** is filled with more commercials, so playback does not drop
  to an off-air screen between two programmes. Longer gaps stay off-air instead of looping a
  single spot for hours.
- If slots overlap, the programme that **started most recently** takes over; older long slots
  resume later in the gaps.
- Slots that **start at the same time** share their block in list order instead of starving each
  other.
- If a series reports an implausible runtime under 5 minutes, RetroTV uses the 24-minute default
  unless you set an explicit episode length for that slot.

**RESHUFFLE** picks a new starting episode. The schedule is deterministic, so without reshuffling
the same channel and time always produce the same programme.

---

## Video language and audio tracks

The **interface language** and the **video language** are independent:

- **OPTIONS → Language** changes only the menus and messages. English is the default; English and
  Italian are complete, Spanish/French/German/Portuguese are partial and fall back to English.
- **SOURCES → Video language** controls metadata, stream preferences and audio. It does not change
  the interface.

The video language affects three things at once:

1. The suggested metadata addon and the `Accept-Language` / `?lang=` parameters sent to addons.
2. The preferred **Torrentio** language filter (for example
   `https://torrentio.strem.fun/language=japanese/manifest.json`). It is applied only when the
   current stream addons are still the plain language defaults — custom addons with your debrid
   key are never overwritten.
3. The audio track played inside multi-audio files.

Releases whose title or flags carry the selected language are scored above prettier ones, so
choosing Italian prefers `ITA`, `🇮🇹` or `Italian` releases even if a 4K English version exists.

### Forcing the audio track

Players such as Nuvio sometimes ignore their own preferred-audio setting and start from the first
track. An addon cannot press the player's audio button, so RetroTV does the equivalent on the
server:

- With **SOURCES → Force the audio track in this language** enabled, RetroTV inspects the file with
  `ffprobe`.
- If the wanted language exists but is not the first audio track, RetroTV remuxes on your computer
  and serves a single-audio **HLS** stream: video is copied, and AC3/EAC3/DTS audio is converted to
  AAC when needed.
- The web TV plays it with the bundled `hls.js`; Stremio/Nuvio receive the HLS URL directly.
- If the selected language is missing, already the first track, or `ffmpeg` is not available, the
  original stream is used unchanged, so playback keeps working.

The first switch may take a few seconds while ffmpeg produces the first segment. Sessions are
reused and cleaned up automatically; a small pool prevents many channels from spawning an
unbounded number of ffmpeg processes.

> Cinemeta does not currently honour a language parameter; titles and descriptions may stay in the
> language provided by the addon. The Torrentio language filter does work for streams.

---

## Commercials

- Commercials are **YouTube links** added per channel. RetroTV reads their duration automatically
  (and lets you correct it).
- After each complete episode, ads are shuffled until the configured break length is reached.
- Commercials always play **muted** and with **captions disabled**, even when normal YouTube would
  show subtitles. RetroTV sets `cc_load_policy: 0`, unloads the captions module and repeats the
  command on every player state change.
- Some videos forbid embedding and will not play: replace them.
- The Downloaded channel has no commercials.

---

## Channel watermarks

In **CHANNELS → WATERMARK / CHANNEL LOGO**:

- Upload a PNG, JPG, WEBP or GIF (max 1.5 MB in the browser).
- Set **size** (percentage of screen width), **position** (9 anchors), **opacity** and **margin**.
- The default is bottom-right, about 13% wide, 90% opacity, with a small margin.
- **REMOVE LOGO** restores the generated channel card.

The uploaded image is stored inside `data/config.json` as a base64 data URL. It is used as the
on-screen watermark and as the channel poster in Stremio/Nuvio. Without a logo, RetroTV generates
an SVG channel card automatically.

Watermarks can be hidden globally in **OPTIONS → Show channel watermarks**.

---

## Downloaded / offline library

RetroTV can play files that already exist on your computer, even without internet.

1. Open **LIBRARY**.
2. Enter one folder per line, for example:

   ```text
   C:\Users\You\Videos\Downloads
   /storage/emulated/0/Download/Nuvio
   ```

3. Set the **length used when a file duration cannot be read** (default 45 minutes).
4. Press **SAVE AND SCAN**.
5. Press **CREATE A DOWNLOADED CHANNEL** (or change an existing channel's mode to **Downloaded**).

Files are scanned recursively (up to 8 levels), in natural alphabetical order, and loop forever.
Supported extensions include MP4, M4V, MOV, MKV, WEBM, AVI, TS, M2TS, MPG, MPEG, WMV, FLV and OGV.
Duration is read from MP4/MKV/WebM files when possible; otherwise the fallback length is used.

The Downloaded channel has **no commercials** and serves files from `/media/<id>` with HTTP Range
support, so seeking works in the browser and in players that support it. Local playback still
depends on the browser codecs: MP4/H.264 + AAC is the safest choice; see
[Known issues](#known-issues).

---

## Stremio / Nuvio addon

1. Open **ADDON**.
2. Copy the manifest address, or press **INSTALL IN STREMIO**.
3. In **Nuvio**: Settings → Addons → add addon → paste the address.
4. Your channels appear in the **TV** catalog.

Each channel exposes:

- **📺 Open the vintage TV** — opens the web page with guide and commercials.
- **▶ On air** — the current programme from the beginning, without commercials. For a Downloaded
  channel this is a direct local media URL.

The addon uses the standard Stremio protocol (`tv` type, `retrotv:` id prefix), so it works in
both Stremio and Nuvio. On a TV, use the LAN manifest address, not `127.0.0.1`.

| Endpoint | Purpose |
|---|---|
| `/manifest.json` | Addon manifest |
| `/catalog/tv/retrotv.json` | Channel catalog |
| `/meta/tv/retrotv:<id>.json` | Channel details and now/next |
| `/stream/tv/retrotv:<id>.json` | “Open the TV” and current programme |

---

## Controls

| Key | Action |
|---|---|
| ↑ / ↓ | next / previous channel |
| `0`–`9` | type a channel number |
| `G` | TV guide (click a programme to tune in) |
| ← / → | volume |
| `F` or double-click | fullscreen |
| `M` | settings menu |
| `P` | power on/off |
| `C` | toggle the CRT effect |
| `X` | mute |

The mouse wheel changes the volume while the TV is on. The virtual panel has the same controls:
channel knob, guide, menu, mute, fullscreen and power.

---

## Data, backup and configuration

Persistent files live in `data/`:

| File | Contents |
|---|---|
| `data/config.json` | Channels, schedules, settings, sources, library folders and uploaded logos. |
| `data/meta.json` | Cached series/movie metadata. |
| `data/library-cache.json` | Cached local file durations. |

**BACKUP** exports a JSON file containing channels, options, metadata and the schedule for the
next 7, 30, 90 or 365 days. Importing it on another computer restores everything. The export can
contain debrid keys embedded in addon URLs: **do not share it**.

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `RETROTV_PORT` (or `PORT`) | `7777` | HTTP port. |
| `RETROTV_HOST` | `127.0.0.1` | Listen address. Use `0.0.0.0` for LAN mode. |
| `RETROTV_DATA` | `./data` | Folder for config, metadata and cache. |
| `RETROTV_UPDATE_DISABLE` | — | Set to `1` to disable update checks. |
| `RETROTV_UPDATE_REPO` | `Luke133yt/RetroTV` | Repository used for releases. |
| `RETROTV_UPDATE_API` | `https://api.github.com` | GitHub API base URL. |
| `RETROTV_LAUNCHER` | — | Set by the launchers; enables restart-in-place after an update. |

---

## Known issues

### Browsers

- **Mozilla Firefox is not supported.** The web TV relies on HLS playback (`hls.js`) and other
  Chromium behaviour and has not been adapted or tested for Firefox. Use a Chromium-based browser.
- **All Chromium-based browsers are supported**: Google Chrome, Microsoft Edge, Brave, Opera,
  Vivaldi and Chromium itself.
- **Safari is not officially supported.** Native HLS may work in some cases, but it is not tested.
- Mobile browsers on Android that are Chromium-based generally work; iOS browsers all use WebKit
  and are not supported.

### Codecs

- **Not all codecs are supported.** Playback depends on the browser and on the file container:
  - Safe: **MP4 / H.264 / AAC**.
  - Often works: WebM / VP8-VP9 / Opus, H.264 inside MKV (browser-dependent).
  - May fail: **HEVC/H.265**, AV1 in some containers, AC3/EAC3/DTS audio, some 10-bit or exotic
    profiles, and files with broken indexes.
  - RetroTV scores streams to prefer MP4/H.264, but it cannot add codecs to the browser.
- The forced-audio HLS remux copies the video track unchanged. If the browser cannot decode the
  video codec, turning off **SOURCES → Force the audio track** is the only workaround (the
  original stream still needs a supported codec).
- AC3/EAC3/DTS audio is converted to AAC during the forced-audio remux, but only when ffmpeg is
  installed.

### Other limitations

- Some YouTube videos forbid embedding and will not play as commercials.
- Torrents without debrid require the Stremio server on port `11470`; debrid is much more reliable.
- RetroTV schedules continue in real time even while the TV or computer is off. When you turn it
  back on, you land in the middle of the correct programme.
- Uploaded logos are stored inside `data/config.json`; very large images make the config bigger.
- LAN mode has no authentication. Keep it on your home network.
- A browser tab can stay suspended in the background; the schedule is still correct when it wakes,
  because playback is based on the wall clock.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **Port already in use** | RetroTV is probably already running: open `http://127.0.0.1:7777`, or set another port with `RETROTV_PORT=8080`. |
| **Page blank / interface broken** | Use Chrome, Edge, Brave, Opera, Vivaldi or Chromium. Firefox is not supported. |
| **No streams found** | Check **SOURCES → CHECK SOURCES** and make sure your stream addon works in Stremio/Nuvio. |
| **No sound when powering on** | Browsers block audio until you click or press a key. |
| **Nothing in Downloaded** | Check the folder path, make sure it contains supported video files, then press **SAVE AND SCAN** again. |
| **Phone/TV cannot connect** | Start with `RetroTV-Server.bat` (or `RETROTV_HOST=0.0.0.0`), allow Node.js on private networks, and use the LAN address shown in **ADDON**. |
| **Channel logo not showing** | Upload a PNG/JPG/WEBP/GIF under 1.5 MB and enable **OPTIONS → Show channel watermarks**. |
| **Audio stays in the wrong language** | Check **SOURCES → Video language** and keep **Force the audio track** enabled; install `ffmpeg`/`ffprobe` in `PATH`. If the release has only one audio track, another release must be chosen. |
| **Update banner never appears** | The repository must have a published GitHub Release newer than the installed version. Check `RETROTV_UPDATE_DISABLE` is not set and press **OPTIONS → CHECK FOR UPDATES**. |
| **Update fails on a git clone** | Commit or discard tracked local changes, then retry; the updater refuses to overwrite them. |
| **“This browser cannot play this file (codec?)”** | The file uses a codec the browser does not decode. Prefer MP4/H.264/AAC, or turn off forced audio if the audio track caused the remux. |

---

## Development and tests

The project has no build step and no npm dependencies.

```bash
node server.js      # start the server
node test/run.js    # end-to-end tests with mock Stremio and GitHub APIs
```

The test suite covers:

- schedules, determinism, sequential/random modes, overlap handling and complete-episode rules;
- ads after episodes and the 30-minute filler cap;
- language persistence and source-language independence;
- language-aware stream scoring;
- backup/import and path-traversal protection;
- logo upload and serving;
- local media Range requests and the Downloaded channel;
- addon streams and `/play` redirects;
- the updater: version comparison, safe `.tar.gz` extraction (without touching `data/` or escaping
  the destination), and the `/api/update/check` endpoint;
- a real two-audio MKV remux to HLS, verified with `ffprobe` when ffmpeg is installed.

The tests start their own servers on ports `7791`–`7793` and use a temporary data folder, so they
never touch your real `data/config.json`.

---

## Project structure

```text
RetroTV/
├─ server.js              HTTP server, addon protocol, API, static files
├─ lib/
│  ├─ engine.js           Deterministic schedule generator
│  ├─ store.js            Config schema and JSON persistence
│  ├─ sources.js          Metadata/stream addons, language scoring
│  ├─ languages.js        UI and video language profiles
│  ├─ remux.js            ffprobe/ffmpeg HLS audio-track forcing
│  ├─ library.js          Local video scan and Range streaming
│  └─ updater.js          GitHub release check, download and install
├─ public/
│  ├─ index.html          TV page
│  ├─ style.css           CRT / wooden-cabinet interface
│  ├─ tv.js               Power, tuning, playback, guide, updater UI
│  ├─ menu.js             Channels, sources, library, options, backup
│  ├─ i18n.js             Translations (EN, IT, ES, FR, DE, PT)
│  └─ vendor/hls.min.js   Bundled hls.js 1.5.20
├─ test/run.js            End-to-end tests
├─ data/                  Runtime data (git-ignored, created on first run)
└─ RetroTV*.bat/.sh/.command  Launchers
```

---

## Releasing

1. Update `package.json` — it is the **single source of truth** for the version. `server.js` reads
   it at startup and the addon manifest exposes it.
2. Commit the change and push to `main`.
3. Create and push a tag that matches the version:

   ```bash
   git tag v2.1.1
   git push origin main --tags
   ```

4. The GitHub Actions workflow `.github/workflows/release.yml` checks that the tag matches
   `package.json`, then creates a GitHub Release with:
   - `retrotv-<version>.tar.gz` (source archive with a `RetroTV-<version>/` root),
   - `retrotv-<version>.zip`,
   - `SHA256SUMS.txt`.

5. Running RetroTV installations detect the new release at the next check and offer the one-click
   update.

The workflow needs the default `GITHUB_TOKEN` with `contents: write` permission (already set in the
workflow). No secrets need to be configured.

---

## Security and privacy

- RetroTV runs on your computer and stores everything in `data/`. It sends requests only to the
  metadata/stream addons you configure, to YouTube for commercials, and to `api.github.com` for
  update checks.
- `data/config.json` can contain **debrid API keys** embedded in addon URLs and uploaded logos.
  It is excluded from git by `.gitignore` and must not be shared. Backups can contain those keys
  too.
- LAN mode has no authentication or TLS. Do not port-forward it or expose it to the internet.
- The updater downloads code from the official GitHub repository and applies it. If that is not
  acceptable in your environment, start RetroTV with `RETROTV_UPDATE_DISABLE=1`.

---

## License

[MIT](LICENSE) © 2026 Luke133yt

RetroTV is not affiliated with Stremio, Nuvio, Torrentio, Cinemeta, YouTube or any content
provider. You are responsible for the media you access and for complying with the laws and terms
that apply to you.

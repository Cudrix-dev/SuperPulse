<div align="center">

<img src="assets/icon.png" width="96" alt="SuperPulse icon" />

# SuperPulse

**A modern, Fluent-styled real-time hardware monitor for Windows.**

[![Release (Windows)](https://github.com/Cudrix-dev/SuperPulse/actions/workflows/release-windows.yml/badge.svg)](https://github.com/Cudrix-dev/SuperPulse/actions/workflows/release-windows.yml)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4)
![Electron](https://img.shields.io/badge/Electron-45-47848f)

</div>

---

SuperPulse shows your system's "pulse" at a glance: CPU, memory, GPU,
network, storage and system details, presented in a calm Fluent Design
interface with a glowing live waveform.

## Highlights

- **Fluent Design, the native way.** The dashboard sits on the Windows 11
  **Mica** backdrop and the splash on **Acrylic**, both drawn by the OS
  (not imitated in CSS). On top are layered translucent cards with 12–16 px
  radii, 1 px hairline borders, soft shadows, the Fluent "reveal" light that
  follows your pointer, and native caption buttons (Snap Layouts included).
- **2-second splash.** Frameless, non-resizable and centred on the primary
  monitor, with a precisely timed sequence:

  | Time          | Phase  | What happens                                            |
  | ------------- | ------ | ------------------------------------------------------- |
  | 0 – 500 ms    | Enter  | Window and content fade in with a subtle scale/slide-up |
  | 500 – 1600 ms | Pulse  | The emblem's glow beats twice, with ripples             |
  | 1600 – 2000 ms | Exit  | Splash fades out while the dashboard fades in           |

- **Live telemetry, refreshed every second.** CPU load (overall and per
  core), memory and page file, GPU utilisation, VRAM, temperature and power
  (NVIDIA via `nvidia-smi`), network throughput, volume usage and uptime.
- **Lightweight.** CPU and network sampling read kernel counters directly.
  Expensive queries run on slower cadences and pause while the window is
  minimised.
- **Secure by default.** Sandboxed renderers, context isolation, a strict
  Content Security Policy, IPC sender validation, and no navigation or
  pop-ups.

## Getting started

Requirements: **Windows 10/11** and **Node.js 20+** (24 LTS recommended).

```bash
git clone https://github.com/Cudrix-dev/SuperPulse.git
cd SuperPulse
npm install
npm start
```

| Script             | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `npm start`        | Run the app                                                     |
| `npm run dev`      | Run with DevTools and log the measured splash timings           |
| `npm run dist`     | Build the NSIS installer, MSI and portable `.exe` into `dist/`  |
| `npm run dist:dir` | Build an unpacked app folder only (fast packaging check)        |
| `npm run icons`    | Regenerate `assets/icon.png` / `icon.ico` from `assets/icon.svg` |

## Downloads & releases

Every build produces three x64 artifacts:

| File                                   | Use                                        |
| -------------------------------------- | ------------------------------------------ |
| `SuperPulse-Setup-<version>-x64.exe`   | Standard installer (per user, choose folder) |
| `SuperPulse-<version>-x64.msi`         | MSI for managed / enterprise deployment    |
| `SuperPulse-Portable-<version>-x64.exe` | Portable, no installation                 |

### CI/CD

[`.github/workflows/release-windows.yml`](.github/workflows/release-windows.yml)
runs on `windows-latest`:

- **Triggers:** pushing a `v*` tag, or running it manually (*Actions → Release (Windows) → Run workflow*).
- **Every run:** installs dependencies with `npm ci`, packages the app and
  uploads the binaries as a workflow artifact (`actions/upload-artifact@v4`).
- **Tag runs:** also create a GitHub Release with auto-generated release
  notes and the binaries attached (`softprops/action-gh-release@v2`). The
  version is taken from the tag, so `v1.2.0` builds `1.2.0`. Tags containing
  a hyphen (`v1.2.0-beta.1`) are marked as pre-releases.

To publish a release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

> The binaries are **not code-signed**, so Windows SmartScreen may warn on
> first launch. To sign them, add a certificate through electron-builder's
> `CSC_LINK` / `CSC_KEY_PASSWORD` secrets and remove
> `CSC_IDENTITY_AUTO_DISCOVERY` from the workflow.

## Project structure

```
SuperPulse/
├─ .github/workflows/release-windows.yml   CI: build, artifact, release
├─ assets/                                 App icon (SVG source + PNG/ICO)
├─ scripts/generate-icons.js               SVG → PNG/ICO rasteriser
├─ src/
│  ├─ main/                                Electron main process
│  │  ├─ main.js                           App lifecycle & start-up orchestration
│  │  ├─ windows.js                        Splash / dashboard window factories, hardening
│  │  ├─ splash-sequence.js                2000 ms timeline & window crossfade
│  │  ├─ ipc.js                            IPC channels (validated senders)
│  │  └─ metrics/                          Hardware telemetry service
│  │     ├─ index.js                       Scheduler & snapshot (systeminformation)
│  │     ├─ cpu-sampler.js                 Per-core load from os.cpus() deltas
│  │     └─ network-sampler.js             Throughput from netstat counters
│  ├─ preload/                             Minimal, isolated renderer bridges
│  └─ renderer/
│     ├─ shared/tokens.css                 Fluent design tokens (type, colour, motion)
│     ├─ splash/                           Splash page (HTML/CSS animation)
│     └─ dashboard/                        Dashboard page & components
│        └─ components/                    Waveform (canvas), RingGauge (SVG)
├─ electron-builder.yml                    Packaging (NSIS, MSI, portable)
└─ package.json
```

## Notes

- **CPU temperature** is usually reported as *N/A*. Windows only exposes it
  (through ACPI thermal zones) to elevated processes on most hardware.
- **GPU utilisation** needs a driver that provides telemetry (NVIDIA through
  `nvidia-smi`). Other adapters still show their model and VRAM.
- **Mica / Acrylic** need Windows 11 22H2 or newer and *Transparency effects*
  turned on in Settings. Otherwise Windows shows the material's solid
  fallback colour, and on Windows 10 SuperPulse paints its own dark surface.

## Credits

Designed and developed by **[Cudrix](https://github.com/Cudrix-dev)**.
Built with [Electron](https://www.electronjs.org/) and
[systeminformation](https://systeminformation.io/).

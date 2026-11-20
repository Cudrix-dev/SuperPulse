/**
 * Renders assets/icon.svg into the raster icons used for packaging:
 *
 *   assets/icon.png  512×512 (README / Linux / fallback)
 *   assets/icon.ico  16, 24, 32, 48, 64, 128, 256 px (Windows exe + installers)
 *
 * Run with Electron so Chromium does the SVG rasterisation:
 *   npm run icons
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ASSETS = path.join(__dirname, '..', 'assets');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Creates a hidden renderer holding the SVG. Returns a function that
 * rasterises it to a PNG buffer at any size, using an in-page <canvas>
 * (deterministic, keeps the alpha channel, independent of display DPI).
 */
async function createRasterizer(svg) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await win.loadURL('data:text/html,<!doctype html><title>icons</title>');

  const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

  const render = async (size) => {
    const dataUrl = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image(${size}, ${size});
      img.src = ${JSON.stringify(svgUrl)};
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = ${size};
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, ${size}, ${size});
      return canvas.toDataURL('image/png');
    })()`);
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  };

  return { render, dispose: () => win.destroy() };
}

/** Packs PNG buffers into a single .ico container (PNG-compressed entries). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, i) => {
    const base = i * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, base); // width (0 = 256)
    directory.writeUInt8(size >= 256 ? 0 : size, base + 1); // height
    directory.writeUInt8(0, base + 2); // palette
    directory.writeUInt8(0, base + 3); // reserved
    directory.writeUInt16LE(1, base + 4); // colour planes
    directory.writeUInt16LE(32, base + 6); // bits per pixel
    directory.writeUInt32LE(png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(path.join(ASSETS, 'icon.svg'), 'utf8');

    const rasterizer = await createRasterizer(svg);

    fs.writeFileSync(path.join(ASSETS, 'icon.png'), await rasterizer.render(512));

    // Every size is rasterised from the vector source for crisp strokes.
    const entries = [];
    for (const size of ICO_SIZES) {
      entries.push({ size, png: await rasterizer.render(size) });
    }
    fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(entries));
    rasterizer.dispose();

    console.log(`Icons written to ${ASSETS}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

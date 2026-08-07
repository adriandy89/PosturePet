'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const { STATE } = require('./policy.js');

/**
 * Icono de bandeja que cambia de color con el estado.
 *
 * Los iconos se dibujan en codigo en vez de cargarse de archivos PNG: son
 * cuatro circulos de colores, y generarlos evita mantener binarios en el repo
 * y que se descuadren con el tema del sistema.
 */

const SIZE = 32; // 16 px logicos a 2x, para que no se vea dentado
const COLORS = {
  good: [76, 175, 80], // verde
  warn: [255, 167, 38], // ambar
  bad: [239, 83, 80], // rojo
  paused: [130, 137, 147], // gris
};

/**
 * Dibuja un circulo relleno con borde suave en un buffer BGRA.
 * Antialiasing por cobertura: la distancia al centro decide el alfa del pixel.
 */
function dot([r, g, b]) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const c = (SIZE - 1) / 2;
  const radius = SIZE * 0.42;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - c, y - c);
      // Franja de 1.2 px donde el alfa cae de 1 a 0: el borde queda liso.
      const alpha = Math.max(0, Math.min(1, (radius - d) / 1.2));
      if (alpha <= 0) continue;

      const i = (y * SIZE + x) * 4;
      const a = Math.round(alpha * 255);
      // Electron espera BGRA premultiplicado por alfa.
      buf[i] = Math.round((b * a) / 255);
      buf[i + 1] = Math.round((g * a) / 255);
      buf[i + 2] = Math.round((r * a) / 255);
      buf[i + 3] = a;
    }
  }

  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE, scaleFactor: 2 });
}

/**
 * Los iconos se generan la primera vez que se piden, no al cargar el modulo.
 * Son cuatro bucles de 32x32 sobre buffers: no hay razon para pagarlos en el
 * require, y asi el modulo se puede importar sin un Electron completo detras.
 */
let ICONS = null;
function icons() {
  ICONS ??= Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, dot(v)]));
  return ICONS;
}

class TrayController {
  #tray = null;
  #current = null;
  #handlers;
  #enabled = true;

  /** @param handlers { onCalibrate, onSettings, onTogglePause, onQuit, isPaused } */
  constructor(handlers) {
    this.#handlers = handlers;
    this.#tray = new Tray(icons().paused);
    this.#tray.setToolTip('PosturePet');
    this.#tray.on('click', () => handlers.onSettings());
    this.#rebuildMenu();
  }

  #rebuildMenu() {
    const paused = this.#handlers.isPaused();
    const { profiles, activeId } = this.#handlers.getProfiles();

    // Cambiar de montaje (mesa, portatil, mesa alta) tiene que costar un clic.
    // Si obligase a abrir ajustes, la gente acabaria usando una base que ya no
    // corresponde a donde esta sentada, que es peor que no tener ninguna.
    const profileItems = profiles.map((p) => ({
      label: p.baseline ? p.name : `${p.name} (sin calibrar)`,
      type: 'radio',
      checked: p.id === activeId,
      click: () => this.#handlers.onSelectProfile(p.id),
    }));

    this.#tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: paused ? 'Reanudar vigilancia' : 'Pausar vigilancia',
          click: () => { this.#handlers.onTogglePause(); this.#rebuildMenu(); } },
        { type: 'separator' },
        { label: 'Perfil', submenu: profileItems },
        { label: 'Calibrar este perfil...', click: () => this.#handlers.onCalibrate() },
        { type: 'separator' },
        { label: 'Ajustes', click: () => this.#handlers.onSettings() },
        { label: 'Salir', click: () => this.#handlers.onQuit() },
      ])
    );
  }

  refreshMenu() {
    this.#rebuildMenu();
  }

  /** El icono de bandeja se puede apagar como cualquier otra superficie. */
  setEnabled(enabled) {
    this.#enabled = enabled;
    this.#current = null; // fuerza el repintado al reactivarse
  }

  update({ state, score, level, manuallyPaused }) {
    if (!this.#tray || this.#tray.isDestroyed()) return;

    let key;
    if (manuallyPaused || state === STATE.PAUSED) key = 'paused';
    else if (!this.#enabled) key = 'good'; // desactivado: icono neutro, sin senalar
    else if (state === STATE.BAD) key = level >= 3 ? 'bad' : 'warn';
    else key = 'good';

    if (key !== this.#current) {
      this.#tray.setImage(icons()[key]);
      this.#current = key;
    }

    let tip = 'PosturePet';
    if (manuallyPaused) tip += ' - en pausa';
    else if (state === STATE.PAUSED) tip += ' - nadie delante';
    else if (score !== null && score !== undefined) tip += ` - postura ${score}/100`;
    this.#tray.setToolTip(tip);
  }

  destroy() {
    if (this.#tray && !this.#tray.isDestroyed()) this.#tray.destroy();
    this.#tray = null;
  }
}

module.exports = { TrayController };

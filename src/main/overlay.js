'use strict';

const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
const appProtocol = require('./protocol.js');

/**
 * La capa oscurecedora -- el truco de Slouch Sniper.
 *
 * Un velo negro semitransparente se funde encima de todo cuando llevas rato
 * encorvado y se desvanece en cuanto te enderezas. A diferencia de un toast,
 * no se puede ignorar; a diferencia de una alarma, no interrumpe lo que estas
 * haciendo.
 *
 * Tres propiedades lo hacen inofensivo:
 *   - setIgnoreMouseEvents -> los clics atraviesan la capa
 *   - focusable: false     -> nunca roba el foco del teclado
 *   - una ventana por monitor -> en varias pantallas no se oscurece solo una
 *
 * El fundido lo hace CSS dentro de la pagina, no setOpacity() de la ventana:
 * combinar opacidad nativa con `transparent: true` da parpadeos en Windows.
 */
class DimOverlay {
  #windows = [];
  #visible = false;
  #opacity = 0.35;

  create() {
    this.destroy();
    this.#windows = screen.getAllDisplays().map((display) => {
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        hasShadow: false,
        enableLargerThanScreen: true,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, '..', 'preload', 'overlay.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      // 'screen-saver' es el nivel mas alto: queda por encima incluso de otras
      // ventanas always-on-top, que es justo lo que hace falta aqui.
      win.setAlwaysOnTop(true, 'screen-saver');
      // `forward: true` mantiene el seguimiento del raton para el hover del SO
      // mientras deja pasar los clics.
      win.setIgnoreMouseEvents(true, { forward: true });
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.loadURL(appProtocol.url('src/renderer/overlay.html'));
      return win;
    });

    // Si cambias de monitor o de resolucion hay que rehacerlas.
    screen.removeAllListeners('display-metrics-changed');
    screen.on('display-added', () => this.#rebuild());
    screen.on('display-removed', () => this.#rebuild());
    screen.on('display-metrics-changed', () => this.#rebuild());
  }

  #rebuild() {
    const wasVisible = this.#visible;
    this.create();
    if (wasVisible) this.show();
  }

  setOpacity(value) {
    this.#opacity = Math.max(0, Math.min(0.8, value));
    if (this.#visible) this.show();
  }

  show() {
    this.#visible = true;
    for (const win of this.#windows) {
      if (win.isDestroyed()) continue;
      // showInactive, nunca show(): show() daria el foco a un velo invisible.
      if (!win.isVisible()) win.showInactive();
      this.#send(win, this.#opacity);
    }
  }

  hide() {
    if (!this.#visible) return;
    this.#visible = false;
    for (const win of this.#windows) {
      if (win.isDestroyed()) continue;
      this.#send(win, 0);
      // Se oculta de verdad al terminar el fundido, no antes.
      setTimeout(() => {
        if (!win.isDestroyed() && !this.#visible) win.hide();
      }, 450);
    }
  }

  #send(win, opacity) {
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed()) win.webContents.send('dim:set', opacity);
      });
    } else {
      win.webContents.send('dim:set', opacity);
    }
  }

  destroy() {
    for (const win of this.#windows) {
      if (!win.isDestroyed()) {
        win.setClosable(true);
        win.destroy();
      }
    }
    this.#windows = [];
    this.#visible = false;
  }
}

module.exports = { DimOverlay };

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
 *
 * LAS VENTANAS NO EXISTEN HASTA QUE HACEN FALTA
 *
 * Son ventanas a pantalla completa, transparentes y always-on-top: dos de
 * ellas costaban 132 MB en dos procesos de renderizado, permanentes, para algo
 * que en una sesion con buena postura no se ve ni una vez. Se crean en el
 * primer show() y se sueltan enteras tras un rato sin usarse. El velo tarda
 * 1,1 s en fundirse, asi que los ~200 ms de crear la ventana caben dentro del
 * fundido y no se notan.
 */

/**
 * Cuanto se conservan las ventanas ya ocultas antes de soltarlas.
 *
 * No se destruyen al acabar el fundido: los episodios de mala postura vienen
 * en rachas, y crear las ventanas en cada uno seria pagar el arranque una y
 * otra vez. Un minuto cubre la racha entera y libera la memoria en cuanto la
 * sesion se estabiliza.
 */
const RELEASE_AFTER_HIDDEN_MS = 60_000;

/**
 * Windows emite los eventos de pantalla en rafagas -- girar un monitor manda
 * varios display-metrics-changed seguidos. Sin este margen se reconstruiria la
 * capa una vez por evento en vez de una vez por cambio.
 */
const REBUILD_DEBOUNCE_MS = 400;

class DimOverlay {
  #windows = [];
  #visible = false;
  #opacity = 0.35;
  #fadeInMs = 1_100;
  #fadeOutMs = 350;

  /** Firma de la disposicion de pantallas con la que se crearon las ventanas. */
  #layout = null;

  #onDisplayChange = null;
  #rebuildTimer = null;
  #hideTimer = null;
  #releaseTimer = null;

  /** Ventanas con un revelado en cola esperando a que cargue su pagina. */
  #pending = new WeakSet();
  /** Ultima opacidad enviada a cada ventana, para no repetir el IPC a 4 Hz. */
  #sent = new WeakMap();
  /** Mensajes en espera de que la pagina de cada ventana termine de cargar. */
  #queued = new WeakMap();

  /**
   * Empieza a vigilar las pantallas. NO crea ninguna ventana: de eso se encarga
   * el primer show().
   *
   * Los listeners se registran AQUI y una sola vez, no dentro de la creacion de
   * las ventanas. Cuando vivian ahi, cada reconstruccion volvia a registrar los
   * tres pero solo desregistraba `display-metrics-changed`: los otros dos se
   * acumulaban, asi que cada suspension de monitor -- que manda el par
   * display-removed + display-added -- cuadruplicaba el numero de listeners.
   * Al septimo ciclo el proceso principal se quedaba minutos bloqueado
   * reconstruyendo la capa miles de veces, con picos de 87 procesos y varios GB.
   */
  start() {
    if (this.#onDisplayChange) return;

    this.#onDisplayChange = () => {
      clearTimeout(this.#rebuildTimer);
      this.#rebuildTimer = setTimeout(() => this.#rebuild(), REBUILD_DEBOUNCE_MS);
    };

    screen.on('display-added', this.#onDisplayChange);
    screen.on('display-removed', this.#onDisplayChange);
    screen.on('display-metrics-changed', this.#onDisplayChange);
  }

  /**
   * Identifica la disposicion de pantallas por lo unico que le importa a la
   * capa: cuantas hay y que area cubre cada una.
   *
   * Sirve para no rehacer nada cuando el evento no cambia eso -- cambiar de HDR
   * o mover la barra de tareas emite display-metrics-changed igualmente.
   */
  #layoutSignature() {
    return screen
      .getAllDisplays()
      .map((d) => `${d.id}:${d.bounds.x},${d.bounds.y},${d.bounds.width},${d.bounds.height}`)
      .join('|');
  }

  #rebuild() {
    this.#rebuildTimer = null;
    // Sin ventanas creadas no hay nada que rehacer: las siguientes nacerán ya
    // con la disposicion nueva.
    if (!this.#windows.length) return;
    if (this.#layoutSignature() === this.#layout) return;

    const wasVisible = this.#visible;
    this.#releaseWindows();
    if (wasVisible) this.show();
  }

  #ensureWindows() {
    if (this.#windows.length) return;

    this.#layout = this.#layoutSignature();
    this.#windows = screen.getAllDisplays().map((display) => {
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false,
        transparent: true,
        // Sin fondo explicito, una ventana transparente puede ensenar un
        // destello blanco entre que se muestra y que la pagina pinta. Antes
        // solo ocurria al arrancar; ahora que se crean en cada racha, se veria.
        backgroundColor: '#00000000',
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
      this.#sendFades(win);
      return win;
    });
  }

  setOpacity(value) {
    this.#opacity = Math.max(0, Math.min(0.8, value));
    if (this.#visible) this.show();
  }

  /** Duracion de los dos fundidos. Se aplica como variables CSS en la pagina. */
  setFades({ inMs, outMs }) {
    if (Number.isFinite(inMs)) this.#fadeInMs = inMs;
    if (Number.isFinite(outMs)) this.#fadeOutMs = outMs;
    for (const win of this.#windows) {
      if (!win.isDestroyed()) this.#sendFades(win);
    }
  }

  #sendFades(win) {
    this.#deliver(win, 'dim:fade', { inMs: this.#fadeInMs, outMs: this.#fadeOutMs });
  }

  show() {
    clearTimeout(this.#hideTimer);
    clearTimeout(this.#releaseTimer);
    this.#hideTimer = null;
    this.#releaseTimer = null;

    this.#visible = true;
    this.#ensureWindows();
    for (const win of this.#windows) {
      if (!win.isDestroyed()) this.#reveal(win);
    }
  }

  /**
   * Muestra una ventana y le manda la opacidad, esperando a que su pagina haya
   * cargado si acaba de nacer.
   *
   * show() llega a 4 Hz mientras la capa esta puesta, asi que el revelado se
   * encola una sola vez por ventana y la opacidad solo se reenvia cuando de
   * verdad cambia: si no, serian cuatro mensajes de IPC por segundo y por
   * monitor para repetir el mismo numero.
   */
  #reveal(win) {
    if (this.#pending.has(win)) return;

    const paint = () => {
      this.#pending.delete(win);
      if (win.isDestroyed() || !this.#visible) return;
      // showInactive, nunca show(): show() daria el foco a un velo invisible.
      if (!win.isVisible()) win.showInactive();
      this.#send(win, this.#opacity);
    };

    if (win.webContents.isLoading()) {
      this.#pending.add(win);
      win.webContents.once('did-finish-load', paint);
    } else {
      paint();
    }
  }

  hide() {
    if (!this.#visible) return;
    this.#visible = false;

    for (const win of this.#windows) {
      if (!win.isDestroyed()) this.#send(win, 0);
    }

    // Se oculta de verdad al terminar el fundido, no antes. El margen extra
    // absorbe el desfase entre el reloj de CSS y el del proceso principal:
    // ocultar un frame antes de tiempo produce un corte visible.
    clearTimeout(this.#hideTimer);
    this.#hideTimer = setTimeout(() => {
      this.#hideTimer = null;
      if (this.#visible) return;
      for (const win of this.#windows) {
        if (!win.isDestroyed()) win.hide();
      }
    }, this.#fadeOutMs + 100);

    // Y mas tarde, si sigue sin hacer falta, se sueltan las ventanas enteras.
    clearTimeout(this.#releaseTimer);
    this.#releaseTimer = setTimeout(() => {
      this.#releaseTimer = null;
      if (!this.#visible) this.#releaseWindows();
    }, RELEASE_AFTER_HIDDEN_MS);
  }

  #send(win, opacity) {
    if (this.#sent.get(win) === opacity) return;
    this.#sent.set(win, opacity);
    this.#deliver(win, 'dim:set', opacity);
  }

  /**
   * Espera a que la pagina cargue: un send() a medias se pierde sin avisar.
   *
   * Mientras carga se guarda SOLO el ultimo valor de cada canal y se espera una
   * unica vez. Registrar un `once` por llamada acumulaba un listener por cada
   * cambio de ajustes que cayera dentro de esos milisegundos -- y setFades()
   * llega con cada tecleo en los deslizadores de fundido.
   */
  #deliver(win, channel, payload) {
    if (!win.webContents.isLoading()) {
      win.webContents.send(channel, payload);
      return;
    }

    let cola = this.#queued.get(win);
    if (!cola) {
      cola = new Map();
      this.#queued.set(win, cola);
      win.webContents.once('did-finish-load', () => {
        const pendiente = this.#queued.get(win);
        this.#queued.delete(win);
        if (win.isDestroyed() || !pendiente) return;
        for (const [ch, valor] of pendiente) win.webContents.send(ch, valor);
      });
    }
    cola.set(channel, payload);
  }

  /** Suelta las ventanas pero sigue vigilando las pantallas. */
  #releaseWindows() {
    for (const win of this.#windows) {
      if (!win.isDestroyed()) {
        win.setClosable(true);
        win.destroy();
      }
    }
    this.#windows = [];
    this.#layout = null;
  }

  /** Apagado definitivo: ventanas y listeners. Se llama al salir de la app. */
  destroy() {
    clearTimeout(this.#rebuildTimer);
    clearTimeout(this.#hideTimer);
    clearTimeout(this.#releaseTimer);
    this.#rebuildTimer = null;
    this.#hideTimer = null;
    this.#releaseTimer = null;

    if (this.#onDisplayChange) {
      screen.off('display-added', this.#onDisplayChange);
      screen.off('display-removed', this.#onDisplayChange);
      screen.off('display-metrics-changed', this.#onDisplayChange);
      this.#onDisplayChange = null;
    }

    this.#releaseWindows();
    this.#visible = false;
  }
}

module.exports = { DimOverlay, RELEASE_AFTER_HIDDEN_MS, REBUILD_DEBOUNCE_MS };

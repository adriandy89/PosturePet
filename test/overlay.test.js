'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

/**
 * La capa oscurecedora, con un Electron de mentira.
 *
 * Este archivo existe por un fallo concreto que costo caro. Los listeners de
 * `screen` vivian dentro del metodo que crea las ventanas, y ese metodo se
 * llama justamente desde el listener: cada reconstruccion registraba los tres
 * eventos otra vez pero solo desregistraba uno. `display-added` y
 * `display-removed` se acumulaban, y como Windows manda los dos juntos al
 * dormir y despertar un monitor, el numero de listeners se CUADRUPLICABA en
 * cada ciclo. Al septimo el proceso principal se quedaba minutos bloqueado
 * reconstruyendo la capa miles de veces: 87 procesos y varios GB de memoria.
 *
 * No fallaba nada, no habia excepcion ni aviso en consola. Solo la app comiendo
 * el equipo despues de horas encendida -- y por eso hace falta un test y no un
 * comentario.
 *
 * Se sustituye `electron` en la cache de modulos antes de cargar overlay.js:
 * asi se puede medir el numero de listeners y de ventanas sin abrir nada.
 */

// -------------------------------------------------------- electron de mentira

const fakeScreen = new EventEmitter();
// Sin limite: el punto del test es contar listeners, y el aviso de fuga de Node
// a los 11 ensuciaria la salida justo cuando el fallo esta presente.
fakeScreen.setMaxListeners(0);

let displays = [
  { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
  { id: 2, bounds: { x: 3840, y: 116, width: 1080, height: 1920 } },
];
fakeScreen.getAllDisplays = () => displays;
fakeScreen.getPrimaryDisplay = () => displays[0];

let creadas = 0;
let vivas = 0;
/** Las ventanas creadas, en orden, para poder mirar lo que se les mando. */
const ventanas = [];

class FakeBrowserWindow {
  constructor() {
    creadas++;
    vivas++;
    ventanas.push(this);
    this.destroyed = false;
    this.visible = false;
    this.sent = [];
    const self = this;
    this.webContents = {
      loading: true,
      isLoading: () => self.webContents.loading,
      once: (_evt, fn) => self.webContents.pending.push(fn),
      send: (channel, payload) => self.sent.push([channel, payload]),
      pending: [],
    };
  }
  /** Simula que la pagina termino de cargar. */
  finishLoad() {
    this.webContents.loading = false;
    const cola = this.webContents.pending;
    this.webContents.pending = [];
    for (const fn of cola) fn();
  }
  setAlwaysOnTop() {}
  setIgnoreMouseEvents() {}
  setVisibleOnAllWorkspaces() {}
  setClosable() {}
  loadURL() {}
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; }
  destroy() {
    if (!this.destroyed) vivas--;
    this.destroyed = true;
  }
}

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    screen: fakeScreen,
    BrowserWindow: FakeBrowserWindow,
    // protocol.js los desestructura al cargarse; aqui no se usan.
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    net: {},
  },
};

const { DimOverlay, REBUILD_DEBOUNCE_MS } = require('../src/main/overlay.js');

// ------------------------------------------------------------------ utilidades

const CANALES = ['display-added', 'display-removed', 'display-metrics-changed'];
const listeners = () => CANALES.map((c) => fakeScreen.listenerCount(c));

/** Un ciclo de suspender y despertar un monitor, tal y como lo manda Windows. */
function cicloDeSuspension() {
  fakeScreen.emit('display-removed');
  fakeScreen.emit('display-added');
}

function nuevaCapa(t) {
  creadas = 0;
  vivas = 0;
  ventanas.length = 0;
  for (const c of CANALES) fakeScreen.removeAllListeners(c);
  const overlay = new DimOverlay();
  t.after(() => overlay.destroy());
  return overlay;
}

// ---------------------------------------------------------------------- tests

test('vigilar las pantallas registra un listener por evento, y start() no se acumula', (t) => {
  const overlay = nuevaCapa(t);
  overlay.start();
  assert.deepEqual(listeners(), [1, 1, 1]);

  // Llamarlo otra vez no debe duplicar nada.
  overlay.start();
  overlay.start();
  assert.deepEqual(listeners(), [1, 1, 1]);
});

test('los ciclos de suspension de monitor NO multiplican los listeners', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const overlay = nuevaCapa(t);
  overlay.start();
  overlay.show(); // crea las ventanas: es cuando el fallo se disparaba

  for (let i = 0; i < 12; i++) {
    cicloDeSuspension();
    t.mock.timers.tick(REBUILD_DEBOUNCE_MS + 50);
  }

  assert.deepEqual(
    listeners(),
    [1, 1, 1],
    'los listeners de pantalla se estan acumulando: es el fallo que congelaba la app'
  );
});

test('una rafaga de eventos reconstruye la capa UNA vez, no una por evento', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const overlay = nuevaCapa(t);
  overlay.start();
  overlay.show();
  assert.equal(creadas, 2, 'una ventana por pantalla');

  // Girar un monitor manda varios display-metrics-changed seguidos.
  displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
    { id: 2, bounds: { x: 3840, y: 116, width: 1920, height: 1080 } },
  ];
  for (let i = 0; i < 6; i++) fakeScreen.emit('display-metrics-changed');
  t.mock.timers.tick(REBUILD_DEBOUNCE_MS + 50);

  assert.equal(creadas, 4, 'se reconstruyo mas de una vez para la misma rafaga');
  assert.equal(vivas, 2, 'quedan ventanas huerfanas sin destruir');
});

test('un evento que no cambia la disposicion real no reconstruye nada', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const overlay = nuevaCapa(t);
  overlay.start();
  overlay.show();
  const antes = creadas;

  // Cambiar de HDR o mover la barra de tareas emite el evento igualmente, pero
  // las ventanas cubren `bounds` y eso no se ha movido.
  for (let i = 0; i < 4; i++) fakeScreen.emit('display-metrics-changed');
  t.mock.timers.tick(REBUILD_DEBOUNCE_MS + 50);

  assert.equal(creadas, antes, 'se rehizo la capa sin que cambiase nada');
});

test('las ventanas no existen hasta el primer show()', (t) => {
  const overlay = nuevaCapa(t);
  overlay.start();
  assert.equal(creadas, 0, 'vigilar las pantallas no debe costar dos procesos de renderizado');

  overlay.show();
  assert.equal(creadas, 2);
});

test('tras un rato oculta, la capa suelta sus ventanas', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const overlay = nuevaCapa(t);
  overlay.start();
  overlay.show();
  assert.equal(vivas, 2);

  overlay.hide();
  t.mock.timers.tick(60_000 + 1_000);
  assert.equal(vivas, 0, 'las ventanas del velo siguen ocupando memoria sin hacer falta');

  // Y vuelven cuando hacen falta.
  overlay.show();
  assert.equal(vivas, 2);
});

test('show() a 4 Hz no repite el mismo mensaje de opacidad', (t) => {
  const overlay = nuevaCapa(t);
  overlay.start();
  overlay.setOpacity(0.4);
  overlay.show();

  // La capa se muestra mientras dure la mala postura, y show() llega con cada
  // fotograma de la camara: son 4 mensajes por segundo y por monitor para
  // repetir el mismo numero.
  for (const win of ventanas) win.finishLoad();
  for (let i = 0; i < 40; i++) overlay.show();

  const win = ventanas[0];
  const opacidades = win.sent.filter(([canal]) => canal === 'dim:set');
  assert.equal(opacidades.length, 1, 'se esta reenviando la misma opacidad en cada frame');
  assert.equal(opacidades[0][1], 0.4);

  // Pero un cambio de verdad si tiene que llegar.
  overlay.setOpacity(0.6);
  const despues = win.sent.filter(([canal]) => canal === 'dim:set');
  assert.equal(despues.length, 2);
  assert.equal(despues[1][1], 0.6);
});

test('el velo aparece solo cuando su pagina ha cargado', (t) => {
  const overlay = nuevaCapa(t);
  overlay.start();
  overlay.show();

  const win = ventanas[0];
  assert.equal(win.isVisible(), false, 'una ventana transparente sin pintar puede dar un destello');
  win.finishLoad();
  assert.equal(win.isVisible(), true);
  assert.deepEqual(
    win.sent.filter(([c]) => c === 'dim:set').map(([, v]) => v),
    [0.35]
  );
});

test('enderezarse antes de que cargue el velo no lo muestra', (t) => {
  const overlay = nuevaCapa(t);
  overlay.start();
  overlay.show();
  overlay.hide(); // la postura se corrige en menos de lo que tarda en cargar

  const win = ventanas[0];
  win.finishLoad();
  assert.equal(win.isVisible(), false, 'el velo asoma despues de haberse corregido la postura');
});

test('destroy() deja de vigilar las pantallas', (t) => {
  const overlay = new DimOverlay();
  for (const c of CANALES) fakeScreen.removeAllListeners(c);
  overlay.start();
  assert.deepEqual(listeners(), [1, 1, 1]);

  overlay.destroy();
  assert.deepEqual(listeners(), [0, 0, 0], 'quedan listeners tras cerrar la app');
});

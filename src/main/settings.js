'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const profiles = require('./profiles.js');

/**
 * Config persistida en userData/settings.json.
 *
 * Escritura atomica (temporal + rename): un corte de luz a media escritura
 * dejaria un JSON truncado, y con el se perderia la calibracion -- que es lo
 * unico aqui que cuesta trabajo rehacer.
 */

const DEFAULTS = Object.freeze({
  // Cada superficie de aviso se apaga por separado.
  alerts: {
    tray: true,
    mascot: true,
    dim: true,
    toast: true,
    sound: true,
  },

  // 1.0 = umbrales de fabrica. Mas alto = salta antes.
  sensitivity: 1.0,

  // Histeresis: entra en malo por debajo de 60, no sale hasta 70.
  enterBadBelow: 60,
  exitBadAbove: 70,

  // Temporizadores de la politica.
  mascotDelayMs: 3_000, // el personaje se inquieta pronto
  dwellMs: 10_000, // pero oscurecer/toast esperan a que sea sostenido
  nagCooldownMs: 150_000, // minimo entre interrupciones (2,5 min)
  awayAfterMs: 5_000, // sin deteccion -> auto-pausa

  // Cuanto se perdona mirar hacia abajo (al teclado, a un papel) antes de que
  // vuelva a contar como mala postura. 0 desactiva la gracia.
  glanceGraceMs: 25_000,

  // Constante de tiempo del suavizado. Mas alto = score mas estable y lento.
  smoothingMs: 1_000,

  dimOpacity: 0.35,

  /**
   * Perfiles de calibracion.
   *
   * La base no es "tu postura correcta" en abstracto: es tu postura correcta
   * VISTA DESDE ESA CAMARA, en ESA silla, a ESA altura. Cambia de sitio y la
   * base entera deja de valer. Por eso cada montaje lleva la suya, y cambiar
   * de perfil es un clic en la bandeja en vez de recalibrar cada vez.
   *
   * Tambien sirve si mas de una persona usa el mismo equipo: las proporciones
   * corporales de cada uno dan bases distintas.
   */
  profiles: [{ id: 'default', name: 'Escritorio', baseline: null, createdAt: 0 }],
  activeProfileId: 'default',

  // Se rellenan al arrastrar el personaje y al elegir camara.
  mascotPosition: null,
  cameraId: null,
  autoStart: false,
});

let cache = null;
let filePath = null;

function file() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'settings.json');
  return filePath;
}

/** Mezcla superficial + un nivel para `alerts`, para no perder toggles nuevos. */
function merge(stored) {
  const next = {
    ...DEFAULTS,
    ...stored,
    alerts: { ...DEFAULTS.alerts, ...(stored?.alerts ?? {}) },
    // normalize() se encarga de la migracion desde el campo `baseline` suelto
    // y de garantizar que la lista nunca queda vacia ni el activo colgando.
    ...profiles.normalize(stored),
  };
  delete next.baseline;
  return next;
}

function load() {
  if (cache) return cache;
  try {
    cache = merge(JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('settings.json ilegible, se usan los valores por defecto:', err.message);
    }
    cache = { ...DEFAULTS, alerts: { ...DEFAULTS.alerts } };
  }
  return cache;
}

function save(patch) {
  const next = merge({ ...load(), ...patch });
  cache = next;

  const target = file();
  const tmp = `${target}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error('No se pudo guardar la configuracion:', err.message);
  }
  return next;
}

/** Solo lo que necesita PosturePolicy. */
function policyConfig() {
  const s = load();
  return {
    enterBadBelow: s.enterBadBelow,
    exitBadAbove: s.exitBadAbove,
    mascotDelayMs: s.mascotDelayMs,
    dwellMs: s.dwellMs,
    nagCooldownMs: s.nagCooldownMs,
    awayAfterMs: s.awayAfterMs,
  };
}

// ------------------------------------------------------------------ perfiles
// Toda la logica vive en profiles.js (pura y testeada); aqui solo se guarda.

const activeProfile = () => profiles.find(load());
const activeBaseline = () => profiles.baselineOf(load());

const saveBaseline = (baseline) => save(profiles.withBaseline(load(), baseline, Date.now()));
const addProfile = (name) => save(profiles.add(load(), name, crypto.randomUUID(), Date.now()));
const renameProfile = (id, name) => save(profiles.rename(load(), id, name));
const deleteProfile = (id) => save(profiles.remove(load(), id));
const setActiveProfile = (id) => save(profiles.activate(load(), id));

module.exports = {
  DEFAULTS,
  load,
  save,
  policyConfig,
  activeProfile,
  activeBaseline,
  saveBaseline,
  addProfile,
  renameProfile,
  deleteProfile,
  setActiveProfile,
};

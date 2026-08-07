'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const profiles = require('./profiles.js');
const tuning = require('./tuning.js');
const i18n = require('../shared/i18n.js');

/**
 * Config persistida en userData/settings.json.
 *
 * Escritura atomica (temporal + rename): un corte de luz a media escritura
 * dejaria un JSON truncado, y con el se perderia la calibracion -- que es lo
 * unico aqui que cuesta trabajo rehacer.
 *
 * Los valores de fabrica, sus rangos y los grupos de restauracion viven en
 * tuning.js: ahi no hace falta Electron y por tanto se pueden testear.
 */

const { DEFAULTS, LIMITS, RESET_GROUPS } = tuning;

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
    ...profiles.normalize(stored, i18n.t('profiles.defaultName')),
  };
  delete next.baseline;
  return tuning.sanitize(next);
}

/**
 * Solo el idioma elegido, leido del disco sin pasar por merge().
 *
 * Existe por un problema de orden: merge() bautiza el perfil por defecto con
 * un nombre traducido, asi que hay que fijar el idioma ANTES de la primera
 * lectura completa -- pero el idioma vive dentro del propio archivo. Esta
 * lectura minima rompe el circulo, y en un arranque limpio en ingles el perfil
 * nace llamandose "Desk" en vez de "Escritorio".
 */
function storedLocale() {
  try {
    return i18n.normalizeCode(JSON.parse(fs.readFileSync(file(), 'utf8'))?.locale);
  } catch {
    return null; // sin archivo todavia, o ilegible: manda el idioma del sistema
  }
}

function load() {
  if (cache) return cache;
  try {
    cache = merge(JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('settings.json ilegible, se usan los valores por defecto:', err.message);
    }
    cache = merge({});
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

/**
 * Devuelve a fabrica un grupo de ajustes, o todos si no se nombra ninguno.
 *
 * Deja siempre fuera perfiles, calibracion, camara elegida, posicion del
 * personaje e idioma: eso no son "valores por defecto" que uno quiera
 * recuperar, es trabajo del usuario. Recalibrar por haber tocado un deslizador
 * seria un castigo desproporcionado.
 */
function resetTunables(group) {
  const patch = tuning.resetPatch(group);
  return patch ? save(patch) : load();
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
const addProfile = (name) =>
  save(profiles.add(load(), name, crypto.randomUUID(), Date.now(), (n) =>
    i18n.t('profiles.autoName', { n })
  ));
const renameProfile = (id, name) => save(profiles.rename(load(), id, name));
const deleteProfile = (id) => save(profiles.remove(load(), id));
const setActiveProfile = (id) => save(profiles.activate(load(), id));

module.exports = {
  DEFAULTS,
  LIMITS,
  RESET_GROUPS,
  storedLocale,
  load,
  save,
  resetTunables,
  policyConfig,
  activeProfile,
  activeBaseline,
  saveBaseline,
  addProfile,
  renameProfile,
  deleteProfile,
  setActiveProfile,
};

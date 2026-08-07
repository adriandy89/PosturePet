'use strict';

/**
 * Logica de perfiles de calibracion. Puro: entra un estado, sale otro.
 * Sin disco ni Electron, para poder testear los invariantes.
 *
 * POR QUE EXISTEN LOS PERFILES
 *
 * La base no es "tu postura correcta" en abstracto: es tu postura correcta
 * VISTA DESDE ESA CAMARA, en ESA silla, a ESA altura de mesa. Al cambiar de
 * montaje, la base entera deja de significar nada -- y lo peor es que no falla
 * de forma ruidosa, sino silenciosa: sigue puntuando, solo que mal.
 *
 * Dos invariantes que el resto del codigo da por hechos:
 *   1. La lista NUNCA esta vacia (siempre hay donde guardar una calibracion).
 *   2. activeProfileId SIEMPRE apunta a un perfil existente.
 */

/**
 * Los nombres entran por parametro en vez de leerse del catalogo de idiomas:
 * este modulo es puro a proposito, y requerir i18n aqui lo ataria al proceso
 * principal. Los valores por defecto son los espanoles historicos, asi que
 * quien llame sin traducir obtiene exactamente lo de siempre.
 */
const DEFAULT_PROFILE = (name = 'Escritorio') => ({
  id: 'default',
  name,
  baseline: null,
  createdAt: 0,
});

/**
 * Repara cualquier estado de perfiles, venga de donde venga: un settings.json
 * viejo sin perfiles, uno editado a mano, o uno corrompido.
 */
function normalize(stored, defaultName) {
  let profiles = Array.isArray(stored?.profiles) ? stored.profiles.filter(isValid) : [];

  // Migracion desde cuando la base era un campo suelto, antes de los perfiles.
  if (profiles.length === 0 && stored?.baseline) {
    profiles = [{ ...DEFAULT_PROFILE(defaultName), baseline: stored.baseline }];
  }
  if (profiles.length === 0) profiles = [DEFAULT_PROFILE(defaultName)];

  const activeProfileId = profiles.some((p) => p.id === stored?.activeProfileId)
    ? stored.activeProfileId
    : profiles[0].id;

  return { profiles, activeProfileId };
}

const isValid = (p) => p && typeof p.id === 'string' && p.id.length > 0;

const find = (state) =>
  state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];

const baselineOf = (state) => find(state).baseline ?? null;

/** Guarda una calibracion en el perfil activo. */
const withBaseline = (state, baseline, now) => ({
  ...state,
  profiles: state.profiles.map((p) =>
    p.id === state.activeProfileId ? { ...p, baseline, calibratedAt: now } : p
  ),
});

/** Anade y activa: crear un perfil siempre va seguido de calibrarlo. */
function add(state, name, id, now, autoName = (n) => `Perfil ${n}`) {
  const profile = {
    id,
    name: name?.trim() || autoName(state.profiles.length + 1),
    baseline: null,
    createdAt: now,
  };
  return { profiles: [...state.profiles, profile], activeProfileId: profile.id };
}

const rename = (state, id, name) => ({
  ...state,
  profiles: state.profiles.map((p) =>
    p.id === id && name?.trim() ? { ...p, name: name.trim() } : p
  ),
});

function remove(state, id) {
  // Siempre debe quedar uno: es donde vive la calibracion.
  if (state.profiles.length <= 1) return state;

  const profiles = state.profiles.filter((p) => p.id !== id);
  if (profiles.length === state.profiles.length) return state; // no existia

  return {
    profiles,
    activeProfileId: id === state.activeProfileId ? profiles[0].id : state.activeProfileId,
  };
}

const activate = (state, id) =>
  state.profiles.some((p) => p.id === id) ? { ...state, activeProfileId: id } : state;

module.exports = { normalize, find, baselineOf, withBaseline, add, rename, remove, activate };

'use strict';

const i18n = require('../shared/i18n.js');

/**
 * Los valores de fabrica, sus rangos y como se restauran.
 *
 * Vive separado de settings.js porque ese modulo requiere Electron (necesita
 * app.getPath para saber donde escribir), y esto es aritmetica pura: asi se
 * puede testear sin arrancar un Electron entero, que es justo lo que hace
 * falta cuando cada deslizador nuevo es una oportunidad mas de guardar un
 * valor absurdo.
 */

const DEFAULTS = Object.freeze({
  // null = seguir el idioma del sistema. Un codigo ('es', 'en') lo fija.
  locale: null,

  // Que personaje se dibuja. Los ids viven en src/renderer/avatars.mjs; uno
  // desconocido cae al de fabrica en el propio renderer, asi que no hace falta
  // que este modulo -- que es del proceso principal -- conozca el elenco.
  avatar: 'blob',

  // Cada superficie de aviso se apaga por separado.
  alerts: Object.freeze({
    tray: true,
    mascot: true,
    dim: true,
    toast: true,
    sound: true,
  }),

  // 1.0 = umbrales de fabrica. Mas alto = salta antes.
  sensitivity: 1.0,

  // Histeresis: entra en malo por debajo de 66, no sale hasta 74.
  enterBadBelow: 66,
  exitBadAbove: 74,

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
  // El fundido de entrada es lento (no sobresalta) y el de salida rapido: la
  // recompensa por enderezarte tiene que llegar sin demora.
  dimFadeInMs: 1_100,
  dimFadeOutMs: 350,

  // El aviso sonoro son dos notas descendentes sintetizadas en el renderer.
  // La segunda cae una cuarta justa por debajo de la primera (ver mascot.mjs).
  soundVolume: 0.12,
  soundPitchHz: 880,
  soundGapMs: 140,
  soundDecayMs: 450,

  // Percepcion. Son ajustes y no constantes del renderer porque cada equipo
  // los resuelve distinto: un portatil lento agradece subir el intervalo, y
  // quien se gira mucho a hablar, alargar staleAfterMs.
  calibrationMs: 3_000,
  detectionIntervalMs: 250,
  staleAfterMs: 30_000,

  // Cuenta atras antes de empezar a promediar. 0 la salta y captura en cuanto
  // el detector te ve.
  calibrationCountdownMs: 3_000,
  // Ritmo del video de la capa de calibracion. Solo corre mientras esta
  // abierta, asi que no afecta al coste normal de la app.
  previewIntervalMs: 100,

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
  profiles: Object.freeze([
    Object.freeze({ id: 'default', name: 'Escritorio', baseline: null, createdAt: 0 }),
  ]),
  activeProfileId: 'default',

  // Se rellenan al arrastrar el personaje y al elegir camara.
  mascotPosition: null,
  cameraId: null,
  autoStart: false,
});

/**
 * Rango admisible de cada numero, [min, max]. Es tambien el rango de su
 * deslizador: la ventana de ajustes los pide por IPC en vez de repetirlos en
 * el HTML, porque un deslizador que llega hasta un valor que luego el backend
 * recorta parece averiado.
 *
 * No es paranoia: settings.json es un archivo de texto en el perfil del
 * usuario. Un detectionIntervalMs de 0 congela el equipo y un dwellMs negativo
 * dispara avisos en bucle -- fallos que no se manifiestan al guardarlos, sino
 * tres modulos mas alla y sin pista de donde vienen.
 */
const LIMITS = Object.freeze({
  sensitivity: [0.5, 2],
  enterBadBelow: [20, 90],
  exitBadAbove: [25, 95],
  mascotDelayMs: [1_000, 30_000],
  dwellMs: [3_000, 60_000],
  nagCooldownMs: [30_000, 900_000],
  awayAfterMs: [2_000, 60_000],
  glanceGraceMs: [0, 120_000],
  smoothingMs: [300, 4_000],
  dimOpacity: [0.1, 0.8],
  dimFadeInMs: [100, 5_000],
  dimFadeOutMs: [50, 2_000],
  soundVolume: [0, 0.4],
  soundPitchHz: [220, 1_760],
  soundGapMs: [0, 600],
  soundDecayMs: [80, 1_500],
  calibrationMs: [1_000, 10_000],
  calibrationCountdownMs: [0, 10_000],
  detectionIntervalMs: [150, 1_000],
  staleAfterMs: [5_000, 300_000],
  previewIntervalMs: [50, 500],
});

/** Separacion minima entre los dos umbrales de histeresis. */
const MIN_HYSTERESIS_GAP = 5;

/**
 * Que devuelve a fabrica cada boton de "restaurar", agrupado igual que las
 * pestanas de la ventana de ajustes.
 *
 * Estan aqui y no en el renderer a proposito: si el reparto viviera en la
 * interfaz, anadir un ajuste nuevo obligaria a acordarse de meterlo tambien en
 * su grupo, y olvidarlo daria un boton que restaura casi todo -- un fallo
 * silencioso. El test comprueba que ningun ajuste con limites se quede fuera.
 */
const RESET_GROUPS = Object.freeze({
  alerts: ['alerts', 'dimOpacity', 'dimFadeInMs', 'dimFadeOutMs'],
  sound: ['soundVolume', 'soundPitchHz', 'soundGapMs', 'soundDecayMs'],
  sensitivity: ['sensitivity', 'smoothingMs', 'enterBadBelow', 'exitBadAbove'],
  times: ['glanceGraceMs', 'dwellMs', 'nagCooldownMs', 'mascotDelayMs', 'awayAfterMs',
    'calibrationMs', 'calibrationCountdownMs'],
  camera: ['detectionIntervalMs', 'staleAfterMs', 'previewIntervalMs'],
});

/** Todo lo restaurable, para el boton global de la pestana Sistema. */
const TUNABLE_KEYS = Object.freeze(Object.values(RESET_GROUPS).flat());

const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));

/**
 * Deja cada numero dentro de su rango y descarta la basura. Un valor no
 * numerico vuelve al de fabrica en vez de propagarse como NaN, que es el peor
 * de los casos: NaN no falla, solo hace que todas las comparaciones den false.
 */
function sanitize(config) {
  const out = { ...config };

  for (const [key, range] of Object.entries(LIMITS)) {
    // Number.isFinite SIN convertir antes, a proposito: Number(null) es 0 y
    // Number('') tambien, asi que un valor ausente pasaria por valido y se
    // recortaria al minimo del rango en vez de volver al de fabrica. Un
    // dwellMs que aparece en 3 s cuando deberia ser 10 no lo nota nadie.
    out[key] = Number.isFinite(out[key]) ? clamp(out[key], range) : DEFAULTS[key];
  }

  // La histeresis solo tiene sentido si el umbral de salida queda por encima
  // del de entrada. Al reves, el estado oscilaria en cada frame.
  if (out.exitBadAbove < out.enterBadBelow + MIN_HYSTERESIS_GAP) {
    out.exitBadAbove = clamp(out.enterBadBelow + MIN_HYSTERESIS_GAP, LIMITS.exitBadAbove);
  }

  // Un idioma que ya no exista (catalogo retirado, JSON editado a mano) vuelve
  // a "seguir al sistema" en lugar de dejar la interfaz en claves crudas.
  out.locale = i18n.normalizeCode(out.locale);

  return out;
}

/**
 * El parche que devuelve a fabrica un grupo, o todo si no se nombra ninguno.
 * Devuelve null si el grupo no existe: mejor no tocar nada que restaurar de
 * mas.
 */
function resetPatch(group) {
  const keys = group ? RESET_GROUPS[group] : TUNABLE_KEYS;
  if (!keys) return null;

  const patch = {};
  for (const key of keys) {
    patch[key] = key === 'alerts' ? { ...DEFAULTS.alerts } : DEFAULTS[key];
  }
  return patch;
}

module.exports = {
  DEFAULTS,
  LIMITS,
  RESET_GROUPS,
  TUNABLE_KEYS,
  MIN_HYSTERESIS_GAP,
  sanitize,
  resetPatch,
};

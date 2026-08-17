import { PostureCamera } from './camera.mjs';
import { avatarSvg, isKnownAvatar, DEFAULT_AVATAR } from './avatars.mjs';

/**
 * Renderer del personaje. Hace dos cosas a la vez:
 *
 *   1. Aloja el bucle de la camara (esta ventana es siempre visible, asi que
 *      Chromium no la frena -- ver el comentario largo en main.js).
 *   2. Dibuja al muneco reaccionando al estado que le manda la politica.
 */

const pet = document.getElementById('pet');

const camera = new PostureCamera(
  (result) => window.bridge.sendFrame(serialize(result)),
  (err) => {
    console.error('Fallo en el bucle de deteccion:', err);
    setState('blind');
  }
);

camera.onCalibrationDone = (result) => window.bridge.sendCalibration(result);
camera.onPreview = (dataUrl) => window.bridge.sendPreview(dataUrl);

/**
 * Los objetos que cruzan IPC se serializan con el algoritmo de clonado
 * estructurado, asi que aqui se manda solo lo que main necesita de verdad:
 * numeros planos, sin landmarks ni referencias al video.
 */
function serialize(result) {
  return {
    score: result.score ?? null,
    breakdown: result.breakdown ?? null,
    deviations: result.deviations ?? null,
    needsCalibration: Boolean(result.needsCalibration),
    calibrating: Boolean(result.calibrating),
    turned: Boolean(result.turned),
    stale: Boolean(result.stale),
    // Booleanos de "estas listo para calibrar". Siguen la misma regla que el
    // resto: numeros y banderas, nada de landmarks.
    ready: result.ready ?? null,
    // El panel de depuracion muestra si estas mirando al teclado y si aun se
    // te esta perdonando: sin verlo, la gracia parece un fallo del detector.
    glance: result.glance
      ? {
          glancing: result.glance.glancing,
          forgiven: result.glance.forgiven,
          heldMs: result.glance.heldMs,
          pitchDown: result.glance.pitchDown,
        }
      : null,
  };
}

// -------------------------------------------------------------- apariencia

const STATES = ['good', 'warn', 'bad', 'paused', 'blind'];

let visible = true;
let avatar = null;
let state = 'paused';
let reliefTimer = null;
let nudgeTimer = null;

/**
 * Las clases se tocan una a una con classList y no reescribiendo className.
 * `nudge` y `relief` las pone y las quita un temporizador, y un cambio de
 * estado a mitad las borraria: la sacudida del aviso se quedaria congelada.
 */
function applyState() {
  for (const s of STATES) pet.classList.toggle(`state-${s}`, s === state);
}

/** Pinta el cuerpo del personaje elegido. Solo al cambiar, no en cada frame. */
function renderAvatar(id) {
  const next = isKnownAvatar(id) ? id : DEFAULT_AVATAR;
  if (next === avatar) return;

  if (avatar) pet.classList.remove(`avatar-${avatar}`);
  avatar = next;
  pet.classList.add(`avatar-${avatar}`);
  pet.innerHTML = avatarSvg(avatar);
  applyState();
}

function setState(next) {
  if (next === state) return;

  // Enderezarse merece respuesta. La app solo sabe castigar, y una app que
  // solo castiga se acaba desinstalando; el rebote dura menos de un segundo y
  // es lo unico que dice "bien hecho".
  const corrected = (state === 'bad' || state === 'warn') && next === 'good';
  state = next;
  applyState();

  clearTimeout(reliefTimer);
  pet.classList.toggle('relief', corrected);
  if (corrected) {
    reliefTimer = setTimeout(() => pet.classList.remove('relief'), 900);
  }
}

renderAvatar(DEFAULT_AVATAR);

window.bridge.onState(({ state: next, level, alarmed }) => {
  if (next === 'paused') return setState('paused');
  if (next === 'bad') return setState(alarmed || level >= 3 ? 'bad' : 'warn');
  setState('good');
});

/**
 * La pausa suelta la camara, no solo cambia la cara del personaje. Se pinta el
 * estado igual: reanudar puede tardar unos cientos de milisegundos en reabrir
 * el dispositivo, y hasta entonces no llega ningun frame que lo refresque.
 */
window.bridge.onPaused((paused) => {
  camera.setPaused(paused).catch((err) => {
    console.error('No se pudo reabrir la camara al reanudar:', err);
    setState('blind');
    window.bridge.sendFrame({ score: null, cameraError: err.message });
  });
});

window.bridge.onVisible((v) => {
  visible = v;
  // La ventana no se oculta nunca (eso frenaria la camara): se encoge a 1x1
  // desde main y aqui solo se apaga el dibujo.
  pet.style.display = v ? '' : 'none';
});

// -------------------------------------------------------------- el sonido

/**
 * El tono se sintetiza en vez de cargar un .wav: asi no hay binarios en el
 * repo, se puede dar una envolvente suave y ademas se vuelve configurable sin
 * generar audio nuevo. Dos notas descendentes con caida exponencial -- se oye,
 * pero no sobresalta como una alarma.
 */
let audio = null;

/**
 * El contexto se suspende en cuanto la ultima nota se apaga, y se reanuda en el
 * siguiente aviso.
 *
 * Un AudioContext en marcha no se calla nunca: mantiene abierto un flujo de
 * salida y sigue generando silencio a 48 kHz en su propio hilo, para siempre,
 * entre avisos que llegan cada dos minutos y medio.
 *
 * Lo que NO hace es ahorrar memoria: el servicio de audio de Chromium (~71 MB
 * en un proceso aparte) ya esta levantado desde el arranque por la tuberia de
 * medios de la camara, y sigue ahi con el contexto suspendido. Esta medido; no
 * se espere ver bajar la memoria por esto.
 *
 * No se cierra con close(): es irreversible, y crear un contexto nuevo cuesta
 * mas que despertar el que ya hay.
 */
let suspendTimer = null;
const SUSPEND_MARGIN_S = 0.3;

/**
 * Intervalo entre las dos notas: una cuarta justa descendente (3/4 de la
 * frecuencia). Es la relacion, no las dos frecuencias sueltas, lo que da el
 * caracter de "aviso amable"; por eso el usuario ajusta solo la primera nota
 * y la segunda la sigue.
 */
const SECOND_NOTE_RATIO = 0.75;
const ATTACK_S = 0.02;
const SILENCE = 0.0001; // exponentialRamp no admite llegar a cero

let sound = { volume: 0.12, pitchHz: 880, gapMs: 140, decayMs: 450 };

/**
 * Las tres voces. El tic de la cuenta atras NO puede ser el aviso completo:
 * encadenar tres avisos de dos notas en tres segundos suena a alarma, justo lo
 * contrario de lo que hace falta mientras alguien intenta sentarse bien.
 *
 * Todas se derivan de los ajustes del usuario en vez de llevar frecuencias
 * propias, para que cambiar el tono siga afectando a la app entera.
 */
const VOICES = {
  // Dos notas descendentes: el aviso de siempre.
  nag: () => ({ notes: [1, SECOND_NOTE_RATIO], decay: 1, volume: 1 }),
  // Una nota corta y discreta, por segundo de cuenta atras.
  tick: () => ({ notes: [1], decay: 0.28, volume: 0.55 }),
  // Al empezar a medir, una nota mas grave y algo mas larga: cierra la cuenta.
  go: () => ({ notes: [SECOND_NOTE_RATIO], decay: 0.8, volume: 0.85 }),
};

async function chime(kind = 'nag') {
  if (sound.volume <= 0) return;

  const voice = (VOICES[kind] ?? VOICES.nag)();

  audio ??= new AudioContext();
  // Se ESPERA a que reanude antes de leer currentTime: mientras esta suspendido
  // el reloj del contexto no avanza, y programar sobre un reloj parado dejaba
  // las notas en el pasado -- o sea, en silencio. Ahora que se suspende tras
  // cada aviso, este camino es el normal y no la excepcion.
  if (audio.state === 'suspended') await audio.resume();

  const now = audio.currentTime;
  const gap = sound.gapMs / 1000;
  const decay = (sound.decayMs / 1000) * voice.decay;
  const volume = sound.volume * voice.volume;

  voice.notes.forEach((ratio, i) => {
    const t = now + i * gap;
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    osc.type = 'sine';
    osc.frequency.value = sound.pitchHz * ratio;
    gain.gain.setValueAtTime(SILENCE, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + ATTACK_S); // ataque rapido
    gain.gain.exponentialRampToValueAtTime(SILENCE, t + decay); // cola

    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    // Un pelin mas alla del final de la rampa: cortar justo encima deja un
    // chasquido audible.
    osc.stop(t + decay + 0.05);
  });

  // El tic de la cuenta atras llega una vez por segundo: el temporizador se
  // reprograma en cada nota para que la suspension caiga despues de la ultima,
  // no en medio de la cuenta.
  const lastNoteEnds = (voice.notes.length - 1) * gap + decay + 0.05;
  clearTimeout(suspendTimer);
  suspendTimer = setTimeout(() => {
    suspendTimer = null;
    if (audio?.state === 'running') audio.suspend();
  }, (lastNoteEnds + SUSPEND_MARGIN_S) * 1000);
}

window.bridge.onChime((kind) => {
  // No se espera: el sonido va por su cuenta y un fallo del contexto de audio
  // no debe tumbar el resto del manejador.
  chime(kind).catch((err) => console.warn('No se pudo sonar el aviso:', err.message));
  // El personaje solo se sacude con el aviso de verdad: hacerle dar botes con
  // cada tic de la cuenta atras lo convertiria en ruido visual.
  if (!visible || (kind && kind !== 'nag')) return;
  // La clase se retira al acabar para que la sacudida pueda repetirse. El
  // temporizador anterior se cancela, como con `relief`: dos avisos seguidos
  // dejaban al primero quitando la clase en mitad de la segunda sacudida.
  clearTimeout(nudgeTimer);
  pet.classList.add('nudge');
  nudgeTimer = setTimeout(() => pet.classList.remove('nudge'), 600);
});

// ------------------------------------------------------------------ arranque

window.bridge.onConfig((cfg) => {
  if (cfg.sound) sound = { ...sound, ...cfg.sound };
  if (cfg.avatar) renderAvatar(cfg.avatar);
  camera.configure(cfg);
});

/**
 * La lista de camaras la publica esta ventana, no la de ajustes: es la que
 * tiene el permiso concedido, y sin permiso enumerateDevices() devuelve los
 * dispositivos sin nombre.
 */
async function publishCameras() {
  try {
    window.bridge.sendCameras(await camera.listCameras());
  } catch (err) {
    console.warn('No se pudieron listar las camaras:', err.message);
  }
}

// Conectar o desconectar una webcam cambia la lista.
navigator.mediaDevices?.addEventListener('devicechange', publishCameras);

window.bridge.onCalibrate(() => camera.startCalibration());
window.bridge.onCalibrateCancel(() => camera.abortCalibration());
window.bridge.onPreviewToggle((on) => camera.enablePreview(on));

// Avisar a main de donde ha quedado el muneco tras arrastrarlo.
window.addEventListener('mouseup', () => window.bridge.dragEnd());

camera
  .start()
  .then(publishCameras)
  .catch((err) => {
    console.error('No se pudo abrir la camara:', err);
    setState('blind');
    window.bridge.sendFrame({ score: null, cameraError: err.message });
  });

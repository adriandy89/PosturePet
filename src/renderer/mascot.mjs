import { PostureCamera } from './camera.mjs';

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

let visible = true;

function setState(name) {
  pet.className = `state-${name}`;
}

window.bridge.onState(({ state, level, alarmed }) => {
  if (state === 'paused') return setState('paused');
  if (state === 'bad') return setState(alarmed || level >= 3 ? 'bad' : 'warn');
  setState('good');
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
 * repo y se puede dar una envolvente suave. Dos notas descendentes con caida
 * exponencial -- se oye, pero no sobresalta como una alarma.
 */
let audio = null;

function chime() {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume();

  const now = audio.currentTime;
  [880, 660].forEach((freq, i) => {
    const t = now + i * 0.14;
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02); // ataque rapido
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45); // cola larga

    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  });
}

window.bridge.onChime(() => {
  chime();
  if (!visible) return;
  // La clase se retira al acabar para que la sacudida pueda repetirse.
  pet.classList.add('nudge');
  setTimeout(() => pet.classList.remove('nudge'), 600);
});

// ------------------------------------------------------------------ arranque

window.bridge.onConfig((cfg) => camera.configure(cfg));

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

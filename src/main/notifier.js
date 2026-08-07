'use strict';

const { Notification } = require('electron');

/**
 * Las dos superficies que interrumpen: toast nativo y sonido.
 *
 * Ambas van sujetas al enfriamiento de policy.js -- aqui no hay logica de
 * cuando, solo de que decir.
 *
 * El toast nombra la metrica que peor esta. "Sientate bien" es facil de
 * ignorar; "te has acercado a la pantalla" te dice que corregir, y eso es la
 * diferencia entre un aviso util y ruido.
 */

const POR_METRICA = {
  neckLength: [
    'Cuello encogido: baja los hombros y sube la barbilla.',
    'Se te esta acortando el cuello. Abre el pecho y lleva los hombros atras.',
    'La cabeza se te hunde entre los hombros.',
  ],
  proximity: [
    'Te has acercado a la pantalla. Echate un poco atras.',
    'La cabeza se te ha ido hacia el monitor.',
  ],
  // Esta metrica va en dos sentidos, asi que el mensaje depende del signo.
  shoulderHeight: {
    up: ['Te has escurrido en la silla. Sube el culo al respaldo.', 'Vas resbalando hacia abajo.'],
    down: ['Llevas los hombros encogidos. Sueltalos.', 'Relaja los hombros, los tienes subidos.'],
  },
  shoulderTilt: [
    'Estas ladeado. Reparte el peso entre las dos caderas.',
    'Un hombro mas alto que el otro.',
  ],
  headRoll: ['Tienes la cabeza torcida.', 'Endereza la cabeza.'],
  driftX: ['Te has desplazado de lado. Vuelve al centro.', 'Recolocate frente a la pantalla.'],
};

const GENERICO = ['Revisa tu postura.', 'Estirate un momento.'];

class Notifier {
  #counter = 0;
  #mascotWindow = null;
  #enabled = { toast: true, sound: true };

  attachMascot(win) {
    this.#mascotWindow = win;
  }

  setEnabled({ toast, sound }) {
    this.#enabled = { toast, sound };
  }

  /** @param breakdown el desglose por metrica de posture.mjs, o null */
  nag(breakdown) {
    if (this.#enabled.toast) this.#toast(breakdown);
    if (this.#enabled.sound) this.#chime();
  }

  #toast(breakdown) {
    if (!Notification.isSupported()) return;

    // Rotamos entre variantes para que el mensaje no se vuelva invisible de
    // tanto repetirse.
    const mensajes = this.#mensajesPara(breakdown);
    const body = mensajes[this.#counter++ % mensajes.length];

    new Notification({
      title: 'PosturePet',
      body,
      silent: true, // el sonido lo pone #chime, y tiene su propio interruptor
      urgency: 'low',
    }).show();
  }

  #mensajesPara(breakdown) {
    if (!breakdown) return GENERICO;

    // La metrica con mas contribucion a la penalizacion es la que hay que
    // corregir; las demas suelen ir detras de ella.
    let peor = null;
    let max = 0;
    for (const [name, m] of Object.entries(breakdown)) {
      if (m.contribution > max) {
        max = m.contribution;
        peor = name;
      }
    }
    if (!peor) return GENERICO;

    const entry = POR_METRICA[peor];
    if (!entry) return GENERICO;

    // Las metricas de dos sentidos necesitan mensajes distintos segun el signo:
    // "te escurres" y "encoges los hombros" son la misma metrica y consejos
    // opuestos.
    if (Array.isArray(entry)) return entry;
    return breakdown[peor].deviation >= 0 ? entry.up : entry.down;
  }

  #chime() {
    // El proceso main no reproduce audio: se lo pedimos al renderer del
    // personaje, que sintetiza el tono con Web Audio. Suena aunque la ventana
    // este reducida a 1x1 con el personaje desactivado.
    const win = this.#mascotWindow;
    if (win && !win.isDestroyed()) win.webContents.send('mascot:chime');
  }
}

module.exports = { Notifier };

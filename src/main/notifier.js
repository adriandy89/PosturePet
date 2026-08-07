'use strict';

const { Notification } = require('electron');
const { t, list } = require('../shared/i18n.js');

/**
 * Las dos superficies que interrumpen: toast nativo y sonido.
 *
 * Ambas van sujetas al enfriamiento de policy.js -- aqui no hay logica de
 * cuando, solo de que decir.
 *
 * El toast nombra la metrica que peor esta. "Sientate bien" es facil de
 * ignorar; "te has acercado a la pantalla" te dice que corregir, y eso es la
 * diferencia entre un aviso util y ruido.
 *
 * Los textos viven en los catalogos de idioma, bajo `notify.metric.<clave>`.
 * La clave de cada entrada es exactamente el nombre de la metrica en
 * posture.mjs, y test/messages.test.mjs comprueba que no falte ninguna: una
 * metrica sin mensaje cae al texto generico sin que nadie se entere.
 */

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
    if (this.#enabled.sound) this.chime();
  }

  #toast(breakdown) {
    if (!Notification.isSupported()) return;

    // Rotamos entre variantes para que el mensaje no se vuelva invisible de
    // tanto repetirse.
    const mensajes = this.#mensajesPara(breakdown);
    const body = mensajes[this.#counter++ % mensajes.length];

    new Notification({
      title: t('notify.title'),
      body,
      silent: true, // el sonido lo pone chime(), y tiene su propio interruptor
      urgency: 'low',
    }).show();
  }

  #mensajesPara(breakdown) {
    const generico = list('notify.generic');
    if (!breakdown) return generico;

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
    if (!peor) return generico;

    // Las metricas de dos sentidos necesitan mensajes distintos segun el signo:
    // "te escurres" y "encoges los hombros" son la misma metrica y consejos
    // opuestos. En el catalogo eso es un objeto {up, down} en vez de una lista.
    const directo = list(`notify.metric.${peor}`);
    if (directo.length) return directo;

    const sentido = breakdown[peor].deviation >= 0 ? 'up' : 'down';
    const porSigno = list(`notify.metric.${peor}.${sentido}`);
    return porSigno.length ? porSigno : generico;
  }

  /**
   * El proceso main no reproduce audio: se lo pedimos al renderer del
   * personaje, que sintetiza el tono con Web Audio. Suena aunque la ventana
   * este reducida a 1x1 con el personaje desactivado.
   *
   * Es publico porque lo invocan al margen del enfriamiento y de los
   * interruptores el boton "Probar sonido" y los tics de la cuenta atras de la
   * calibracion: quien los provoca quiere oirlos ahora.
   *
   * @param kind 'nag' (aviso de dos notas), 'tick' o 'go' -- ver mascot.mjs
   */
  chime(kind = 'nag') {
    const win = this.#mascotWindow;
    if (win && !win.isDestroyed()) win.webContents.send('mascot:chime', kind);
  }
}

module.exports = { Notifier };

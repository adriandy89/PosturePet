'use strict';

const { net, shell, app } = require('electron');
const { isNewer } = require('../shared/version.js');

/**
 * La UNICA conexion de red que llega a hacer esta app, y solo cuando el usuario
 * pulsa el boton. Nunca al arrancar, nunca sola, nunca en segundo plano.
 *
 * POR QUE VIVE EN EL PROCESO PRINCIPAL
 *
 * Hacerlo desde la ventana de ajustes obligaria a abrir `connect-src` hacia
 * api.github.com en su Content-Security-Policy, que hoy es `default-src 'none'`.
 * Ese agujero quedaria abierto para siempre -- en cada arranque, mire el
 * usuario o no la pantalla de informacion -- a cambio de una peticion manual
 * que puede que no haga nunca. Aqui el renderer no toca la red en absoluto.
 *
 * QUE SE ENVIA
 *
 * Un GET a un endpoint publico. Ni la configuracion, ni las metricas, ni la
 * calibracion, ni ningun identificador. Lo unico inevitable es lo que ve
 * cualquier servidor web: la direccion IP, y eso se dice en la interfaz en vez
 * de esconderlo detras de "sin telemetria".
 */

const REPO = 'adriandy89/PosturePet';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

/**
 * Nada que salga de aqui puede abrirse si no empieza por esto.
 *
 * `html_url` viene de la red. Pasarselo a shell.openExternal sin comprobarlo
 * seria dejar que la respuesta de un servidor decida que se abre en el equipo
 * del usuario -- y openExternal no solo abre paginas web.
 */
const ALLOWED_PREFIX = `https://github.com/${REPO}/`;

const TIMEOUT_MS = 8_000;

/**
 * Consulta la ultima release publicada.
 *
 * Devuelve siempre un estado nombrado, nunca una excepcion: cada forma de
 * fallar necesita su propio mensaje. "Ha habido un error" no le dice al usuario
 * si tiene que revisar el wifi, esperar un rato o abrir la pagina a mano.
 *
 * @returns {Promise<{status: string, version?: string, url?: string}>}
 *   'update'      hay una version mas nueva
 *   'current'     ya estas al dia
 *   'offline'     no se pudo conectar
 *   'timeout'     el servidor no contesto a tiempo
 *   'rateLimited' GitHub ha cortado por exceso de peticiones (403/429)
 *   'notFound'    el repositorio aun no ha publicado ninguna release (404)
 *   'failed'      cualquier otra cosa, incluida una respuesta ilegible
 */
async function check() {
  const current = app.getVersion();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await net.fetch(API_URL, {
      signal: controller.signal,
      headers: {
        // GitHub rechaza las peticiones sin User-Agent. Va sin version a
        // proposito: asi la peticion no dice absolutamente nada del equipo.
        'User-Agent': 'PosturePet',
        Accept: 'application/vnd.github+json',
      },
    });

    if (response.status === 404) return { status: 'notFound', url: RELEASES_PAGE };
    if (response.status === 403 || response.status === 429) {
      return { status: 'rateLimited', url: RELEASES_PAGE };
    }
    if (!response.ok) return { status: 'failed', url: RELEASES_PAGE };

    const release = await response.json();
    const version = String(release?.tag_name ?? '').replace(/^v/i, '');
    const url = safeUrl(release?.html_url);

    // Sin version legible NO se anuncia nada: ante la duda, al dia.
    if (!version) return { status: 'failed', url };

    return { status: isNewer(version, current) ? 'update' : 'current', version, url };
  } catch (err) {
    if (err.name === 'AbortError') return { status: 'timeout', url: RELEASES_PAGE };
    return { status: 'offline', url: RELEASES_PAGE };
  } finally {
    clearTimeout(timer);
  }
}

/** Una URL de la red solo se acepta si apunta a donde debe. */
function safeUrl(candidate) {
  return typeof candidate === 'string' && candidate.startsWith(ALLOWED_PREFIX)
    ? candidate
    : RELEASES_PAGE;
}

/** Abre la pagina de versiones en el navegador del sistema. */
function openReleases(url) {
  return shell.openExternal(safeUrl(url));
}

module.exports = { check, openReleases, RELEASES_PAGE, ALLOWED_PREFIX, safeUrl };

/**
 * El elenco de personajes.
 *
 * Cada avatar es solo un cuerpo SVG: la sombra, el grupo que se inclina, los
 * estados, las expresiones y todas las animaciones viven en avatar.css y son
 * las MISMAS para todos. Anadir un personaje es dibujar un torso y una cabeza,
 * no escribir logica.
 *
 *
 * EL CONTRATO DE COORDENADAS
 *
 * Todo esto solo funciona si los avatares comparten sistema de referencia,
 * porque el CSS que los anima esta escrito en numeros absolutos: la cabeza
 * pivota sobre (60, 60), la cadera sobre (60, 118) y los ojos se cierran
 * alrededor de su centro. Un avatar que ponga la cabeza en otro sitio se
 * inclinaria desde el ombligo y parpadearia por la oreja.
 *
 *   viewBox   0 0 120 140
 *   sombra    elipse en (60, 126)
 *   cadera    (60, 118)   <- el cuerpo entero rota aqui al encorvarse
 *   cabeza    centro (60, 42), pivote (60, 60)
 *   ojos      (49, 40) y (71, 40)
 *   boca      alrededor de (60, 55)
 *
 * test/avatars.test.mjs comprueba que ninguno se salte el contrato y que
 * ningun personaje se quede sin una pieza que el CSS da por hecha.
 *
 *
 * NADA DE IDs
 *
 * Las piezas se identifican por CLASE, nunca por id. La ventana de ajustes
 * pinta los seis avatares a la vez para elegir, y un id repetido seis veces
 * solo le aplicaria al primero -- el resto se quedarian sin cara y sin que
 * nada fallase.
 */

/** La cara: identica en todos, para que las expresiones sean comparables. */
function face({ eyeRx = 4.6, eyeRy = 5.6, pupil = 2.4 } = {}) {
  return `
    <g class="face">
      <g class="eye-group eye-l">
        <ellipse class="eye" cx="49" cy="40" rx="${eyeRx}" ry="${eyeRy}" />
        <circle class="pupil" cx="49" cy="40" r="${pupil}" />
      </g>
      <g class="eye-group eye-r">
        <ellipse class="eye" cx="71" cy="40" rx="${eyeRx}" ry="${eyeRy}" />
        <circle class="pupil" cx="71" cy="40" r="${pupil}" />
      </g>
      <path class="mouth" d="M52 54 Q 60 59, 68 54" />
    </g>
    <g class="brows">
      <path d="M43 30 L 55 27" />
      <path d="M77 30 L 65 27" />
    </g>
    <!-- Solo se ven en el estado que les toca; los coloca avatar.css. -->
    <path class="sweat" d="M86 28 q 3.5 5.5, 0 7.6 q -3.5 -2.1, 0 -7.6" />
    <g class="zzz">
      <text class="z1" x="86" y="22">z</text>
      <text class="z2" x="95" y="13">z</text>
    </g>
    <text class="lost" x="85" y="24">?</text>
  `;
}

/**
 * El personaje de siempre: una gota con cabeza. Sigue siendo el que viene por
 * defecto -- quien no quiera elegir no tiene que notar que hay donde elegir.
 */
const blob = `
  <path class="torso"
    d="M60 58 C 40 58, 32 78, 34 100 C 35 116, 46 122, 60 122 C 74 122, 85 116, 86 100 C 88 78, 80 58, 60 58 Z" />
  <g class="head">
    <circle class="skull" cx="60" cy="42" r="30" />
    ${face()}
  </g>
`;

/** Gato: orejas triangulares, hocico y bigotes. */
const cat = `
  <path class="torso"
    d="M60 60 C 42 60, 34 80, 36 101 C 37 116, 47 122, 60 122 C 73 122, 83 116, 84 101 C 86 80, 78 60, 60 60 Z" />
  <g class="head">
    <path class="ear" d="M38 26 L 34 6 L 52 17 Z" />
    <path class="ear" d="M82 26 L 86 6 L 68 17 Z" />
    <circle class="skull" cx="60" cy="42" r="30" />
    ${face()}
    <g class="whiskers">
      <path d="M40 50 L 26 47" />
      <path d="M40 54 L 27 55" />
      <path d="M80 50 L 94 47" />
      <path d="M80 54 L 93 55" />
    </g>
    <path class="nose" d="M57 49 L 63 49 L 60 52 Z" />
  </g>
`;

/** Buho: discos oculares y penachos. El animal que mejor mira. */
const owl = `
  <path class="torso"
    d="M60 60 C 41 60, 33 81, 35 102 C 36 117, 47 122, 60 122 C 73 122, 84 117, 85 102 C 87 81, 79 60, 60 60 Z" />
  <g class="head">
    <path class="tuft" d="M40 22 L 33 4 L 50 14 Z" />
    <path class="tuft" d="M80 22 L 87 4 L 70 14 Z" />
    <circle class="skull" cx="60" cy="42" r="30" />
    <g class="disc">
      <circle cx="49" cy="40" r="12" />
      <circle cx="71" cy="40" r="12" />
    </g>
    ${face({ eyeRx: 6.2, eyeRy: 7.2, pupil: 3.2 })}
    <path class="beak" d="M60 48 L 55 55 L 65 55 Z" />
  </g>
`;

/**
 * Planta: la metafora mas directa de todas. No se limita a poner mala cara --
 * se marchita, y las hojas caen cuando tu caes.
 */
const plant = `
  <path class="pot" d="M41 92 L 45 120 L 75 120 L 79 92 Z" />
  <path class="pot-rim" d="M38 86 L 82 86 L 80 95 L 40 95 Z" />
  <path class="stem" d="M60 90 L 60 60" />
  <!--
    La flor es mas pequena que la cabeza de los demas a proposito. Con el
    tamano estandar, al caer 11 px en postura mala tapaba la maceta y las
    hojas: la planta se marchitaba sin que se viera lo unico que la hace
    valer la pena. Los ojos siguen donde manda el contrato.
  -->
  <path class="leaf leaf-l" d="M58 82 C 46 84, 36 77, 34 69 C 44 67, 54 73, 58 82 Z" />
  <path class="leaf leaf-r" d="M62 87 C 74 89, 84 82, 86 74 C 76 72, 66 78, 62 87 Z" />
  <g class="head">
    <g class="petals">
      <ellipse cx="60" cy="16" rx="6" ry="9" />
      <ellipse cx="82" cy="29" rx="6" ry="9" transform="rotate(60 82 29)" />
      <ellipse cx="82" cy="55" rx="6" ry="9" transform="rotate(120 82 55)" />
      <ellipse cx="60" cy="68" rx="6" ry="9" />
      <ellipse cx="38" cy="55" rx="6" ry="9" transform="rotate(60 38 55)" />
      <ellipse cx="38" cy="29" rx="6" ry="9" transform="rotate(120 38 29)" />
    </g>
    <circle class="skull" cx="60" cy="42" r="24" />
    ${face()}
  </g>
`;

/**
 * Tortuga: mete la cabeza en el caparazon. Es literalmente el "cuello de
 * tortuga" que la camara acaba de medir, asi que el gesto de esconderse es el
 * mismo movimiento de cabeza que ya hace el CSS -- aqui solo se ve mejor.
 */
const turtle = `
  <path class="shell"
    d="M28 108 C 26 78, 41 60, 60 60 C 79 60, 94 78, 92 108 Z" />
  <g class="shell-plates">
    <path d="M60 62 L 60 108" />
    <path d="M32 88 L 88 88" />
    <path d="M44 66 L 40 108" />
    <path d="M76 66 L 80 108" />
  </g>
  <path class="torso" d="M24 108 L 96 108 C 96 118, 88 122, 60 122 C 32 122, 24 118, 24 108 Z" />
  <g class="head">
    <path class="neck" d="M52 56 L 68 56 L 68 74 L 52 74 Z" />
    <ellipse class="skull" cx="60" cy="42" rx="27" ry="25" />
    ${face()}
  </g>
`;

/** Robot: antena, cabeza cuadrada y un chispazo cuando la cosa va mal. */
const robot = `
  <path class="torso" d="M38 64 L 82 64 C 86 64, 88 68, 88 74 L 88 112 C 88 118, 84 122, 78 122 L 42 122 C 36 122, 32 118, 32 112 L 32 74 C 32 68, 34 64, 38 64 Z" />
  <!-- Se llama chest y no panel a proposito: en la ventana de ajustes cada
       pestana es un div de clase panel, y avatar.css se carga alli tambien. -->
  <g class="chest">
    <circle cx="50" cy="86" r="3.5" />
    <circle cx="60" cy="86" r="3.5" />
    <circle cx="70" cy="86" r="3.5" />
    <path d="M44 100 L 76 100" />
  </g>
  <g class="head">
    <path class="antenna" d="M60 16 L 60 6" />
    <circle class="bulb" cx="60" cy="4" r="4.5" />
    <rect class="skull" x="32" y="16" width="56" height="52" rx="12" />
    ${face()}
    <g class="spark">
      <path d="M92 18 L 86 26 L 91 26 L 85 34" />
    </g>
  </g>
`;

/**
 * El orden manda en la ventana de ajustes. `blob` va primero por ser el que
 * viene de fabrica.
 */
export const AVATARS = Object.freeze([
  { id: 'blob', body: blob },
  { id: 'cat', body: cat },
  { id: 'owl', body: owl },
  { id: 'plant', body: plant },
  { id: 'turtle', body: turtle },
  { id: 'robot', body: robot },
]);

export const DEFAULT_AVATAR = 'blob';

const byId = new Map(AVATARS.map((a) => [a.id, a]));

/** Un avatar que ya no exista cae al de fabrica en vez de dejar el hueco. */
export const isKnownAvatar = (id) => byId.has(id);

/**
 * El SVG completo, listo para meter en el DOM.
 *
 * La sombra y el grupo `creature` los pone esta funcion y no cada avatar: son
 * exactamente lo que el CSS anima, y dejarlos en manos de cada personaje seria
 * invitar a que uno se olvide y se quede tieso sin que nada falle.
 */
export function avatarSvg(id) {
  const avatar = byId.get(id) ?? byId.get(DEFAULT_AVATAR);
  return `<svg viewBox="0 0 120 140" aria-hidden="true">
  <ellipse class="shadow" cx="60" cy="126" rx="30" ry="6" />
  <g class="creature">${avatar.body}</g>
</svg>`;
}

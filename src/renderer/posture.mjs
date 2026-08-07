/**
 * Landmarks de MediaPipe Pose -> metricas -> score 0-100.
 *
 * Funciones puras, sin DOM: se pueden testear con landmarks fijos.
 *
 * DISENADO PARA CAMARA FRONTAL. La mayoria de proyectos que hay por ahi calculan
 * inclinacion de cuello y torso, lo cual exige una camara de perfil. De frente no
 * se ve la curvatura de la espalda, asi que medimos otras cosas -- y todas contra
 * una linea base personal, porque de frente no existe una postura "correcta"
 * universal: depende de tu cuerpo, tu silla y donde tengas la webcam.
 *
 *
 * LA DECISION QUE SOSTIENE TODO LO DEMAS: LA UNIDAD DE ESCALA
 *
 * Para que una medida en pixeles signifique algo hay que dividirla por algo. La
 * eleccion evidente seria el ancho de hombros, y es la que usan casi todos los
 * proyectos parecidos. Es un error: el ancho de hombros ES POSTURA. Cambia si
 * rediondeas los hombros hacia delante, si giras el torso, si te encoges, e
 * incluso con la ropa que lleves. Usarlo de denominador mete el ruido postural
 * en TODAS las metricas a la vez, y encima de forma correlacionada.
 *
 * La separacion entre los ojos, en cambio, es una dimension RIGIDA del craneo.
 * No cambia con ninguna postura; solo con la distancia a la camara (que es justo
 * lo que queremos medir) y con el giro de la cara (que detectamos y descartamos).
 *
 * Asi que la unidad es `eyeWidth`. Esto tambien resuelve la deteccion de hombros
 * adelantados: al sacarlos del denominador, su movimiento por fin se ve.
 *
 *
 * SOBRE DETECTAR HOMBROS REDONDEADOS (protraccion escapular)
 *
 * La tentacion es mirar si el ancho de hombros se estrecha. No funciona: la
 * protraccion es una ABDUCCION de la escapula, que se desliza lateralmente
 * rodeando la caja toracica. En proyeccion frontal el componente lateral y el
 * de envolvimiento tiran en sentidos opuestos, y cual gana depende de la
 * anatomia de cada uno. La literatura clinica lo mide de perfil, no de frente.
 *
 * Lo que SI se ve de frente es la consecuencia: los hombros suben hacia las
 * orejas y el cuello aparente se acorta. Eso es `neckLength`, y es fiable.
 * `shoulderSpan` se calcula, pero NO puntua: solo sirve para avisar de que la
 * calibracion se ha quedado obsoleta.
 */

// Indices BlazePose (33 puntos). Izquierda/derecha son las DEL SUJETO.
export const LM = {
  NOSE: 0,
  LEFT_EYE: 2,
  RIGHT_EYE: 5,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
};

// Landmarks sin los cuales no se puede medir nada.
const REQUIRED = [LM.NOSE, LM.LEFT_EYE, LM.RIGHT_EYE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER];
const MIN_VISIBILITY = 0.5;

/**
 * Pesos y umbrales por metrica.
 *
 *   good:  desviacion que aun se considera normal (suelo de ruido)
 *   bad:   desviacion que ya cuenta como postura claramente mala
 *   alpha: velocidad del suavizado EMA propio de esta metrica
 *   dir:   'up'   penaliza solo la desviacion positiva
 *          'down' penaliza solo la negativa
 *          'both' penaliza en los dos sentidos
 *
 * Entre `good` y `bad` la penalizacion sube con una curva suave, no de golpe.
 *
 * SOBRE LOS UMBRALES DE ANGULO -- por que son tan anchos:
 * el desplazamiento mediano entre frames de MediaPipe es ~0.01 en coordenadas
 * normalizadas, que sobre un ancho de hombros tipico ya son ~1,5 grados, con
 * cola hasta 4. Un umbral de 3 grados quedaria POR DEBAJO del ruido del propio
 * modelo. A eso se suma que sostener el raton sube un hombro varios grados de
 * forma continua y perfectamente normal.
 */
export const METRICS = {
  // La metrica principal. Se acorta tanto al encorvarte (la cabeza baja) como
  // al redondear o encoger los hombros (suben hacia las orejas). De frente esas
  // dos cosas no se pueden separar del todo, y tampoco hace falta: ambas son el
  // mismo problema cervical y se corrigen con el mismo gesto.
  neckLength: { weight: 0.34, good: 0.10, bad: 0.55, dir: 'down', alpha: 0.22,
    label: 'Cuello acortado' },

  proximity: { weight: 0.28, good: 0.05, bad: 0.20, dir: 'up', alpha: 0.22,
    label: 'Acercamiento' },

  // Dos sentidos a proposito: hacia abajo es escurrirse en la silla, hacia
  // arriba es encoger los hombros por tension. Los dos son postura mala.
  shoulderHeight: { weight: 0.16, good: 0.18, bad: 0.75, dir: 'both', alpha: 0.15,
    label: 'Altura de hombros' },

  shoulderTilt: { weight: 0.08, good: 7.0, bad: 22.0, dir: 'both', alpha: 0.08,
    label: 'Inclinacion de hombros' },

  headRoll: { weight: 0.07, good: 5.0, bad: 18.0, dir: 'both', alpha: 0.10,
    label: 'Ladeo de cabeza' },

  driftX: { weight: 0.07, good: 0.35, bad: 1.30, dir: 'both', alpha: 0.15,
    label: 'Deriva lateral' },
};

/** Alphas por metrica, en el formato que espera EMA. */
export const ALPHAS = Object.fromEntries(
  Object.entries(METRICS).map(([k, v]) => [k, v.alpha])
);

/**
 * Alpha de referencia: el de las metricas rapidas. El deslizador de
 * "estabilidad" escala todos los alphas respecto a este, de modo que las
 * proporciones entre metricas se mantienen al moverlo.
 */
export const REFERENCE_ALPHA = METRICS.neckLength.alpha;

/**
 * Umbral de escorzo facial a partir del cual se considera que estas MIRANDO
 * HACIA ABAJO (al teclado, a un papel) en vez de encorvado. Ver `facePitch`.
 */
export const PITCH_DOWN_THRESHOLD = 0.16;

/**
 * Si la cara esta muy girada, el escorzo horizontal encoge la separacion entre
 * ojos -- que es nuestra unidad de escala -- y falsea todo lo que dependa de
 * ella. Por encima de este giro, las metricas sensibles no puntuan.
 */
export const MAX_YAW = 0.30;

/** Metricas que dejan de ser fiables con la cara girada. */
export const YAW_SENSITIVE = ['proximity', 'neckLength', 'shoulderHeight', 'driftX'];

/** Cuanto puede alejarse shoulderSpan de la base antes de sospechar. */
export const SPAN_DRIFT_LIMIT = 0.22;

const RAD2DEG = 180 / Math.PI;

/**
 * MediaPipe normaliza x e y por ancho y alto POR SEPARADO, asi que en una imagen
 * 16:9 un pixel horizontal "mide" menos que uno vertical. Sin corregir esto los
 * angulos salen mal. Multiplicando x por el aspect ratio, ambos ejes quedan en la
 * misma unidad (alturas de imagen).
 */
function pt(landmarks, index, aspect) {
  const p = landmarks[index];
  return { x: p.x * aspect, y: p.y };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Angulo de una RECTA (no de un vector), normalizado a [-90, 90].
 *
 * Es imprescindible, no cosmetico. MediaPipe llama "izquierdo" al hombro
 * izquierdo DEL SUJETO, que en una imagen sin espejar cae a la DERECHA. Con
 * ese orden, atan2 devuelve valores cerca de +-180 en vez de cerca de 0, justo
 * encima de la discontinuidad: dos frames casi identicos pueden dar +179.5 y
 * -179.5. Promediar eso para la calibracion da una base sin sentido y las
 * desviaciones se disparan a decenas de grados sin que nadie se haya movido.
 *
 * Una recta y esa misma recta girada 180 grados son la misma recta, asi que
 * plegar a [-90, 90] elimina la ambiguedad y deja los valores cerca de 0.
 */
function lineAngleDeg(a, b) {
  const deg = Math.atan2(b.y - a.y, b.x - a.x) * RAD2DEG;
  if (deg > 90) return deg - 180;
  if (deg < -90) return deg + 180;
  return deg;
}

/** Diferencia entre dos angulos de recta, tambien plegada a [-90, 90]. */
function angleDelta(a, b) {
  let d = a - b;
  if (d > 90) d -= 180;
  else if (d < -90) d += 180;
  return d;
}

/**
 * Extrae las magnitudes crudas de un frame. Sin comparar con nada todavia:
 * esto es lo que se promedia durante la calibracion Y lo que luego se compara
 * contra esa base, asi que ambos caminos usan exactamente el mismo codigo.
 *
 * Todas las longitudes van en unidades de `eyeWidth` (anchos de cara).
 */
export function rawFeatures(landmarks, aspect = 16 / 9) {
  if (!landmarks || landmarks.length < 33) return null;

  for (const i of REQUIRED) {
    const v = landmarks[i]?.visibility;
    if (v !== undefined && v < MIN_VISIBILITY) return null;
  }

  const nose = pt(landmarks, LM.NOSE, aspect);
  const lEye = pt(landmarks, LM.LEFT_EYE, aspect);
  const rEye = pt(landmarks, LM.RIGHT_EYE, aspect);
  const lSh = pt(landmarks, LM.LEFT_SHOULDER, aspect);
  const rSh = pt(landmarks, LM.RIGHT_SHOULDER, aspect);

  const eyeWidth = dist(lEye, rEye);
  const shoulderWidth = dist(lSh, rSh);
  // Cara demasiado pequena o hombros superpuestos: estas de perfil, muy lejos,
  // o el modelo ha fallado. Sin escala fiable no se mide nada.
  if (eyeWidth < 1e-4 || shoulderWidth < 1e-4) return null;

  const shoulderMid = mid(lSh, rSh);
  const eyeMid = mid(lEye, rEye);

  return {
    // Escala. Es la unica magnitud absoluta: de ella sale `proximity`.
    eyeWidth,

    // Longitud aparente del cuello: de la linea de los ojos a la de los
    // hombros, en anchos de cara. Baja al encorvarte Y al subir los hombros.
    neckLength: (shoulderMid.y - eyeMid.y) / eyeWidth,

    shoulderTilt: lineAngleDeg(lSh, rSh),
    headRoll: lineAngleDeg(lEye, rEye),

    // Posicion de los hombros en el encuadre, SIN normalizar.
    //
    // A diferencia del resto, aqui no se divide por eyeWidth. Estas son
    // coordenadas absolutas, medidas desde la esquina del encuadre, que no es
    // un punto del cuerpo: al acercarte a la camara, eyeWidth crece y el
    // cociente se desploma aunque no te hayas movido ni un milimetro.
    // La division por la escala se hace en deviations(), DESPUES de restar la
    // base -- asi lo que se normaliza es el desplazamiento, que si es una
    // magnitud del cuerpo.
    shoulderMidX: shoulderMid.x,
    shoulderMidY: shoulderMid.y,

    // Ancho de hombros relativo a la cara. NO puntua -- la protraccion afecta
    // a esto de forma ambigua segun la anatomia. Solo se usa para detectar que
    // la calibracion se ha quedado vieja (otro sitio, otra silla, otra camara).
    shoulderSpan: shoulderWidth / eyeWidth,

    // CABECEO: separa mirar hacia abajo de encorvarse.
    //
    // Las dos cosas acortan el cuello aparente, asi que neckLength no las
    // distingue. Pero geometricamente son distintas: encorvarse desplaza la
    // cabeza entera (traslacion), mientras que mirar al teclado la hace girar
    // sobre el cuello (flexion cervical). Al girar, el eje vertical de la cara
    // se escorza y la distancia proyectada ojos-nariz se acorta; la separacion
    // entre ojos, al ser horizontal, no cambia con el cabeceo.
    //
    // Resultado: este valor BAJA al mirar hacia abajo y se mantiene al
    // encorvarse. Es lo que permite perdonar las miradas al teclado.
    facePitch: (nose.y - eyeMid.y) / eyeWidth,

    // Giro horizontal de la cabeza. No puntua: marca cuando NO fiarse del
    // resto, porque girar la cara escorza la separacion entre ojos.
    faceYaw: Math.abs(nose.x - eyeMid.x) / eyeWidth,
  };
}

/** Promedia N frames crudos para fijar la linea base personal. */
export function averageFeatures(samples) {
  const valid = samples.filter(Boolean);
  if (valid.length === 0) return null;

  const keys = Object.keys(valid[0]);
  const out = {};
  for (const k of keys) {
    out[k] = valid.reduce((sum, s) => sum + s[k], 0) / valid.length;
  }
  out.sampleCount = valid.length;
  return out;
}

/**
 * Desviaciones respecto a la base, ya en el sentido en que cada metrica se
 * interpreta (ver `dir` en METRICS).
 */
export function deviations(raw, base) {
  if (!raw || !base) return null;

  return {
    // Positivo = mas cerca de la pantalla. La cara crece en el encuadre.
    proximity: raw.eyeWidth / base.eyeWidth - 1,

    // Negativo = cuello mas corto que en tu base: te has encorvado, has subido
    // los hombros, o las dos cosas.
    neckLength: raw.neckLength - base.neckLength,

    // Desplazamiento respecto a donde estabas al calibrar, expresado en anchos
    // de cara. Restar primero y dividir despues es lo que lo hace invariante a
    // la distancia sin heredar el origen arbitrario del encuadre.
    //
    // Positivo = hombros mas bajos (te escurres en la silla); negativo = mas
    // altos (los encoges por tension). Los dos sentidos penalizan.
    shoulderHeight: (raw.shoulderMidY - base.shoulderMidY) / raw.eyeWidth,
    driftX: (raw.shoulderMidX - base.shoulderMidX) / raw.eyeWidth,

    // Restar angulos a pelo volveria a cruzar la discontinuidad si la base y
    // la medida caen a lados opuestos de +-90.
    shoulderTilt: angleDelta(raw.shoulderTilt, base.shoulderTilt),
    headRoll: angleDelta(raw.headRoll, base.headRoll),
  };
}

/**
 * Cuanto has bajado la mirada respecto a tu base, como fraccion del escorzo
 * facial. Positivo = mirando hacia abajo.
 *
 * Devuelve 0 si la cara esta demasiado girada: ahi la medida no vale.
 */
export function pitchDown(raw, base) {
  if (!raw || !base?.facePitch) return 0;
  if (raw.faceYaw > MAX_YAW) return 0;
  return (base.facePitch - raw.facePitch) / base.facePitch;
}

/**
 * Indica si la calibracion parece haberse quedado obsoleta.
 *
 * `shoulderSpan` (hombros medidos en anchos de cara) es practicamente una
 * constante anatomica mientras no cambies de sitio: es invariante a la
 * distancia y casi invariante a la postura. Si se aleja mucho de la base, lo
 * mas probable no es que te hayas sentado raro, sino que has cambiado de mesa,
 * de silla o de camara -- y entonces la base entera ya no vale.
 */
export function baselineLooksStale(raw, base) {
  if (!raw || !base?.shoulderSpan) return false;
  if (raw.faceYaw > MAX_YAW) return false; // girar el torso tambien lo estrecha
  return Math.abs(raw.shoulderSpan / base.shoulderSpan - 1) > SPAN_DRIFT_LIMIT;
}

/** Rampa suave (smoothstep) entre good y bad -> 0..1. */
function ramp(value, good, bad) {
  if (value <= good) return 0;
  if (value >= bad) return 1;
  const t = (value - good) / (bad - good);
  return t * t * (3 - 2 * t);
}

/** Magnitud penalizable de una desviacion segun el sentido de la metrica. */
function magnitudeFor(dev, dir) {
  if (dir === 'up') return Math.max(0, dev);
  if (dir === 'down') return Math.max(0, -dev);
  return Math.abs(dev);
}

/**
 * Desviaciones -> score 0-100 mas el desglose por metrica.
 * El desglose es lo que alimenta el panel de depuracion, y es como se ajustan
 * los umbrales viendo cual se dispara con cada gesto.
 *
 * @param options.sensitivity  >1 estrecha los umbrales (salta antes)
 * @param options.suppress     metricas que se perdonan en este frame, p. ej.
 *                             neckLength mientras miras al teclado
 */
export function score(devs, { sensitivity = 1.0, suppress = null } = {}) {
  if (!devs) return null;

  const breakdown = {};
  let penalty = 0;

  for (const [name, cfg] of Object.entries(METRICS)) {
    const dev = devs[name];
    const magnitude = magnitudeFor(dev, cfg.dir);
    const muted = Boolean(suppress?.includes(name));

    // Mas sensibilidad = umbrales mas estrechos = salta antes.
    const badness = muted ? 0 : ramp(magnitude, cfg.good / sensitivity, cfg.bad / sensitivity);

    breakdown[name] = {
      label: cfg.label,
      deviation: dev,
      magnitude,
      badness,
      muted,
      contribution: badness * cfg.weight,
    };
    penalty += badness * cfg.weight;
  }

  return {
    value: Math.round(Math.max(0, Math.min(100, 100 * (1 - penalty)))),
    breakdown,
  };
}

/** Atajo: landmarks -> score. Devuelve null si el frame no sirve. */
export function analyze(landmarks, base, aspect, options) {
  const raw = rawFeatures(landmarks, aspect);
  if (!raw) return null;
  const devs = deviations(raw, base);
  if (!devs) return null;
  return { raw, deviations: devs, ...score(devs, options) };
}

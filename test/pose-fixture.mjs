import { LM } from '../src/renderer/posture.mjs';

/**
 * Poses sinteticas compartidas por los tests de percepcion.
 *
 * Vive fuera de los archivos .test.mjs porque lo usan varios y duplicarlo
 * seria peligroso: el orden de los hombros (ver el aviso de LA MANO, mas
 * abajo) es justo el detalle que ya hizo pasar los tests mientras la camara
 * real fallaba. Una copia divergente reabriria ese agujero.
 */

const ASPECT = 16 / 9;

/**
 * Genera 33 landmarks sinteticos de una persona sentada de frente, para poder
 * provocar cada gesto por separado y comprobar que solo se mueve la metrica
 * que toca.
 *
 *   scale     >1 = mas cerca de la camara (escala TODO, cara incluida)
 *   drop      +  = la cabeza baja hacia los hombros (encorvarse)
 *   shrug     +  = los hombros suben hacia las orejas (encogerlos/redondearlos)
 *   span      multiplica solo el ancho de hombros, sin tocar la cara
 *   tilt      grados de giro de la linea de hombros
 *   roll      grados de ladeo de la cabeza
 *   pitch     0..1 = escorzo vertical de la cara (mirar hacia abajo).
 *             Elegido para que `pitch` sea exactamente el pitchDown esperado.
 *   yaw       desplazamiento de la nariz respecto al centro de los ojos (girar la cara)
 *   dx/dy     desplazamiento del cuerpo entero, en coordenadas normalizadas
 */
function makePose({
  scale = 1, drop = 0, shrug = 0, span = 1, tilt = 0, roll = 0,
  pitch = 0, yaw = 0, dx = 0, dy = 0,
} = {}) {
  const cx = 0.5;
  const cy = 0.75; // linea de hombros
  const halfShoulder = 0.15;
  const noseAbove = 0.30;
  const halfEye = 0.04;

  const rot = (px, py, deg, ox, oy) => {
    const r = (deg * Math.PI) / 180;
    // El eje x se escala por el aspect ratio, asi que se rota en ese espacio y
    // luego se deshace -- igual que hace posture.mjs internamente.
    const ax = (px - ox) * ASPECT;
    const ay = py - oy;
    return {
      x: ox + (ax * Math.cos(r) - ay * Math.sin(r)) / ASPECT,
      y: oy + (ax * Math.sin(r) + ay * Math.cos(r)),
    };
  };

  // OJO CON LA MANO: MediaPipe llama "izquierdo" al hombro izquierdo DEL
  // SUJETO, que en una imagen sin espejar cae a la DERECHA del encuadre. Es
  // decir, lSh.x > rSh.x. Generar los puntos al reves hacia que atan2 diese
  // valores cerca de 0 en vez de cerca de +-180, que es donde esta la
  // discontinuidad -- y los tests pasaban mientras la camara real fallaba.
  const shoulderY = cy - shrug * scale;
  const halfW = halfShoulder * span * scale;
  const lSh = { x: cx + halfW, y: shoulderY };
  const rSh = { x: cx - halfW, y: shoulderY };
  const [lShR, rShR] = [
    rot(lSh.x, lSh.y, tilt, cx, shoulderY),
    rot(rSh.x, rSh.y, tilt, cx, shoulderY),
  ];

  // La cabeza cuelga de una altura fija respecto a la LINEA DE HOMBROS SIN
  // ENCOGER, para que `shrug` acorte el cuello sin arrastrar la cara con el.
  const noseY = cy - (noseAbove - drop) * scale;
  const nose = { x: cx + yaw * scale, y: noseY };
  // Mirar hacia abajo acorta la distancia proyectada ojos-nariz sin tocar la
  // separacion horizontal entre ojos: eso es el escorzo que mide facePitch.
  const eyeY = noseY - 0.03 * (1 - pitch) * scale;
  const lEye = { x: cx + halfEye * scale, y: eyeY }; // ojo izquierdo del sujeto
  const rEye = { x: cx - halfEye * scale, y: eyeY };
  const [lEyeR, rEyeR] = [
    rot(lEye.x, lEye.y, roll, cx, noseY),
    rot(rEye.x, rEye.y, roll, cx, noseY),
  ];

  const marks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  const put = (i, p) => { marks[i] = { x: p.x + dx, y: p.y + dy, z: 0, visibility: 0.99 }; };

  put(LM.NOSE, nose);
  put(LM.LEFT_EYE, lEyeR);
  put(LM.RIGHT_EYE, rEyeR);
  put(LM.LEFT_SHOULDER, lShR);
  put(LM.RIGHT_SHOULDER, rShR);
  return marks;
}

export { ASPECT, makePose };

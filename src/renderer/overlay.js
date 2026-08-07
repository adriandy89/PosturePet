const veil = document.getElementById('veil');

window.dim.onSet((opacity) => {
  // El fundido de salida usa una curva mas rapida: la recompensa por
  // enderezarte tiene que llegar sin demora.
  veil.classList.toggle('clearing', opacity === 0);
  veil.style.opacity = String(opacity);
});

// Las duraciones son variables CSS y no estilos en linea: asi la regla sigue
// viviendo en la hoja, junto a su curva de aceleracion.
window.dim.onFade(({ inMs, outMs }) => {
  const root = document.documentElement.style;
  if (Number.isFinite(inMs)) root.setProperty('--fade-in', `${inMs}ms`);
  if (Number.isFinite(outMs)) root.setProperty('--fade-out', `${outMs}ms`);
});

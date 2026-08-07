const veil = document.getElementById('veil');

window.dim.onSet((opacity) => {
  // El fundido de salida usa una curva mas rapida: la recompensa por
  // enderezarte tiene que llegar sin demora.
  veil.classList.toggle('clearing', opacity === 0);
  veil.style.opacity = String(opacity);
});

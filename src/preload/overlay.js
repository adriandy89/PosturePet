'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// La capa oscurecedora solo necesita recibir la opacidad y la duracion de los
// fundidos. Nada mas se expone.
contextBridge.exposeInMainWorld('dim', {
  onSet: (callback) => ipcRenderer.on('dim:set', (_event, opacity) => callback(opacity)),
  onFade: (callback) => ipcRenderer.on('dim:fade', (_event, fades) => callback(fades)),
});

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// La capa oscurecedora solo necesita recibir un numero. Nada mas se expone.
contextBridge.exposeInMainWorld('dim', {
  onSet: (callback) => ipcRenderer.on('dim:set', (_event, opacity) => callback(opacity)),
});

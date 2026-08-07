'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Superficie minima: el renderer del personaje solo puede enviar frames y
// recibir config/estado. Sin acceso a fs, ni a shell, ni a nada mas.
contextBridge.exposeInMainWorld('bridge', {
  sendFrame: (payload) => ipcRenderer.send('posture:frame', payload),
  sendCalibration: (result) => ipcRenderer.send('calibration:done', result),
  sendCameras: (list) => ipcRenderer.send('cameras:list', list),
  // El fotograma ya viene como data: URL, con el esqueleto pintado encima. Lo
  // que cruza es una imagen, nunca coordenadas.
  sendPreview: (dataUrl) => ipcRenderer.send('preview:frame', dataUrl),
  dragEnd: () => ipcRenderer.send('mascot:drag-end'),

  onConfig: (cb) => ipcRenderer.on('config:update', (_e, cfg) => cb(cfg)),
  onState: (cb) => ipcRenderer.on('mascot:state', (_e, s) => cb(s)),
  onCalibrate: (cb) => ipcRenderer.on('mascot:calibrate', () => cb()),
  onCalibrateCancel: (cb) => ipcRenderer.on('mascot:calibrate-cancel', () => cb()),
  onPreviewToggle: (cb) => ipcRenderer.on('mascot:preview', (_e, on) => cb(on)),
  onChime: (cb) => ipcRenderer.on('mascot:chime', (_e, kind) => cb(kind)),
  onVisible: (cb) => ipcRenderer.on('mascot:visible', (_e, v) => cb(v)),
});

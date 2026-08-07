'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Superficie minima: el renderer del personaje solo puede enviar frames y
// recibir config/estado. Sin acceso a fs, ni a shell, ni a nada mas.
contextBridge.exposeInMainWorld('bridge', {
  sendFrame: (payload) => ipcRenderer.send('posture:frame', payload),
  sendCalibration: (result) => ipcRenderer.send('calibration:done', result),
  sendCameras: (list) => ipcRenderer.send('cameras:list', list),
  dragEnd: () => ipcRenderer.send('mascot:drag-end'),

  onConfig: (cb) => ipcRenderer.on('config:update', (_e, cfg) => cb(cfg)),
  onState: (cb) => ipcRenderer.on('mascot:state', (_e, s) => cb(s)),
  onCalibrate: (cb) => ipcRenderer.on('mascot:calibrate', () => cb()),
  onChime: (cb) => ipcRenderer.on('mascot:chime', () => cb()),
  onVisible: (cb) => ipcRenderer.on('mascot:visible', (_e, v) => cb(v)),
});

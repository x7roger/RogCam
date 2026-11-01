const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rogCamAPI', {
  // Controle de Janela
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Ações do App
  openVideosFolder: () => ipcRenderer.send('open-videos-folder'),
  toggleBoundingBox: () => ipcRenderer.send('toggle-bounding-box'),
  notifyRecordingState: (isRecording) => ipcRenderer.send('recording-state', isRecording),

  // Gravação e Captura
  saveScreenshot: (dataUrl) => ipcRenderer.invoke('save-screenshot', dataUrl),
  processAndSaveVideo: (arrayBuffer, format, crop) => ipcRenderer.invoke('process-and-save-video', { arrayBuffer, format, crop }),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  // Listeners de eventos vindos do processo principal
  onGlobalShortcut: (callback) => {
    ipcRenderer.on('shortcut-pressed', (event, action) => callback(action));
  },
  onBoundingBoxMoved: (callback) => {
    ipcRenderer.on('bounding-box-moved', (event, bounds) => callback(bounds));
  },
  onBoundingBoxToggled: (callback) => {
    ipcRenderer.on('bounding-box-toggled', (event, isVisible) => callback(isVisible));
  }
});

const { app, BrowserWindow, ipcMain, globalShortcut, shell, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

ffmpeg.setFfmpegPath(ffmpegPath);

let mainWindow = null;
let boxWindow = null;

// Pastas padrão de saída
const videosDir = path.join(app.getPath('videos'), 'RogCam');
const picturesDir = path.join(app.getPath('pictures'), 'RogCam');

function ensureDirectories() {
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
  if (!fs.existsSync(picturesDir)) fs.mkdirSync(picturesDir, { recursive: true });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: 'RogCam',
    width: 860,
    height: 310,
    center: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    show: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 400);

  // Registrar atalhos globais
  globalShortcut.register('F2', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut-pressed', 'record');
  });

  globalShortcut.register('Shift+F2', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut-pressed', 'pause');
  });

  globalShortcut.register('F8', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut-pressed', 'capture');
  });
}

function createBoxWindow() {
  boxWindow = new BrowserWindow({
    title: 'RogCam Region Selector',
    width: 1280,
    height: 720,
    x: 100,
    y: 100,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-box.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  boxWindow.loadFile('box.html');

  function emitBounds() {
    if (boxWindow && !boxWindow.isDestroyed()) {
      const bounds = boxWindow.getBounds();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bounding-box-moved', bounds);
      }
    }
  }

  boxWindow.on('move', emitBounds);
  boxWindow.on('resize', emitBounds);
}

app.whenReady().then(() => {
  ensureDirectories();
  createMainWindow();
  createBoxWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// IPC: Janela Principal
ipcMain.on('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (boxWindow && !boxWindow.isDestroyed()) boxWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  app.quit();
});

// IPC: Abrir pasta de vídeos gravados
ipcMain.on('open-videos-folder', () => {
  ensureDirectories();
  shell.openPath(videosDir);
});

// IPC: Alternar visibilidade da moldura verde
ipcMain.on('toggle-bounding-box', () => {
  if (boxWindow && !boxWindow.isDestroyed()) {
    if (boxWindow.isVisible()) {
      boxWindow.hide();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bounding-box-toggled', false);
      }
    } else {
      boxWindow.show();
      const bounds = boxWindow.getBounds();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bounding-box-toggled', true);
        mainWindow.webContents.send('bounding-box-moved', bounds);
      }
    }
  }
});

// IPC: Notificar estado da gravação para a moldura verde
ipcMain.on('recording-state', (event, isRecording) => {
  if (boxWindow && !boxWindow.isDestroyed()) {
    boxWindow.webContents.send('recording-state-changed', isRecording);
  }
});

// IPC: Salvar Screenshot
ipcMain.handle('save-screenshot', async (event, dataUrl) => {
  ensureDirectories();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `RogCam_Screenshot_${timestamp}.png`;
  const filePath = path.join(picturesDir, filename);

  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  return { success: true, filePath, filename };
});

// IPC: Processar e Salvar Gravação com FFmpeg
ipcMain.handle('process-and-save-video', async (event, { arrayBuffer, format = 'mp4' }) => {
  ensureDirectories();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempInputPath = path.join(os.tmpdir(), `rogcam_raw_${Date.now()}.webm`);
  const finalFilename = `RogCam_Record_${timestamp}.${format}`;
  const finalOutputPath = path.join(videosDir, finalFilename);

  fs.writeFileSync(tempInputPath, Buffer.from(arrayBuffer));

  // Verificar se a moldura verde está ativa/visível para aplicar recorte
  let shouldCrop = false;
  let relW = 0, relH = 0, relX = 0, relY = 0;

  if (boxWindow && !boxWindow.isDestroyed() && boxWindow.isVisible()) {
    const boxBounds = boxWindow.getBounds();
    const display = screen.getDisplayMatching(boxBounds);
    const scale = display.scaleFactor || 1;
    const screenBounds = display.bounds;

    // Calcular coordenadas exatas compensando bordas internas
    relW = Math.round((boxBounds.width - 6) * scale);
    relH = Math.round((boxBounds.height - 6) * scale);
    relX = Math.round((boxBounds.x - screenBounds.x + 3) * scale);
    relY = Math.round((boxBounds.y - screenBounds.y + 3) * scale);

    // Garantir que a largura e altura sejam números pares (requisito do encoder H.264)
    relW = relW - (relW % 2);
    relH = relH - (relH % 2);
    relX = Math.max(0, relX - (relX % 2));
    relY = Math.max(0, relY - (relY % 2));

    if (relW > 50 && relH > 50) {
      shouldCrop = true;
    }
  }

  return new Promise((resolve) => {
    let command = ffmpeg(tempInputPath);

    if (shouldCrop) {
      // Filtro seguro de corte garantindo que nunca exceda a imagem
      command = command.videoFilters(`crop=w='min(iw,${relW})':h='min(ih,${relH})':x='min(iw-out_w,max(0,${relX}))':y='min(ih-out_h,max(0,${relY}))'`);
    }

    if (format === 'mp4') {
      command = command
        .outputOptions([
          '-c:v libx264',
          '-preset veryfast',
          '-crf 22',
          '-pix_fmt yuv420p',
          '-c:a aac',
          '-b:a 192k'
        ]);
    } else if (format === 'gif') {
      command = command
        .outputOptions([
          '-vf fps=15,scale=flags=lanczos',
          '-loop 0'
        ]);
    } else if (format === 'mp3') {
      command = command
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate(192);
    }

    command
      .save(finalOutputPath)
      .on('end', () => {
        try { fs.unlinkSync(tempInputPath); } catch (e) {}
        resolve({ success: true, filePath: finalOutputPath, filename: finalFilename });
      })
      .on('error', (err) => {
        console.error('Erro no processamento FFmpeg:', err);
        try { fs.unlinkSync(tempInputPath); } catch (e) {}
        // Fallback seguro se falhar
        fs.writeFileSync(finalOutputPath, Buffer.from(arrayBuffer));
        resolve({ success: true, filePath: finalOutputPath, filename: finalFilename, fallback: true });
      });
  });
});

// IPC: Listar Telas do Desktop com tamanho total
ipcMain.handle('get-desktop-sources', async () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const scale = primaryDisplay.scaleFactor || 1;
  const width = Math.round(primaryDisplay.size.width * scale);
  const height = Math.round(primaryDisplay.size.height * scale);

  const sources = await desktopCapturer.getSources({ 
    types: ['screen', 'window'], 
    thumbnailSize: { width, height } 
  });

  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null
  }));
});

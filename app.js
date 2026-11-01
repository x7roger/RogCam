// ==========================================================================
// RogCam - Motor de Gravação Desktop com FFmpeg & Recorte Regional
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  const isElectron = !!window.rogCamAPI;

  // Estado do RogCam
  let currentFormat = 'mp4'; // 'mp4', 'gif', 'mp3'

  let mediaRecorder = null;
  let recordedChunks = [];
  let screenStream = null;
  let micStream = null;

  let isRecording = false;
  let isPaused = false;
  let secondsElapsed = 0;
  let timerInterval = null;

  // 1. Controles de Janela Nativos (Electron)
  const winMin = document.querySelector('.win-minimize');
  const winMax = document.querySelector('.win-maximize');
  const winClose = document.querySelector('.win-close');

  if (isElectron) {
    if (winMin) winMin.addEventListener('click', () => window.rogCamAPI.minimize());
    if (winMax) winMax.addEventListener('click', () => window.rogCamAPI.maximize());
    if (winClose) winClose.addEventListener('click', () => window.rogCamAPI.close());
  }

  // 2. Abas de Modo
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.tab;
      if (mode === 'audio') {
        currentFormat = 'mp3';
        updateCodecBadge('MP3 (Áudio)');
      } else {
        currentFormat = 'mp4';
        updateCodecBadge('MP4 / NVENC');
      }
    });
  });

  // 3. Atualizar Badge de Codecs
  const btnCodecs = document.getElementById('btnCodecs');
  function updateCodecBadge(text) {
    if (btnCodecs) {
      const sub = btnCodecs.querySelector('.card-subtext');
      if (sub) sub.textContent = text;
    }
  }

  if (btnCodecs) {
    btnCodecs.addEventListener('click', () => {
      if (currentFormat === 'mp4') {
        currentFormat = 'gif';
        updateCodecBadge('GIF Animado');
      } else if (currentFormat === 'gif') {
        currentFormat = 'mp3';
        updateCodecBadge('MP3 Áudio');
      } else {
        currentFormat = 'mp4';
        updateCodecBadge('MP4 / H.264');
      }
    });
  }

  // 4. Timer e Cronômetro
  const timerDisplay = document.getElementById('timerDisplay');
  const cardRecord = document.getElementById('cardRecord');
  const recDot = document.querySelector('.rec-dot');
  const btnRecord = document.getElementById('btnRecord');
  const btnStop = document.getElementById('btnStop');
  const btnPause = document.getElementById('btnPause');

  function updateTimerText() {
    const hrs = String(Math.floor(secondsElapsed / 3600)).padStart(2, '0');
    const mins = String(Math.floor((secondsElapsed % 3600) / 60)).padStart(2, '0');
    const secs = String(secondsElapsed % 60).padStart(2, '0');
    timerDisplay.textContent = `${hrs}:${mins}:${secs}`;
  }

  // 5. Iniciar Gravação Real
  async function startRecording() {
    if (isRecording) return;
    recordedChunks = [];

    try {
      if (isElectron) {
        // Notificar início da gravação para a moldura verde ocultar a mira
        window.rogCamAPI.notifyRecordingState(true);

        const sources = await window.rogCamAPI.getDesktopSources();
        const primarySource = sources[0] || { id: 'screen:0:0' };

        // Captura do stream em alta resolução
        screenStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop'
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: primarySource.id,
              minWidth: 1280,
              maxWidth: 3840,
              minHeight: 720,
              maxHeight: 2160,
              minFrameRate: 30,
              maxFrameRate: 60
            }
          }
        });

        // Tentar capturar microfone se disponível
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (e) {
          micStream = null;
        }

        // Combinar streams de áudio se ambos existirem
        let finalStream = screenStream;
        if (micStream && micStream.getAudioTracks().length > 0) {
          const audioCtx = new AudioContext();
          const dest = audioCtx.createMediaStreamDestination();
          
          if (screenStream.getAudioTracks().length > 0) {
            const sysSource = audioCtx.createMediaStreamSource(screenStream);
            sysSource.connect(dest);
          }
          const micSource = audioCtx.createMediaStreamSource(micStream);
          micSource.connect(dest);

          finalStream = new MediaStream([
            ...screenStream.getVideoTracks(),
            ...dest.stream.getAudioTracks()
          ]);
        }

        let mime = 'video/webm;codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mime)) {
          mime = 'video/webm';
        }

        mediaRecorder = new MediaRecorder(finalStream, { mimeType: mime });

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          if (screenStream) screenStream.getTracks().forEach(t => t.stop());
          if (micStream) micStream.getTracks().forEach(t => t.stop());

          timerDisplay.textContent = "Processando...";
          const blob = new Blob(recordedChunks, { type: 'video/webm' });
          const arrayBuffer = await blob.arrayBuffer();

          // O backend detecta automaticamente se a moldura verde está ativa e aplica o crop
          const result = await window.rogCamAPI.processAndSaveVideo(arrayBuffer, currentFormat);

          if (result && result.success) {
            timerDisplay.textContent = "Salvo!";
            setTimeout(() => {
              secondsElapsed = 0;
              updateTimerText();
            }, 1800);
          }
        };

        mediaRecorder.start(1000);
      }

      isRecording = true;
      isPaused = false;
      secondsElapsed = 0;
      updateTimerText();
      cardRecord.classList.add('is-recording');
      recDot.style.animationPlayState = 'running';

      timerInterval = setInterval(() => {
        if (!isPaused) {
          secondsElapsed++;
          updateTimerText();
        }
      }, 1000);

    } catch (err) {
      console.error('Erro ao iniciar gravação:', err);
      if (isElectron) window.rogCamAPI.notifyRecordingState(false);
      alert('Não foi possível iniciar a captura de tela: ' + err.message);
    }
  }

  // 6. Pausar Gravação
  function pauseRecording() {
    if (!isRecording) return;
    isPaused = !isPaused;
    if (mediaRecorder) {
      if (isPaused) mediaRecorder.pause();
      else mediaRecorder.resume();
    }
    recDot.style.animationPlayState = isPaused ? 'paused' : 'running';
    btnPause.style.color = isPaused ? '#22d3ee' : '';
  }

  // 7. Parar Gravação
  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    isPaused = false;
    clearInterval(timerInterval);
    cardRecord.classList.remove('is-recording');
    recDot.style.animationPlayState = 'paused';
    btnPause.style.color = '';

    if (isElectron) {
      window.rogCamAPI.notifyRecordingState(false);
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  btnRecord.addEventListener('click', () => {
    if (!isRecording) startRecording();
    else stopRecording();
  });

  btnStop.addEventListener('click', (e) => {
    e.stopPropagation();
    stopRecording();
  });

  btnPause.addEventListener('click', (e) => {
    e.stopPropagation();
    pauseRecording();
  });

  // 8. Captura de Tela (Screenshot / F8)
  const btnCapture = document.getElementById('btnCapture');
  
  async function triggerCaptureFlash() {
    const flash = document.createElement('div');
    flash.style.position = 'fixed';
    flash.style.inset = '0';
    flash.style.backgroundColor = 'rgba(255, 255, 255, 0.45)';
    flash.style.pointerEvents = 'none';
    flash.style.zIndex = '9999';
    flash.style.transition = 'opacity 0.25s ease';
    document.body.appendChild(flash);
    
    setTimeout(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 250);
    }, 60);

    if (isElectron) {
      try {
        const sources = await window.rogCamAPI.getDesktopSources();
        if (sources.length > 0 && sources[0].thumbnail) {
          const res = await window.rogCamAPI.saveScreenshot(sources[0].thumbnail);
          console.log('Screenshot salva:', res.filePath);
        }
      } catch (err) {
        console.error('Erro ao capturar screenshot:', err);
      }
    }
  }

  btnCapture.addEventListener('click', triggerCaptureFlash);

  // 9. Botão "Abrir"
  const btnOpen = document.getElementById('btnOpen');
  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      if (isElectron) window.rogCamAPI.openVideosFolder();
    });
  }

  // 10. Botão "Tamanho" & Moldura Verde
  const btnSize = document.getElementById('btnSize');
  const coordDisplay = document.querySelector('.coord-display');

  function toggleBoundingBox() {
    if (isElectron) {
      window.rogCamAPI.toggleBoundingBox();
    } else {
      const boundingBox = document.getElementById('boundingBox');
      if (boundingBox) boundingBox.classList.toggle('is-active');
    }
  }

  if (btnSize) btnSize.addEventListener('click', toggleBoundingBox);
  if (coordDisplay) coordDisplay.addEventListener('click', toggleBoundingBox);

  // Receber coordenadas em tempo real do Electron
  if (isElectron) {
    window.rogCamAPI.onBoundingBoxMoved((bounds) => {
      if (coordDisplay) {
        coordDisplay.innerHTML = `
          <span class="coord-val">${bounds.x}</span>,
          <span class="coord-val">${bounds.y}</span>,
          <span class="coord-val">${bounds.width}</span>,
          <span class="coord-val">${bounds.height}</span>
        `;
      }
      const sizeSubtext = btnSize.querySelector('.card-subtext');
      if (sizeSubtext) {
        sizeSubtext.textContent = `${bounds.width}x${bounds.height}`;
      }
    });

    // Atalhos Globais F2 e F8
    window.rogCamAPI.onGlobalShortcut((action) => {
      if (action === 'record') {
        if (!isRecording) startRecording();
        else stopRecording();
      } else if (action === 'pause') {
        pauseRecording();
      } else if (action === 'capture') {
        triggerCaptureFlash();
      }
    });
  }

  // 11. Slider de Volume
  const volTrack = document.querySelector('.vol-slider-track');
  const volFill = document.querySelector('.vol-slider-fill');
  let isDraggingVol = false;

  function updateVolume(e) {
    const rect = volTrack.getBoundingClientRect();
    let percentage = (e.clientX - rect.left) / rect.width;
    percentage = Math.max(0, Math.min(1, percentage));
    volFill.style.width = `${Math.round(percentage * 100)}%`;
  }

  if (volTrack) {
    volTrack.addEventListener('mousedown', (e) => {
      isDraggingVol = true;
      updateVolume(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (isDraggingVol) updateVolume(e);
    });

    window.addEventListener('mouseup', () => {
      isDraggingVol = false;
    });
  }

  // 12. Equalizador de LEDs Dinâmicos
  const eqFills = document.querySelectorAll('.eq-fill');
  setInterval(() => {
    if (isRecording && !isPaused) {
      eqFills.forEach(fill => {
        const rand = Math.floor(Math.random() * 85) + 15;
        fill.style.height = `${rand}%`;
      });
    }
  }, 120);

  // Iniciar timer com 00:00:00
  secondsElapsed = 0;
  updateTimerText();
});

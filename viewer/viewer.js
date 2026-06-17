// viewer.js — Video-based 360° tour (always paused, frame-by-frame via currentTime)
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { initTimeline } from './timeline.js';
import { initOverlays, updateOverlays } from './overlays.js';
import { initHotspots, updateHotspots, closeHotspotPanel } from './hotspots.js';
import { setLang, getLang } from './lang.js';

const CONFIG_PATH = '../tour-config.json';

// ── Video + CanvasTexture ─────────────────────────────────────
// CanvasTexture is used instead of VideoTexture because VideoTexture
// only auto-updates while playing. For a paused seek-based tour,
// we manually draw each frame to canvas after every seek.
const video    = document.createElement('video');
video.muted       = true;
video.playsInline = true;
video.preload     = 'auto';

const vidCanvas = document.createElement('canvas');
const vidCtx    = vidCanvas.getContext('2d');
let   videoTex  = null;

function drawFrame() {
  if (!vidCtx || !video.videoWidth) return;
  vidCtx.drawImage(video, 0, 0, vidCanvas.width, vidCanvas.height);
  if (videoTex) videoTex.needsUpdate = true;
}

// Draw frame immediately after every seek completes
video.addEventListener('seeked', drawFrame);

// ── State ─────────────────────────────────────────────────────
let fps        = 15;
let frameCount = 246;
let currentIdx = 0;

// ── DOM ───────────────────────────────────────────────────────
const viewerEl   = document.getElementById('viewer');
const filePicker = document.getElementById('file-picker');

// ── Three.js Setup ────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewerEl.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'label-renderer';
labelRenderer.domElement.style.pointerEvents = 'none';
viewerEl.appendChild(labelRenderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(100, 1, 0.1, 1100);

const sphereGeo = new THREE.SphereGeometry(500, 64, 32);
sphereGeo.scale(-1, 1, 1);
const sphereMat = new THREE.MeshBasicMaterial({ color: 0x111122 });
const sphere    = new THREE.Mesh(sphereGeo, sphereMat);
scene.add(sphere);

// ── Camera Control ────────────────────────────────────────────
let lon = 0, lat = 0, fov = 100;
let isDragging = false, dragX = 0, dragY = 0;

function updateCamera() {
  const lonRad = THREE.MathUtils.degToRad(lon);
  const latRad = THREE.MathUtils.degToRad(lat);
  camera.lookAt(
    Math.cos(latRad) * Math.sin(lonRad),
    Math.sin(latRad),
    Math.cos(latRad) * Math.cos(lonRad)
  );
}

export function getCurrentLonLat() { return { lon, lat }; }

export function animateCameraTo(targetLon, targetLat, duration = 700) {
  const startLon = lon, startLat = lat;
  const dLon = ((targetLon - startLon + 540) % 360) - 180;
  const startTime = performance.now();
  function tick() {
    const t = Math.min(1, (performance.now() - startTime) / duration);
    const ease = 1 - Math.pow(1 - t, 3);
    lon = startLon + dLon * ease;
    lat = startLat + (targetLat - startLat) * ease;
    updateCamera();
    if (t < 1) requestAnimationFrame(tick);
  }
  tick();
}

renderer.domElement.addEventListener('pointerdown', e => {
  isDragging = true; dragX = e.clientX; dragY = e.clientY;
  viewerEl.classList.add('dragging');
});
document.addEventListener('pointermove', e => {
  if (!isDragging) return;
  lon += (e.clientX - dragX) * 0.18;
  lat  = Math.max(-85, Math.min(85, lat + (e.clientY - dragY) * 0.18));
  dragX = e.clientX; dragY = e.clientY;
  updateCamera();
});
document.addEventListener('pointerup', () => {
  isDragging = false; viewerEl.classList.remove('dragging');
});

renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  fov = THREE.MathUtils.clamp(fov + e.deltaY * 0.04, 30, 100);
  camera.fov = fov; camera.updateProjectionMatrix();
}, { passive: false });

document.addEventListener('keydown', e => {
  if (!frameCount) return;
  if (e.key === 'ArrowRight') goToFrame(currentIdx + 1);
  if (e.key === 'ArrowLeft')  goToFrame(currentIdx - 1);
});

// ── Resize ────────────────────────────────────────────────────
function onResize() {
  const w = viewerEl.clientWidth, h = viewerEl.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
}
window.addEventListener('resize', onResize);

// ── Render loop ───────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  updateCamera();
  updateOverlays(currentIdx);
  updateHotspots(currentIdx);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// ── Frame navigation ──────────────────────────────────────────
export function goToFrame(idx) {
  if (!frameCount) return;
  idx = Math.max(0, Math.min(frameCount - 1, idx));
  currentIdx = idx;
  if (window._timelineOnFrame) window._timelineOnFrame(idx);
  // Set video time — 'seeked' event will call drawFrame()
  video.currentTime = idx / fps;
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  onResize();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('../sw.js').catch(() => {});
  }

  const res    = await fetch(CONFIG_PATH);
  const config = await res.json();

  fps        = config.fps        || 15;
  frameCount = config.frameCount || 246;

  // Wire video to canvas texture once dimensions are known
  video.addEventListener('loadedmetadata', () => {
    vidCanvas.width  = video.videoWidth;
    vidCanvas.height = video.videoHeight;
    videoTex = new THREE.CanvasTexture(vidCanvas);
    videoTex.colorSpace = THREE.SRGBColorSpace;
    videoTex.minFilter  = THREE.LinearFilter;
    sphere.material = new THREE.MeshBasicMaterial({ map: videoTex });
    // Recalculate frameCount from actual video duration
    frameCount = Math.round(video.duration * fps);
  });

  video.src = '../' + config.video;
  video.load();

  // Loader text reacts to IT/EN toggle
  const loaderTitleEl = document.getElementById('loader-title');
  function syncLoaderText() {
    if (!loaderTitleEl) return;
    loaderTitleEl.textContent = getLang() === 'en' ? 'Loading...' : 'Caricamento...';
  }
  syncLoaderText();
  document.addEventListener('langchange', syncLoaderText);

  // Wait for enough video data to start
  await new Promise(resolve => {
    if (video.readyState >= 3) { resolve(); return; }
    video.addEventListener('canplay', resolve, { once: true });
    setTimeout(resolve, 10000); // 10s safety fallback
  });

  initTimeline(frameCount, config.pois || [], goToFrame, animateCameraTo);
  initOverlays(scene, config.overlays || []);
  initHotspots(scene, config.hotspots || []);

  if (filePicker) {
    filePicker.style.transition = 'opacity 0.5s ease';
    filePicker.style.opacity = '0';
    setTimeout(() => { filePicker.style.display = 'none'; }, 520);
  }

  goToFrame(0);
  animate();
}

init().catch(() => {
  if (filePicker) filePicker.style.display = 'none';
});

// Language toggle
document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setLang(btn.dataset.lang);
  });
});

document.getElementById('hs-close')?.addEventListener('click', closeHotspotPanel);

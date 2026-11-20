import * as THREE from 'three';
import type { ClubConfig } from '../types/game';

export function createPitchTexture(
  width: number,
  length: number,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1536;
  const ctx = canvas.getContext('2d')!;

  const w = canvas.width;
  const h = canvas.height;
  const marginX = 48;
  const marginY = 56;
  const pitchW = w - marginX * 2;
  const pitchH = h - marginY * 2;

  // Outer turf apron
  ctx.fillStyle = '#1b4a26';
  ctx.fillRect(0, 0, w, h);

  // Mowed grass alternating stripes
  const stripeCount = 14;
  const stripeH = h / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#246832' : '#1f5a2b';
    ctx.fillRect(0, i * stripeH, w, stripeH + 1);
  }

  // Subtle turf grain noise
  for (let i = 0; i < 6000; i++) {
    const gx = Math.random() * w;
    const gy = Math.random() * h;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
    ctx.fillRect(gx, gy, 2, 2);
  }

  // Chalk pitch markings
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.92)';
  ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
  ctx.lineWidth = 6;

  // Touchlines & goal lines
  ctx.strokeRect(marginX, marginY, pitchW, pitchH);

  // Halfway line
  const midX = w / 2;
  const midY = h / 2;
  ctx.beginPath();
  ctx.moveTo(marginX, midY);
  ctx.lineTo(w - marginX, midY);
  ctx.stroke();

  // Center circle & spot
  const circleRadius = (9.15 / width) * pitchW;
  ctx.beginPath();
  ctx.arc(midX, midY, Math.min(circleRadius, pitchW * 0.2), 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(midX, midY, 8, 0, Math.PI * 2);
  ctx.fill();

  // Penalty areas & goal boxes (top & bottom)
  const penW = Math.max(pitchW * 0.62, (23.0 / width) * pitchW);
  const penH = (16.5 / length) * pitchH;
  const goalBoxW = Math.max(pitchW * 0.32, (12.4 / width) * pitchW);
  const goalBoxH = (5.5 / length) * pitchH;
  const penSpotDist = (11 / length) * pitchH;

  // Top end (Away goal)
  ctx.strokeRect(midX - penW / 2, marginY, penW, penH);
  ctx.strokeRect(midX - goalBoxW / 2, marginY, goalBoxW, goalBoxH);
  ctx.beginPath();
  ctx.arc(midX, marginY + penSpotDist, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(midX, marginY + penSpotDist, circleRadius * 0.85, 0.22 * Math.PI, 0.78 * Math.PI);
  ctx.stroke();

  // Bottom end (Home goal)
  ctx.strokeRect(midX - penW / 2, h - marginY - penH, penW, penH);
  ctx.strokeRect(midX - goalBoxW / 2, h - marginY - goalBoxH, goalBoxW, goalBoxH);
  ctx.beginPath();
  ctx.arc(midX, h - marginY - penSpotDist, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(midX, h - marginY - penSpotDist, circleRadius * 0.85, 1.22 * Math.PI, 1.78 * Math.PI);
  ctx.stroke();

  // Corner arcs
  const cornerR = 18;
  const corners: [number, number, number, number][] = [
    [marginX, marginY, 0, Math.PI * 0.5],
    [w - marginX, marginY, Math.PI * 0.5, Math.PI],
    [w - marginX, h - marginY, Math.PI, Math.PI * 1.5],
    [marginX, h - marginY, Math.PI * 1.5, Math.PI * 2],
  ];
  for (const [cx, cy, sa, ea] of corners) {
    ctx.beginPath();
    ctx.arc(cx, cy, cornerR, sa, ea);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

let cachedFabricBump: THREE.CanvasTexture | null = null;
let cachedSkinBump: THREE.CanvasTexture | null = null;
const cachedFaceTextures = new Map<string, THREE.CanvasTexture>();

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function shiftHex(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp(r + amount)}, ${clamp(g + amount)}, ${clamp(b + amount)})`;
}

export function getSharedFabricBumpTexture(maxAnisotropy: number): THREE.CanvasTexture {
  if (cachedFabricBump) return cachedFabricBump;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Neutral mid-gray base
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);

  // Athletic diamond micro-knit weave
  ctx.lineWidth = 2;
  for (let y = 0; y < 256; y += 8) {
    for (let x = 0; x < 256; x += 8) {
      ctx.fillStyle = (x + y) % 16 === 0 ? '#9c9c9c' : '#686868';
      ctx.fillRect(x, y, 4, 4);
      ctx.fillStyle = '#747474';
      ctx.fillRect(x + 4, y + 4, 3, 3);
    }
  }

  // Subtle vertical ribbed knit grain
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = 0; x < 256; x += 4) {
    ctx.fillRect(x, 0, 1, 256);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  cachedFabricBump = texture;
  return texture;
}

export function getSharedSkinBumpTexture(): THREE.CanvasTexture {
  if (cachedSkinBump) return cachedSkinBump;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 128, 128);

  // Subtle non-uniform dermal micro-texture so skin catches soft light naturally
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 2400; i++) {
    const px = rand() * 128;
    const py = rand() * 128;
    const shade = rand() > 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
    ctx.fillStyle = shade;
    ctx.fillRect(px, py, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.needsUpdate = true;
  cachedSkinBump = texture;
  return texture;
}

export function getSharedFaceTexture(
  skinHex: string,
  hairHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const key = `${skinHex}_${hairHex}`;
  const existing = cachedFaceTextures.get(key);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Base skin fill
  ctx.fillStyle = skinHex;
  ctx.fillRect(0, 0, 512, 256);

  // Subtle subsurface warmth & cranium shading
  const browShade = shiftHex(skinHex, -22);
  const cheekWarm = '#D96B52';
  const jawShade = shiftHex(skinHex, -28);
  const bridgeHi = shiftHex(skinHex, 16);

  // Soft lower-jaw / neck shadow at bottom pole
  const chinGrad = ctx.createLinearGradient(0, 170, 0, 256);
  chinGrad.addColorStop(0, 'rgba(0,0,0,0)');
  chinGrad.addColorStop(1, 'rgba(18, 8, 4, 0.22)');
  ctx.fillStyle = chinGrad;
  ctx.fillRect(0, 170, 512, 86);

  // Center of +Z face is at x = 256 (because head geometry is rotated -PI/2 around Y)
  const cx = 256;

  // Warm cheek flush (left & right cheekbones)
  for (const dir of [-1, 1]) {
    const cg = ctx.createRadialGradient(cx + dir * 44, 152, 2, cx + dir * 44, 152, 26);
    cg.addColorStop(0, 'rgba(217, 107, 82, 0.20)');
    cg.addColorStop(1, 'rgba(217, 107, 82, 0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx + dir * 44, 152, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  void cheekWarm;

  // Subtle temple & side-jaw contour
  for (const dir of [-1, 1]) {
    const jg = ctx.createRadialGradient(cx + dir * 68, 164, 4, cx + dir * 68, 164, 34);
    jg.addColorStop(0, 'rgba(24, 12, 6, 0.14)');
    jg.addColorStop(1, 'rgba(24, 12, 6, 0)');
    ctx.fillStyle = jg;
    ctx.beginPath();
    ctx.arc(cx + dir * 68, 164, 34, 0, Math.PI * 2);
    ctx.fill();
  }

  // Brow ridge shading & nose bridge highlight
  ctx.fillStyle = browShade;
  ctx.globalAlpha = 0.44;
  ctx.beginPath();
  ctx.ellipse(cx - 26, 117, 20, 6.5, -0.06, 0, Math.PI * 2);
  ctx.ellipse(cx + 26, 117, 20, 6.5, 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Nose bridge highlight + under-nose shadow
  ctx.fillStyle = bridgeHi;
  ctx.globalAlpha = 0.42;
  ctx.beginPath();
  ctx.roundRect(cx - 4, 121, 8, 29, 4);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = jawShade;
  ctx.globalAlpha = 0.56;
  ctx.beginPath();
  ctx.ellipse(cx, 155, 10, 4.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Expressive Eyebrows matching hair color (slightly darker for blonde/platinum natural look)
  const browColor =
    getRelativeLuminance(hairHex) > 0.48 ? shiftHex(hairHex, -78) : shiftHex(hairHex, -14);
  ctx.strokeStyle = browColor;
  ctx.lineCap = 'round';
  ctx.lineWidth = 5.6;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + dir * 12, 115);
    ctx.quadraticCurveTo(cx + dir * 28, 108, cx + dir * 43, 115);
    ctx.stroke();
  }

  // Realistic Eyes (almond sclera, rich iris, crisp pupil, bright catchlight, upper lash line)
  for (const dir of [-1, 1]) {
    const ex = cx + dir * 26.5;
    const ey = 128;

    // Eye socket shadow
    ctx.fillStyle = 'rgba(18, 9, 4, 0.22)';
    ctx.beginPath();
    ctx.ellipse(ex, ey, 15, 8.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sclera
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(ex, ey, 11.4, 6.4, dir * -0.05, 0, Math.PI * 2);
    ctx.fill();

    // Iris
    ctx.fillStyle = '#2F1E14';
    ctx.beginPath();
    ctx.arc(ex, ey, 5.4, 0, Math.PI * 2);
    ctx.fill();

    // Pupil
    ctx.fillStyle = '#070A12';
    ctx.beginPath();
    ctx.arc(ex, ey, 2.9, 0, Math.PI * 2);
    ctx.fill();

    // Specular catchlight
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ex + 1.6, ey - 1.6, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Upper & lower eyelid lash contour
    ctx.strokeStyle = '#18100C';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(ex, ey + 1, 11.4, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }

  // Clean Athletic Mouth (natural upper/lower lip definition + confident smirk)
  const lipColor = shiftHex(skinHex, -42);
  ctx.fillStyle = lipColor;
  ctx.beginPath();
  ctx.ellipse(cx, 173, 14.5, 4.6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(28, 12, 8, 0.68)';
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.moveTo(cx - 14.5, 172.5);
  ctx.quadraticCurveTo(cx, 175.5, cx + 14.5, 172.5);
  ctx.stroke();

  // Subtle lower-lip & chin contour highlight
  ctx.fillStyle = bridgeHi;
  ctx.globalAlpha = 0.24;
  ctx.beginPath();
  ctx.ellipse(cx, 188, 9, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Subtle sideburn / nape hairline gradient
  ctx.fillStyle = browColor;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(0, 0, 512, 50);
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  cachedFaceTextures.set(key, texture);
  return texture;
}

export function createJerseyTexture(
  club: ClubConfig,
  useAwayKit: boolean,
  isGoalkeeper: boolean,
  jerseyText: string,
  jerseyNumber: number,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base jersey color respects kit clash or GK role, while custom back text ALWAYS stays consistent
  const primary = isGoalkeeper
    ? club.gkColor
    : useAwayKit
      ? club.awayPrimary
      : club.primaryColor;
  const secondary = isGoalkeeper
    ? '#0F172A'
    : useAwayKit
      ? club.awaySecondary
      : club.secondaryColor;

  const drawPattern = (xOffset: number, halfWidth: number, isBack: boolean) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(xOffset, 0, halfWidth, 512);
    ctx.clip();

    ctx.fillStyle = primary;
    ctx.fillRect(xOffset, 0, halfWidth, 512);

    if (!isGoalkeeper) {
      if (club.pattern === 'stripes') {
        ctx.fillStyle = secondary;
        const stripeW = halfWidth / 5;
        for (let i = 0; i < 5; i += 2) {
          ctx.fillRect(xOffset + i * stripeW, 0, stripeW, 512);
        }
      } else if (club.pattern === 'hoops') {
        ctx.fillStyle = secondary;
        for (let y = 0; y < 512; y += 84) {
          ctx.fillRect(xOffset, y, halfWidth, 38);
        }
      } else if (club.pattern === 'sash') {
        ctx.fillStyle = secondary;
        ctx.fillRect(xOffset + halfWidth * 0.38, 0, halfWidth * 0.24, 512);
      } else if (club.pattern === 'halves') {
        ctx.fillStyle = secondary;
        ctx.fillRect(xOffset + halfWidth * 0.5, 0, halfWidth * 0.5, 512);
      }
    } else {
      // GK aerodynamic chevron detail
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(xOffset, 152, halfWidth, 24);
      ctx.fillRect(xOffset, 196, halfWidth, 12);
    }

    // Authentic UEFA/League-style clean tonal back panel on multi-pattern kits so Back Name & Number stay razor sharp
    if (isBack && !isGoalkeeper && club.pattern !== 'solid') {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.roundRect(xOffset + 56, 76, halfWidth - 112, 344, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Athletic chest / torso depth shading + side-seam ventilation panels
    const sideShade = ctx.createLinearGradient(xOffset, 0, xOffset + halfWidth, 0);
    sideShade.addColorStop(0, 'rgba(0, 0, 0, 0.24)');
    sideShade.addColorStop(0.14, 'rgba(0, 0, 0, 0)');
    sideShade.addColorStop(0.5, 'rgba(255, 255, 255, 0.06)');
    sideShade.addColorStop(0.86, 'rgba(0, 0, 0, 0)');
    sideShade.addColorStop(1, 'rgba(0, 0, 0, 0.24)');
    ctx.fillStyle = sideShade;
    ctx.fillRect(xOffset, 0, halfWidth, 512);

    // Side athletic piping strips
    ctx.fillStyle = club.accentColor;
    ctx.globalAlpha = 0.72;
    ctx.fillRect(xOffset + 4, 0, 8, 512);
    ctx.fillRect(xOffset + halfWidth - 12, 0, 8, 512);
    ctx.globalAlpha = 1;

    // Collar yoke / neckline accent
    ctx.fillStyle = isGoalkeeper ? '#0F172A' : secondary;
    ctx.beginPath();
    ctx.arc(xOffset + halfWidth / 2, 0, 62, 0, Math.PI);
    ctx.fill();
    ctx.strokeStyle = club.accentColor;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.restore();
  };

  // Left half (0..512) = Front of torso, Right half (512..1024) = Back of torso
  drawPattern(0, 512, false);
  drawPattern(512, 512, true);

  // Subtle woven jersey micro-rib texture across canvas
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = 0; y < 512; y += 6) {
    ctx.fillRect(0, y, 1024, 2);
  }

  // Front Club Shield Crest (Left chest from viewer's right = x: 344, y: 156)
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#0B1120';
  ctx.beginPath();
  ctx.arc(348, 158, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = club.accentColor;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#F8FAFC';
  ctx.font = '900 22px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(club.shortName, 348, 160);
  ctx.restore();

  // Front Chest Number (Right chest = x: 176, y: 162)
  const frontIsLight = getRelativeLuminance(primary) > 0.58;
  ctx.save();
  ctx.font = '900 72px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 9;
  ctx.strokeStyle = frontIsLight ? '#FFFFFF' : '#070B14';
  ctx.fillStyle = frontIsLight ? '#0B1324' : '#FFFFFF';
  ctx.strokeText(String(jerseyNumber), 176, 164);
  ctx.fillText(String(jerseyNumber), 176, 164);
  ctx.restore();

  // Back Jersey Custom Text & Squad Number (Right half: 512..1024, center x = 768)
  // High-contrast stencil/block typography engineered for clear 3rd-person distance readability
  const safeName = (jerseyText || 'TITANIC').trim().toUpperCase().slice(0, 12);
  const backLum = getRelativeLuminance(primary);
  const useDarkInk = backLum > 0.56;
  const textFill = useDarkInk ? '#0B1324' : '#FFFFFF';
  const textStroke = useDarkInk ? '#FFFFFF' : '#060A12';
  const outerRim = useDarkInk ? '#0B1324' : club.accentColor;

  const nameFontSize =
    safeName.length <= 6 ? 56 : safeName.length <= 8 ? 48 : safeName.length <= 10 ? 40 : 34;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // Bold Back Nameplate with double-contrast edge + drop shadow
  ctx.font = `900 ${nameFontSize}px Impact, "Arial Black", "Segoe UI", sans-serif`;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.lineWidth = 11;
  ctx.strokeStyle = textStroke;
  ctx.strokeText(safeName, 768, 124);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = textFill;
  ctx.fillText(safeName, 768, 124);

  // Huge Bold Athletic Back Squad Number
  ctx.font = '900 226px Impact, "Arial Black", sans-serif';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  ctx.lineWidth = 20;
  ctx.strokeStyle = textStroke;
  ctx.strokeText(String(jerseyNumber), 768, 294);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Crisp subtle club-accent inner pinstripe on dark kits
  if (!useDarkInk) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = outerRim;
    ctx.globalAlpha = 0.35;
    ctx.strokeText(String(jerseyNumber), 768, 294);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = textFill;
  ctx.fillText(String(jerseyNumber), 768, 294);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

export function createFootballTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, 512, 256);

  // Classic modern geometric panel pattern
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 3;
  for (let x = 0; x < 512; x += 64) {
    for (let y = 0; y < 256; y += 64) {
      ctx.strokeRect(x, y, 64, 64);
    }
  }

  // Bold dark pentagon accents + gold trim
  const spots: [number, number][] = [
    [64, 64],
    [192, 128],
    [320, 64],
    [448, 128],
    [128, 192],
    [384, 192],
  ];
  for (const [cx, cy] of spots) {
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(angle) * 24;
      const py = cy + Math.sin(angle) * 24;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

export function createGoalNetTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.78)';
  ctx.lineWidth = 4;

  for (let i = 0; i <= 128; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 3);
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

export function createAdBoardTexture(
  homeClub: ClubConfig,
  awayClub: ClubConfig,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const panels = [
    { bg: '#090F1E', accent: '#FACC15', text: 'PRO TITANIC SOCCER' },
    { bg: homeClub.primaryColor, accent: homeClub.accentColor, text: `${homeClub.name.toUpperCase()} STADIUM` },
    { bg: '#0F172A', accent: '#38BDF8', text: 'TITANIC ARENA · MATCHDAY LIVE' },
    { bg: awayClub.primaryColor, accent: awayClub.accentColor, text: `${homeClub.shortName} VS ${awayClub.shortName}` },
  ];

  const panelW = canvas.width / panels.length;
  panels.forEach((p, idx) => {
    const x = idx * panelW;
    ctx.fillStyle = p.bg;
    ctx.fillRect(x, 0, panelW, canvas.height);

    // Top & bottom LED trim bars
    ctx.fillStyle = p.accent;
    ctx.fillRect(x, 0, panelW, 10);
    ctx.fillRect(x, canvas.height - 10, panelW, 10);

    // Vertical divider
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x, 0, 4, canvas.height);

    ctx.fillStyle = '#F8FAFC';
    ctx.font = '900 22px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.text, x + panelW / 2, canvas.height / 2 + 1);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(3, 1);
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.58)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

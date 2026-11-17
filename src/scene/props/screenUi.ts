import * as THREE from 'three';

/**
 * The hospital software on the workstation monitor, drawn into a canvas texture.
 * Generic and unbranded. No patient data: rows are document numbers only.
 */
export interface ScreenState {
  pending: number;
  clock: string; // "03:47"
  popups: string[];
}

const W = 1024;
const H = 576;
const FONT = `"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

export interface ScreenUi {
  texture: THREE.CanvasTexture;
  draw(state: ScreenState): void;
}

export function createScreenUi(): ScreenUi {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const text = (s: string, x: number, y: number, size: number, color: string, weight = 400, align: CanvasTextAlign = 'left') => {
    g.font = `${weight} ${size}px ${FONT}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
  };

  const draw = (state: ScreenState) => {
    // Background.
    g.fillStyle = '#e9edf1';
    g.fillRect(0, 0, W, H);

    // Title bar.
    g.fillStyle = '#21557a';
    g.fillRect(0, 0, W, 40);
    text('Hospital Information System', 18, 20, 17, '#ffffff', 600);
    text('Inpatient  ·  Discharge', 280, 20, 15, '#b9cfe0');
    text(`Resident (Night)   ${state.clock}`, W - 18, 20, 15, '#d6e4ef', 400, 'right');

    // Left navigation.
    g.fillStyle = '#d5dbe2';
    g.fillRect(0, 40, 170, H - 70);
    const nav = ['Dashboard', 'Admissions', 'Discharge', 'Orders', 'Lab results', 'Reports', 'Circulars'];
    nav.forEach((n, i) => {
      const y = 78 + i * 40;
      if (n === 'Discharge') {
        g.fillStyle = '#b8c6d4';
        g.fillRect(0, y - 18, 170, 36);
        g.fillStyle = '#21557a';
        g.fillRect(0, y - 18, 4, 36);
      }
      text(n, 22, y, 16, n === 'Discharge' ? '#14324a' : '#3d4b58', n === 'Discharge' ? 600 : 400);
    });

    // Header and the counter card.
    text('Discharge summaries', 196, 72, 24, '#1d2a35', 600);
    g.fillStyle = '#ffffff';
    g.fillRect(196, 96, 300, 96);
    g.fillStyle = '#c4572f';
    g.fillRect(196, 96, 5, 96);
    text('Pending', 220, 122, 16, '#5b6670');
    text(String(state.pending), 220, 162, 46, '#c4572f', 700);

    g.fillStyle = '#ffffff';
    g.fillRect(512, 96, 300, 96);
    text('Due by 9am', 536, 122, 16, '#5b6670');
    text(String(Math.max(0, state.pending - 6)), 536, 162, 46, '#1d2a35', 700);

    // Table.
    const tx = 196;
    const ty = 214;
    g.fillStyle = '#ffffff';
    g.fillRect(tx, ty, W - tx - 24, H - ty - 46);
    g.fillStyle = '#f1f4f7';
    g.fillRect(tx, ty, W - tx - 24, 34);
    ['Document', 'Ward', 'Status', 'Remarks'].forEach((h, i) => text(h, tx + 16 + i * 190, ty + 17, 14, '#5b6670', 600));
    const remarks = ['Signature missing', 'Mandatory field missing', 'Resubmit', 'Signature missing', 'Pending review', 'Mandatory field missing', 'Resubmit'];
    for (let r = 0; r < 7; r++) {
      const y = ty + 52 + r * 36;
      g.fillStyle = r % 2 ? '#fafbfc' : '#ffffff';
      g.fillRect(tx, y - 18, W - tx - 24, 36);
      text(`DS-${(24117 + r * 37).toString().padStart(6, '0')}`, tx + 16, y, 15, '#1d2a35');
      text(`Ward ${3 + ((r * 5) % 6)}`, tx + 206, y, 15, '#3d4b58');
      g.fillStyle = '#f6e3d6';
      g.fillRect(tx + 396, y - 11, 72, 22);
      text('Pending', tx + 432, y, 13, '#a3461f', 600, 'center');
      text(remarks[r], tx + 586, y, 15, r % 3 === 1 ? '#b3261e' : '#3d4b58');
    }

    // Status bar.
    g.fillStyle = '#cfd6dd';
    g.fillRect(0, H - 30, W, 30);
    text('Connected  ·  Server HIS-02  ·  Autosave off', 14, H - 15, 13, '#4a5763');

    // Pop-ups, newest on top, cascading.
    state.popups.forEach((msg, i) => {
      const pw = 420;
      const ph = 150;
      const px = 300 + ((i * 47) % 260);
      const py = 150 + ((i * 31) % 200);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(px + 6, py + 8, pw, ph);
      g.fillStyle = '#f7f8fa';
      g.fillRect(px, py, pw, ph);
      g.fillStyle = '#21557a';
      g.fillRect(px, py, pw, 30);
      text('Message', px + 12, py + 15, 14, '#ffffff', 600);
      text(msg, px + 20, py + 72, 16, '#1d2a35');
      g.fillStyle = '#21557a';
      g.fillRect(px + pw - 100, py + ph - 42, 80, 28);
      text('OK', px + pw - 60, py + ph - 28, 14, '#ffffff', 600, 'center');
    });

    texture.needsUpdate = true;
  };

  return { texture, draw };
}

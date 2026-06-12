const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function makeIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const r = size * 0.18;

  // Background
  ctx.fillStyle = '#0ea5e9';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, r);
  ctx.fill();

  // White droplet / window shape
  const cx = size / 2, cy = size / 2;
  const w = size * 0.55, h = size * 0.55;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.07;
  ctx.lineJoin = 'round';

  // Window frame
  ctx.strokeRect(cx - w/2, cy - h/2, w, h);
  // Cross divider
  ctx.beginPath();
  ctx.moveTo(cx, cy - h/2);
  ctx.lineTo(cx, cy + h/2);
  ctx.moveTo(cx - w/2, cy);
  ctx.lineTo(cx + w/2, cy);
  ctx.stroke();

  // Squeegee line (diagonal)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = size * 0.045;
  ctx.beginPath();
  ctx.moveTo(cx - w/2 + size*0.04, cy - h/2 + size*0.04);
  ctx.lineTo(cx + w/2 - size*0.04, cy + h/2 - size*0.04);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

const dir = path.join(__dirname, 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), makeIcon(512));
console.log('Icons generated.');

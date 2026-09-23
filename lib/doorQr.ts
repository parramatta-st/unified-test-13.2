// The pinned QR encoder runs locally. The private door URL never goes to a QR web service.
import QRCode from 'qrcode-terminal/vendor/QRCode';
export function doorQrSvg(url: string): string {
  if (!/^https?:\/\/[^\s<>"']+$/.test(url) || url.length > 500 || /[^\x20-\x7e]/.test(url)) throw new Error('Invalid door URL.');
  const qr = new QRCode(-1, 0); // Automatic size; M error correction.
  qr.addData(url); qr.make();
  const count = qr.getModuleCount();
  const size = count + 8; // Four-module quiet zone on every side.
  const dots: string[] = [];
  for (let row = 0; row < count; row++) for (let column = 0; column < count; column++) {
    if (qr.isDark(row, column)) dots.push(`M${column + 4} ${row + 4}h1v1h-1z`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${dots.join('')}" fill="black"/></svg>`;
}

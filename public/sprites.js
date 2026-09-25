// Sprites pixel-art generados como SVG desde matrices de caracteres
const PAL = { K: '#0b0d1a', W: '#e8ecff', G: '#8b93b8', R: '#ff3b3b', Y: '#ffe81f', S: '#f2c29b', O: '#ff8c42', D: '#3a4270', H: '#4fc3f7', N: '#5a3a1a', L: '#3ddc84' };

const SHAPES = {
  // astromech (agentes). B = color del agente
  droid: [
    '....KKKK....',
    '..KKBBBBKK..',
    '.KBBWKKWBBK.',
    '.KBBBBBBBBK.',
    '.KKKKKKKKKK.',
    '.KWBWWWWBWK.',
    'KGKWBWWBWKGK',
    'KGKWWBBWWKGK',
    'KGKWWWWWWKGK',
    'KGKKWWWWKKGK',
    'KGK.KKKK.KGK',
    'KKK......KKK',
  ],
  // piloto rebelde (usuarios). B = color del casco
  rebel: [
    '...KKKKKK...',
    '..KBBBBBBK..',
    '..KBWWWWBK..',
    '..KWSKSKWK..',
    '..KWSSSSWK..',
    '...KSSSSK...',
    '..KKBBBBKK..',
    '.KBBBWWBBBK.',
    '.KSKBBBBKSK.',
    '...KBBBBK...',
    '...KBKKBK...',
    '...KK..KK...',
  ],
  // oficial imperial (admins)
  imperial: [
    '...KKKKKK...',
    '..KDDDDDDK..',
    '..KDDDDDDK..',
    '..KSSSSSSK..',
    '..KSKSSKSK..',
    '...KSSSSK...',
    '..KKGGGGKK..',
    '.KGGRYGGGGK.',
    '.KSKGGGGKSK.',
    '...KGGGGK...',
    '...KKKKKK...',
    '...KK..KK...',
  ],
  // escritorio con monitor (B = luz de pantalla)
  desk: [
    '....KKKKKKKK....',
    '....KBBBBBBK....',
    '....KBBBBBBK....',
    '....KKKKKKKK....',
    '.......KK.......',
    'KKKKKKKKKKKKKKKK',
    'KNNNNNNNNNNNNNNK',
    'KKKKKKKKKKKKKKKK',
    '.KN..........NK.',
    '.KK..........KK.',
  ],
  // decoración del mapa
  plant: [
    '...LL.L.',
    '.L.LLLL.',
    'LLLLL.LL',
    '.LLLLLL.',
    '..LLLL..',
    '..KNNK..',
    '..KNNK..',
    '...KK...',
  ],
  // R2-D2 (astromech azul y blanco)
  r2d2: [
    '....WWWW....',
    '..WWBBBBWW..',
    '.WBBHGGWBBW.',
    '.WBBWWWWBBW.',
    '.WWWWWWWWWW.',
    '.WBBWWWWBBW.',
    'GWWBBWBBWWG.',
    'GWWWWWWWWWG.',
    'GWWWWWWWWWG.',
    'GWWWWWWWWWG.',
    'GWW.WWWW.WWG',
    'KKK......KKK',
  ],
  // C-3PO (droide de protocolo dorado con pierna plateada)
  c3po: [
    '...YYYYYY...',
    '..YYYYYYYY..',
    '..YYWYYWYY..',
    '..YYYYYYYY..',
    '...YYYYYY...',
    '..YYYYYYYY..',
    '.YYYYRRKYYY.',
    '.YYYYKKKYYY.',
    '..YYYYYYYY..',
    '...YYYYYY...',
    '..YYY..YYY..',
    '..YYY..GGG..',
  ],
  // BB-8 (droide esférico naranja y blanco)
  bb8: [
    '....WWWW....',
    '...WOOOWO...',
    '...WWHWKW...',
    '....WWWW....',
    '..WWWOOOWW..',
    '.WWOOOOOOWW.',
    '.WOOOWWOOOW.',
    '.WOOOWWOOOW.',
    '.WWOOOOOOWW.',
    '..WWWOOOWW..',
    '...WWWWWW...',
    '....KKKK....',
  ],
  // dispensador de agua Gather (water cooler)
  cooler: [
    '....HHHH....',
    '...HHHHHH...',
    '...HHHHHH...',
    '....HHHH....',
    '....WWWW....',
    '....WKRW....',
    '....WWWW....',
    '....WWWW....',
    '....WWWW....',
    '....WWWW....',
    '...KKKKKK...',
    '..KK....KK..',
  ],
  // Maestro Yoda
  yoda: [
    'L..........L',
    '.LL......LL.',
    '..LLLLLLLL..',
    '..LLWLLWLL..',
    '...LLLLLL...',
    '..NNNNNNNN..',
    '.NNWWWWWWNN.',
    '.NNWWWWWWNN.',
    '..NNNNNNNN..',
    '..NNN..NNN..',
    '..LLL..LLL..',
    '..KK....KK..',
  ],
  // consola del puente (B = luz de estado)
  console: [
    'KKKKKKKKKK',
    'KDDDDDDDDK',
    'KDBBDDBBDK',
    'KDDDDDDDDK',
    'KKKKKKKKKK',
    '.KGGGGGGK.',
    '.KKKKKKKK.',
  ],
};

export function sprite(kind = 'droid', color = '#4fc3f7', px = 4, extra = '') {
  const m = SHAPES[kind] || SHAPES.droid;
  const w = m[0].length, h = m.length;
  let r = '';
  m.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c === 'B' ? color : PAL[c]}"/>`;
  }));
  return `<svg class="sprite ${extra}" viewBox="0 0 ${w} ${h}" width="${w * px}" height="${h * px}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

export function agentSprite(a, px = 4, extra = '') {
  const k = (typeof a === 'string' ? a : (a?.key || a?.name || '')).toLowerCase();
  if (k.includes('antigrav') || k === 'r2d2') return sprite('r2d2', a?.color || '#4fc3f7', px, extra);
  if (k.includes('claude') || k === 'c3po') return sprite('c3po', a?.color || '#ffe81f', px, extra);
  if (k.includes('codex') || k === 'bb8') return sprite('bb8', a?.color || '#3ddc84', px, extra);
  return sprite('droid', a?.color || '#4fc3f7', px, extra);
}

// icono pixel del área
const ICONS = {
  holocron: ['..YYYY..', '.YHHHHY.', 'YHYHHYHY', 'YHHYYHHY', 'YHHYYHHY', 'YHYHHYHY', '.YHHHHY.', '..YYYY..'],
  xwing: ['R......R', 'GR....RG', '.GGWWGG.', '..GWWG..', '..GWWG..', '.GGWWGG.', 'GR....RG', 'R......R'],
  radar: ['..HHHH..', '.H....H.', 'H..HH..H', 'H.H..Y.H', 'H.H..H.H', 'H..HH..H', '.H....H.', '..HHHH..'],
  cantina: ['...YY...', '..YWWY..', '.YWWWWY.', '.YWWWWY.', '..YWWY..', '...YY...', '..YYYY..', '.YYYYYY.'],
};
export function icon(name, px = 3) {
  const m = ICONS[name] || ICONS.radar;
  let r = '';
  m.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${PAL[c]}"/>`; }));
  return `<svg class="icon" viewBox="0 0 8 8" width="${8 * px}" height="${8 * px}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}
export const ICON_NAMES = Object.keys(ICONS);

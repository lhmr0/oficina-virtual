// Sprites pixel-art generados como SVG desde matrices de caracteres
const PAL = { K: '#0b0d1a', W: '#e8ecff', G: '#8b93b8', R: '#ff3b3b', Y: '#ffe81f', S: '#f2c29b', O: '#ff8c42', D: '#3a4270', H: '#4fc3f7', N: '#5a3a1a' };

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

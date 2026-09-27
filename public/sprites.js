// Sprites pixel-art generados como SVG desde matrices de caracteres
const PAL = { K: '#0b0d1a', W: '#e8ecff', G: '#8b93b8', R: '#ff3b3b', Y: '#ffe81f', S: '#f2c29b', O: '#ff8c42', D: '#3a4270', H: '#4fc3f7', N: '#5a3a1a', L: '#3ddc84', M: '#a355dd', P: '#e06666', C: '#382212', T: '#1f6f8b', F: '#ffeaa7', A: '#5f6680' };

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
  // mona con moño (Claude)
  mono: [
    '........P.P.',
    '..NNNNNNPKP.',
    '.NNNNNNNPNP.',
    '.NNSSNNSSNN.',
    'SNSWKSSWKSNS',
    'SNSSKSSSKSNS',
    '.NNSSSSSSNN.',
    '..NSKSSKSN..',
    '..NSSPPSSN..',
    '...NSSSSN..N',
    '..NNSSSSNNN.',
    '..KK....KK..',
  ],
  // elefante (Codex)
  elefante: [
    '.AAA....AAA.',
    'AAAAGGGGAAAA',
    'AAAGGGGGGAAA',
    'AAAGKGGKGAAA',
    'AAAGGGGGGAAA',
    '.AAGGGGGGAA.',
    '..WGGGGGGW..',
    '..W.GGGG.W..',
    '....GGGG....',
    '....GGG.....',
    '.....GG.....',
    '......GG....',
  ],
  // CR7 (Antigravity): camiseta roja con el 7
  cr7: [
    '....CCCC....',
    '...CSSSSC...',
    '...SKSSKS...',
    '...SSSSSS...',
    '....SSSS....',
    '.RRRRRRRRRR.',
    'RRRWWWWWWRRR',
    'SRRRRRRRWRRS',
    'SRRRRRRWRRRS',
    '.RRRRRWRRRR.',
    '..LLLLLLLL..',
    '..SS....SS..',
  ],
  // dispensador de agua Gather (water cooler)
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
  // estantería de holocrones / biblioteca (Archivo Jedi)
  bookshelf: [
    'KNNNNNNNNNNK',
    'KN.Y.H.R.WNK',
    'KNNNNNNNNNNK',
    'KN.W.L.Y.HNK',
    'KNNNNNNNNNNK',
    'KN.H.R.W.LNK',
    'KNNNNNNNNNNK',
    'KN........NK',
    'KK........KK',
  ],
  // rack de servidores con luces LED
  server: [
    'KKKKKKKKKK',
    'KDDDDDDDDK',
    'KDGRLGDRDK',
    'KDDDDDDDDK',
    'KDGHLGDLDK',
    'KDDDDDDDDK',
    'KDGYLGDRDK',
    'KDDDDDDDDK',
    'KKKKKKKKKK',
    'KK......KK',
  ],
  // pizarra de arquitectura / sprint Gather
  whiteboard: [
    'KKKKKKKKKKKKKKKK',
    'KWWWWWWWWWWWWWWK',
    'KWHHH..YY..RRR.K',
    'KWHHH..YY..RRR.K',
    'KW.............K',
    'KW.LLLL..OOOO..K',
    'KW.LLLL..OOOO..K',
    'KKKKKKKKKKKKKKKK',
    '..KD........DK..',
    '..KD........DK..',
    '.KKD........DKK.',
  ],
  // caja de carga Star Wars / Hangar
  crate: [
    'KKKKKKKKKKKK',
    'KGGGGGGGGGGK',
    'KGOOOOOOOOGK',
    'KGOKKKKKKOGK',
    'KGOKW..WKOGK',
    'KGOKKKKKKOGK',
    'KGOOOOOOOOGK',
    'KGGGGGGGGGGK',
    'KKKKKKKKKKKK',
  ],
  // cafetera de la cantina
  coffee: [
    '..KKKKKK....',
    '.KDDDDDDK...',
    'KDWWWWWWDHK.',
    'KDWKDDDKDHK.',
    'KDWKDDDKDK..',
    'KDDDDDDDDK..',
    'KDDKRRKDDK..',
    'KDDDDDDDDK..',
    'KKKKKKKKKK..',
  ],
  // pedestal de holocron Jedi
  // planta frondosa / ficus
  bigplant: [
    '....LLL.....',
    '..LLLLLLL...',
    '.LLLLLLLLLL.',
    'LLLLLYLLLLLL',
    '.LLLLLLLLLL.',
    '..LLLLLLLL..',
    '...LLLLLL...',
    '....KNNK....',
    '...KNNNNK...',
    '...KNNNNK...',
    '....KKKK....',
  ],
  // mesa de Dejarik / holochess de la cantina
  dejarik: [
    '.....KKKK.....',
    '....KHHHHHK...',
    '...KH.R.O.HK..',
    '....KHHHHHK...',
    '..KKKKKKKKKK..',
    '.KGGGGGGGGGGK.',
    'KGWWKKWWKKWWGK',
    'KGKKWWKKWWKKGK',
    '.KGGGGGGGGGGK.',
    '..KKDDDDDDKK..',
    '..KKDDDDDDKK..',
    '.KKKKKKKKKKKK.',
  ],
  // droide de energía GNK (Gonk)
  gonk: [
    '..KKKKKKKK..',
    '.KGGGGGGGGK.',
    'KGGGGGGGGGGK',
    'KGYKLLKRLGGK',
    'KGGGGGGGGGGK',
    'KKKKKKKKKKKK',
    'KDDDDDDDDDDK',
    'KDDHHDDDDDDK',
    'KDDDDDDDDDDK',
    'KKKKKKKKKKKK',
    '.KGGK..KGGK.',
    'KKKKK..KKKKK',
  ],
  // droide ratón MSE-6
  mousedroid: [
    '....KK......',
    '...KWWK.....',
    '..KKKKKKKK..',
    '.KKKKKKKKKK.',
    'KKKKKKKKKKKK',
    'KDDDDDDDDDDK',
    '.KK.KK..KK..',
  ],
  // mesa táctica / holoproyector de arquitectura
  holotable: [
    '......HH......',
    '....H.HH.H....',
    '...HHHHHHHH...',
    '....H.HH.H....',
    '......HH......',
    '..KKKKKKKKKK..',
    '.KDDDDDDDDDDK.',
    'KDDHHHHHHHHDDK',
    '.KDDDDDDDDDDK.',
    '..KKGGGGGGKK..',
    '...KKGGGGKK...',
    '..KKDDDDDDKK..',
    '.KKKKKKKKKKKK.',
  ],
  // máquina expendedora de raciones y bebidas
  vending: [
    '.KKKKKKKKKK.',
    'KDDDDDDDDDDK',
    'KDGGGGGGGGDK',
    'KDG.HH..RRDK',
    'KDG.LL..YYDK',
    'KDG.OO..WWDK',
    'KDGGGGGGGGDK',
    'KDDDDDDDDDDK',
    'KDR.Y.G.KDDK',
    'KDDDDDDDDDDK',
    'KDKKKKKKKKDK',
    'KDKKKKKKKKDK',
    'KDDDDDDDDDDK',
    'KKKKKKKKKKKK',
  ],
  // máquina arcade retro galáctica
  arcade: [
    '..KKKKKKKK..',
    '.KYYYYYYYYK.',
    'KYYYYYYYYYYK',
    'KKKKKKKKKKKK',
    'KDDDDDDDDDDK',
    'KDKKHHHHKKDK',
    'KDKHHWWHHKDK',
    'KDKKHHHHKKDK',
    'KKKKKKKKKKKK',
    'KDR.Y.G...DK',
    'KDDDDDDDDDDK',
    'KDDDDDDDDDDK',
    'KDDKKKKKKDDK',
    'KKKK....KKKK',
  ],
  // sofá lounge de la cantina
  // banco de trabajo y herramientas del hangar
  workbench: [
    'KKKKKKKKKKKKKKKK',
    'KDDDDDDDDDDDDDDK',
    'KD.G.GG.H.LL.DDK',
    'KD.G.GG.H.LL.DDK',
    'KKKKKKKKKKKKKKKK',
    'KGGGGGGGGGGGGGGK',
    'KGGGGGGGGGGGGGGK',
    'KKKKKKKKKKKKKKKK',
    'KDD..........DDK',
    'KDD..........DDK',
    'KKK..........KKK',
  ],
  // base de recarga para droides
  // pilar de holocrones y datacrones del templo
  archive_pillar: [
    '..KKKKKK..',
    '.KDDDDDDK.',
    '.KHHHHHHK.',
    '.KHYYYYYK.',
    '.KHYYYYYK.',
    '.KHHHHHHK.',
    'KKKKKKKKKK',
    'KDDDDDDDDK',
    'KDGRLGDRDK',
    'KDDDDDDDDK',
    'KDGHLGDLDK',
    'KKKKKKKKKK',
    '.KGGGGGGK.',
    'KKKKKKKKKK',
  ],
  // silla del consejo / reunión
  // ventanal de observación estelar
  // lámpara de mamparo para pasillos
  bulkhead_lamp: [
    '.KKKK.',
    'KYYYYK',
    'KYWWYK',
    'KYYYYK',
    '.KGGK.',
    '..KK..',
  ],
  // cubo de reciclaje astromech
  // taza humeante de caf
  mug: [
    '..W.W..',
    '.W.W.W.',
    'KKKKK..',
    'KDDDDKK',
    'KDDDD.K',
    'KDDDDKK',
    'KKKKK..',
  ],
  // Chopper C1-10P (astromech naranja de CommandCode)
  chopper: [
    '.....KK.....',
    '....KGGK....',
    '..KKYYYYKK..',
    '.KOOOOOOOOK.',
    '.KOWWKWWOOK.',
    '.KKKKKKKKKK.',
    '..KGGGGGGK..',
    'KGKGGGGGGKGK',
    'KGKGOOOGGKGK',
    'KGKGGGGGGKGK',
    'KGKKGGGGKKGK',
    'KKK......KKK',
  ],
  // Darth Vader (avatar del jefe)
  vader: [
    '...KKKKKK...',
    '..KDDDDDDK..',
    '.KDDDDDDDDK.',
    '.KDDGGGGDDK.',
    '.KDGGKKGGDK.',
    '.KDGGKKGGDK.',
    '.KDDGGGGDDK.',
    '.KDDDDDDDDK.',
    '..KDGGGGDK..',
    '..KD.GG.DK..',
    '...KKKKKK...',
    '..KKK..KKK..',
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
  if (k.includes('antigrav') || k === 'r2d2') return sprite('cr7', a?.color || '#4fc3f7', px, extra);
  if (k.includes('claude') || k === 'c3po') return sprite('mono', a?.color || '#ffe81f', px, extra);
  if (k.includes('codex') || k === 'bb8') return sprite('elefante', a?.color || '#3ddc84', px, extra);
  if (k.includes('command') || k.includes('chopper') || k === 'c1-10p') return sprite('chopper', a?.color || '#ff4d4d', px, extra);
  return sprite('droid', a?.color || '#4fc3f7', px, extra);
}

// avatar elegido por el usuario (rebel, imperial, vader…). Sin avatar, usa el rol.
const USER_SHAPES = { rebel: 'rebel', imperial: 'imperial', vader: 'vader', yoda: 'yoda' };
export function userSprite(u, px = 2, extra = '') {
  const av = String(typeof u === 'string' ? u : (u?.avatar || '')).toLowerCase();
  const kind = USER_SHAPES[av] || (u?.role === 'admin' ? 'imperial' : 'rebel');
  return sprite(kind, u?.color || '#ff8c42', px, extra);
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

// Sprites pixel-art generados como SVG desde matrices de caracteres
const PAL = { K: '#0b0d1a', W: '#e8ecff', G: '#8b93b8', R: '#ff3b3b', Y: '#ffe81f', S: '#f2c29b', O: '#ff8c42', D: '#3a4270', H: '#4fc3f7', N: '#5a3a1a', L: '#3ddc84', M: '#a355dd', P: '#e06666', C: '#382212', T: '#1f6f8b', F: '#ffeaa7', A: '#5f6680',
  // tonos extra de los sprites detallados (vader, mono, cr7, bebe)
  v: '#1d2130', g: '#363d54', h: '#66708f', s: '#b9c1d6', r: '#c0262f', a: '#262b3d',
  f: '#7a4a24', e: '#4e2c12', u: '#a86a38', k: '#f2c9a0', q: '#d9a07a', i: '#fff0d6', p: '#ff9ab8', n: '#e0457b', x: '#9c2350', m: '#c0392b',
  c: '#1c1510', d: '#4a3524', t: '#e3a878', o: '#b77a4e', z: '#e0202f', j: '#a3131f', l: '#1f9a52', w: '#ffd23f' };

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
  // mona con moño y vestido (Claude), busto como cr7 y bebe
  mono: [
    '...............KK..KK...',
    '..........KKKKKpnKKnpK..',
    '........KKffffKnnxxnnK..',
    '.......KffuuuuKnxxxxnK..',
    '......KfffuffufKKnnKK...',
    '.....KffffffffffKKKK....',
    '....KffkkkkffkkkkffK....',
    '..KKKfKkkkkkkkkkkKfKKK..',
    '.KeqKfkKKkkkkkkKKkfKqeK.',
    '.KeqKfkWKkkkkkkKWkfKqeK.',
    '.KeqKfkKKkkkkkkKKkfKqeK.',
    '..KKKfppkkkkkkkkppfKKK..',
    '....KfkiiiiiiiiiikfK....',
    '....KfiiiiKiiKiiiifK....',
    '....KfiKiiiiiiiiKifK....',
    '.....KfiKmmmmmmKifK.....',
    '......KKiKKKKKKiKK......',
    '.......KffffffffK.......',
    '....KKnnWWffffWWnnKK....',
    '..KKnnnnnWWnnWWnnnnnKK..',
    '.KfnnnnnnnnnnnnnnnnnnfK.',
    'KffnnxnnnnnppnnnnnxnnffK',
    'KffnnxnnnnnnnnnnnnxnnffK',
    'KffnnxnnnnnppnnnnnxnnffK',
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
  // CR7 (Antigravity): busto con camiseta de Portugal y el 7
  cr7: [
    '........KKKKKKKK........',
    '......KKccccccccKK......',
    '.....KccddccccccccK.....',
    '....KcccddcccccccccK....',
    '....KccccdcccccccccK....',
    '....KdccttttttttccdK....',
    '...KKdcttttttttttcdKK...',
    '...KdtccccttttcccctdK...',
    '..KKttWKKttttttKKWttKK..',
    '..KotttttttootttttttoK..',
    '...KttttttoooottttttK...',
    '...KtttKWWWWWWWWKtttK...',
    '...KotttKKKKKKKKtttoK...',
    '....KottttttttttttoK....',
    '.....KoottttttttooK.....',
    '......KKooooooooKK......',
    '....KKzzloooooolzzKK....',
    '..KKzzzzzllllllzzzzzKK..',
    '.KzzzzzzzzzzzzzzzzzzzzK.',
    'KzzjzzlzzzwwwwwzzzzzjzzK',
    'KzjzzzwzzzzzzwwzzzzzzjzK',
    'KzjzzzzzzzzzwwzzzzzzzjzK',
    'KzjzzzzzzzzwwzzzzzzzzjzK',
    'KzjzzzzzzzzwwzzzzzzzzjzK',
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
  // bebé con moño y chupón (CommandCode). B = color del agente (pijama)
  bebe: [
    '..........KKddKKK..KK...',
    '.........KKdKKKpnKKnpK..',
    '.......KKkkdkkKnnxxnnK..',
    '......KkkkkkkkKnxxxxnK..',
    '.....KkkkkkkkkkKKnnKK...',
    '....KkkkkkkkkkkkKKKK....',
    '...KkkkkkkkkkkkkkkkkK...',
    '...KkkKkkkkkkkkkkKkkK...',
    '..KkkkkWKkkkkkkWKkkkkK..',
    '.KqkkkkKKkkkkkkKKkkkkqK.',
    '.KqkkkkKKkkkkkkKKkkkkqK.',
    '..KkkkkkkkkkkkkkkkkkkK..',
    '..KkppkkkkKKKKkkkkppkK..',
    '...KppkkKHHHHHHKkkppK...',
    '...KkkkkKHTTTTHKkkkkK...',
    '...KqkkkKHTWWTHKkkkqK...',
    '....KqkkkKHHHHKkkkqK....',
    '.....KqqkkKKKKkkqqK.....',
    '......KKqqqqqqqqKK......',
    '....KKBBBBWWWWBBBBKK....',
    '..KKBBBBBWWWWWWBBBBBKK..',
    '.KBBBBBBWWWWWWWWBBBBBBK.',
    'KBBBBBBBWWWWWWWWBBBBBBBK',
    'KBBBBBBBWWWWWWWWBBBBBBBK',
  ],
  // Darth Vader (avatar del jefe): casco, rejilla y panel de pecho
  vader: [
    '.........KKKKKK.........',
    '.......KKvvvvvvKK.......',
    '......KvvhhvvvvvvK......',
    '.....KvvhhvvvvvvvvK.....',
    '....KvvhhvvvvvvvvvvK....',
    '....KvhhvvvvvvvvvvvK....',
    '...KvvhvvvvvvvvvvvvvK...',
    '...KvvvvvvvvvvvvvvvvK...',
    '...KggggggggggggggggK...',
    '..KvKKKKKKgvvgKKKKKKvK..',
    '..KvKKKrKKKggKKKrKKKvK..',
    '..KvvKKKKKKggKKKKKKvvK..',
    '..KvvvKKKKvssvKKKKvvvK..',
    '..KvvvvvvvKssKvvvvvvvK..',
    '.KvgvvvvvKsKKsKvvvvvgvK.',
    '.KvvgvvvKsKssKsKvvvgvvK.',
    'KvvvvgvKsKsKKsKsKvgvvvvK',
    'KvvvvvgKsKsKKsKsKgvvvvvK',
    'KaKvvvvgKKKKKKKKgvvvvKaK',
    'KaaKKvvvggggggggvvvKKaaK',
    'KaaaaKKKKKKKKKKKKKKaaaaK',
    'KaaaaaKGGGGGGGGGGKaaaaaK',
    'KaaaaaKGRRKLHKYWGKaaaaaK',
    'KaaaaaKGGGGGGGGGGKaaaaaK',
  ],
};

export function sprite(kind = 'droid', color = '#4fc3f7', px = 4, extra = '') {
  const m = SHAPES[kind] || SHAPES.droid;
  const w = m[0].length, h = m.length;
  px *= Math.min(1, 16 / Math.max(w, h)); // los sprites detallados (24×24) ocupan lo mismo que uno de 16
  let r = '';
  m.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c === 'B' ? color : PAL[c]}"/>`;
  }));
  return `<svg class="sprite ${extra}" viewBox="0 0 ${w} ${h}" width="${w * px}" height="${h * px}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

// ---------- avatares ilustrados (agentes y personas): mismos personajes que los sprites, dibujados en vector ----------
// fondo circular con degradado + busto; tamaño = px·16 (lo mismo que ocupaba el sprite de 16×16)
const AV = {
  // Claude: mono
  mono: `<circle cx="14" cy="30" r="8" fill="#7a4a24"/><circle cx="50" cy="30" r="8" fill="#7a4a24"/><circle cx="14" cy="30" r="4.5" fill="#e3a878"/><circle cx="50" cy="30" r="4.5" fill="#e3a878"/>
    <ellipse cx="32" cy="30" rx="17" ry="18" fill="#8b5a2b"/><path d="M19 32c0-7 5-11 13-11s13 4 13 11c0 9-6 15-13 15s-13-6-13-15z" fill="#f0c9a0"/>
    <circle cx="26" cy="29" r="2.4" fill="#2b1a0e"/><circle cx="38" cy="29" r="2.4" fill="#2b1a0e"/><circle cx="26.8" cy="28.2" r=".8" fill="#fff"/><circle cx="38.8" cy="28.2" r=".8" fill="#fff"/>
    <ellipse cx="32" cy="38" rx="7" ry="5" fill="#e3a878"/><circle cx="30" cy="36.5" r=".9" fill="#5a3a1a"/><circle cx="34" cy="36.5" r=".9" fill="#5a3a1a"/><path d="M28.5 40.5q3.5 2.5 7 0" stroke="#5a3a1a" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M16 64c2-9 8-13 16-13s14 4 16 13z" fill="#8b5a2b"/>`,
  // Codex: elefante
  elefante: `<path d="M8 22c0-8 8-12 14-8l2 18c-6 4-16 2-16-10z" fill="#8f9bb3"/><path d="M56 22c0-8-8-12-14-8l-2 18c6 4 16 2 16-10z" fill="#8f9bb3"/>
    <path d="M11 22c0-5 5-8 9-6l1.5 12c-4 3-10.5 1-10.5-6z" fill="#e8a6b4"/><path d="M53 22c0-5-5-8-9-6l-1.5 12c4 3 10.5 1 10.5-6z" fill="#e8a6b4"/>
    <ellipse cx="32" cy="27" rx="15" ry="15" fill="#a7b2c7"/><path d="M27 34c0 8 1 15-2 20 0 3 4 3 5 0 2-5 3-12 3-20z" fill="#a7b2c7"/>
    <path d="M24 37q-3 4-1 7" stroke="#f4efe4" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M40 37q3 4 1 7" stroke="#f4efe4" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <circle cx="26" cy="25" r="2.2" fill="#1d2433"/><circle cx="38" cy="25" r="2.2" fill="#1d2433"/><circle cx="26.7" cy="24.3" r=".7" fill="#fff"/><circle cx="38.7" cy="24.3" r=".7" fill="#fff"/>
    <path d="M30 31h4" stroke="#7d889e" stroke-width="1" stroke-linecap="round"/><path d="M14 64c3-8 9-11 18-11s15 3 18 11z" fill="#8f9bb3"/>`,
  // Antigravity: futbolista con la 7
  cr7: `<path d="M14 64c1-10 8-15 18-15s17 5 18 15z" fill="#d7263d"/><path d="M26 49l6 6 6-6" fill="none" stroke="#fff" stroke-width="2"/>
    <text x="32" y="63" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="9" fill="#fff">7</text>
    <rect x="28" y="42" width="8" height="8" rx="3" fill="#c98b62"/><ellipse cx="32" cy="30" rx="12" ry="14" fill="#d9a07a"/>
    <path d="M20 27c0-10 6-14 12-14 7 0 13 4 12 14-2-4-4-6-6-6-4 1-9 1-13 0-2 1-4 3-5 6z" fill="#2a1c12"/>
    <circle cx="27" cy="31" r="1.7" fill="#2a1c12"/><circle cx="37" cy="31" r="1.7" fill="#2a1c12"/><path d="M24.5 27.5h5M34.5 27.5h5" stroke="#2a1c12" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M28 38q4 3 8 0" stroke="#8a4a32" stroke-width="1.4" fill="none" stroke-linecap="round"/><ellipse cx="20" cy="31" rx="1.8" ry="3" fill="#c98b62"/><ellipse cx="44" cy="31" rx="1.8" ry="3" fill="#c98b62"/>`,
  // CommandCode: bebé
  bebe: `<path d="M15 64c2-8 8-12 17-12s15 4 17 12z" fill="#f6c3d4"/><path d="M24 52q8 6 16 0" fill="#fff" opacity=".9"/>
    <circle cx="32" cy="31" r="17" fill="#f6d2b6"/><ellipse cx="15.5" cy="32" rx="3" ry="4" fill="#efc2a2"/><ellipse cx="48.5" cy="32" rx="3" ry="4" fill="#efc2a2"/>
    <path d="M30 14c0-3 4-4 5-1-2 0-3 1-3 3" stroke="#a46a3c" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <circle cx="26" cy="31" r="2.6" fill="#2b2b3a"/><circle cx="38" cy="31" r="2.6" fill="#2b2b3a"/><circle cx="26.9" cy="30.1" r=".9" fill="#fff"/><circle cx="38.9" cy="30.1" r=".9" fill="#fff"/>
    <circle cx="22" cy="37" r="3" fill="#f7a8b8" opacity=".55"/><circle cx="42" cy="37" r="3" fill="#f7a8b8" opacity=".55"/>
    <circle cx="32" cy="40.5" r="3.6" fill="#7cc4ff"/><circle cx="32" cy="40.5" r="1.6" fill="#e6f4ff"/>`,
  // personas: piloto rebelde
  rebel: `<path d="M13 64c2-10 9-14 19-14s17 4 19 14z" fill="#e86f2c"/><path d="M25 50h14v6H25z" fill="#f4efe4" opacity=".8"/>
    <ellipse cx="32" cy="33" rx="11" ry="12" fill="#e9b48f"/><path d="M18 30c0-11 6-17 14-17s14 6 14 17v4h-4v-6c0-4-4-6-10-6s-10 2-10 6v6h-4z" fill="#f2f2f2"/>
    <path d="M18 30c0-11 6-17 14-17s14 6 14 17" fill="none" stroke="#d7263d" stroke-width="3"/><rect x="21" y="26" width="22" height="7" rx="3.5" fill="#2c3e50" opacity=".85"/>
    <path d="M28 40q4 2.5 8 0" stroke="#8a4a32" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  // oficial (admin)
  imperial: `<path d="M13 64c2-10 9-14 19-14s17 4 19 14z" fill="#5f6b7d"/><rect x="22" y="54" width="6" height="3" rx="1" fill="#d7263d"/><rect x="29" y="54" width="4" height="3" rx="1" fill="#4fa3ff"/>
    <ellipse cx="32" cy="33" rx="11" ry="12.5" fill="#f0c8a4"/><path d="M19 25c1-7 6-11 13-11s12 4 13 11z" fill="#4b5563"/><rect x="18" y="24" width="28" height="4" rx="2" fill="#374151"/>
    <circle cx="27.5" cy="33" r="1.6" fill="#1f2937"/><circle cx="36.5" cy="33" r="1.6" fill="#1f2937"/><path d="M28.5 40h7" stroke="#8a4a32" stroke-width="1.4" stroke-linecap="round"/>`,
  // casco oscuro
  vader: `<path d="M12 64c2-11 10-15 20-15s18 4 20 15z" fill="#1f2430"/>
    <path d="M16 46c0-20 6-31 16-31s16 11 16 31l-6 4-4-6h-12l-4 6z" fill="#2b3040"/><path d="M20 36c0-14 5-20 12-20s12 6 12 20" fill="none" stroke="#4b5366" stroke-width="1.2"/>
    <path d="M22 31l8 2-1 4-8-1z" fill="#0d1017"/><path d="M42 31l-8 2 1 4 8-1z" fill="#0d1017"/><path d="M29 39l3 8 3-8z" fill="#5a6274"/>
    <path d="M27 46h10l-2 4h-6z" fill="#0d1017"/><path d="M24 22q8-5 16 0" stroke="#6b7488" stroke-width="1" fill="none" opacity=".7"/>`,
  // sabio verde
  yoda: `<path d="M14 64c2-9 8-13 18-13s16 4 18 13z" fill="#b59a72"/><path d="M27 51l5 7 5-7" fill="#8f7655"/>
    <path d="M6 26l16 6-2 5c-7 0-12-4-14-11z" fill="#8fbf6a"/><path d="M58 26l-16 6 2 5c7 0 12-4 14-11z" fill="#8fbf6a"/>
    <ellipse cx="32" cy="35" rx="13" ry="13" fill="#9ccc74"/><path d="M22 27q10-6 20 0" stroke="#7aa758" stroke-width="1.2" fill="none"/>
    <circle cx="26.5" cy="34" r="2.6" fill="#2b2b1f"/><circle cx="37.5" cy="34" r="2.6" fill="#2b2b1f"/><circle cx="27.3" cy="33.2" r=".9" fill="#fff"/><circle cx="38.3" cy="33.2" r=".9" fill="#fff"/>
    <path d="M28 42q4 2 8 0" stroke="#5d8a3d" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
};
const AV_BG = { mono: ['#ffe2b8', '#f7b267'], elefante: ['#d7f5e3', '#7fd6a4'], cr7: ['#d6ecff', '#7cb8f2'], bebe: ['#ffe0e9', '#f7a1bd'],
  rebel: ['#ffe6d1', '#f5a46b'], imperial: ['#e5e9f0', '#a9b4c4'], vader: ['#e2e5ec', '#8d96a8'], yoda: ['#e8f5dc', '#a9d48a'] };
function avatar(kind, px, extra, ring) {
  const s = Math.round(px * 16), [a, b] = AV_BG[kind];
  return `<svg class="sprite avatar ${extra}" viewBox="0 0 64 64" width="${s}" height="${s}" aria-hidden="true"${ring ? ` style="--ring-c:${ring}"` : ''}>
    <defs><linearGradient id="avbg-${kind}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <clipPath id="avc"><circle cx="32" cy="32" r="32"/></clipPath></defs>
    <g clip-path="url(#avc)"><rect width="64" height="64" fill="url(#avbg-${kind})"/>${AV[kind]}</g></svg>`;
}
const agentKind = k => k.includes('antigrav') || k === 'r2d2' ? 'cr7' : k.includes('claude') || k === 'c3po' ? 'mono' : k.includes('codex') || k === 'bb8' ? 'elefante' : k.includes('command') || k.includes('chopper') || k === 'c1-10p' ? 'bebe' : null;
export function agentSprite(a, px = 4, extra = '') {
  const kind = agentKind((typeof a === 'string' ? a : (a?.key || a?.name || '')).toLowerCase());
  return kind ? avatar(kind, px, extra, a?.color) : sprite('droid', a?.color || '#4fc3f7', px, extra);
}

// avatar elegido por el usuario (rebel, imperial, vader…). Sin avatar, usa el rol.
const USER_SHAPES = { rebel: 'rebel', imperial: 'imperial', vader: 'vader', yoda: 'yoda' };
export function userSprite(u, px = 2, extra = '') {
  const av = String(typeof u === 'string' ? u : (u?.avatar || '')).toLowerCase();
  return avatar(USER_SHAPES[av] || (u?.role === 'admin' ? 'imperial' : 'rebel'), px, extra);
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

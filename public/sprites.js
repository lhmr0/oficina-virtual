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

// ---------- avatares ilustrados (agentes y personas): mismos personajes que los sprites, en vector con volumen ----------
// tarjeta oscura con esquinas redondeadas + brillo del color del personaje; tamaño = px·16 (lo que ocupaba el sprite de 16×16)
// ojo: esclerótica, iris, brillo (mismo trazo en todos para que se vean de una misma familia)
const eye = (x, y, r = 3.2, iris = '#2a1b12') => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 1.12}" fill="#fff"/><circle cx="${x + r * .12}" cy="${y + r * .18}" r="${r * .66}" fill="${iris}"/><circle cx="${x + r * .38}" cy="${y - r * .18}" r="${r * .26}" fill="#fff"/>`;
const shine = (x, y, rx, ry) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#fff" opacity=".22"/>`;
const AV = {
  // Claude: mono con audífonos
  mono: k => `<defs><radialGradient id="${k}h" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#b47a45"/><stop offset="1" stop-color="#6b3f1d"/></radialGradient>
      <linearGradient id="${k}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8dcbc"/><stop offset="1" stop-color="#e5b083"/></linearGradient></defs>
    <path d="M14 66c1-11 8-17 18-17s17 6 18 17z" fill="#7a4a24"/><path d="M24 50q8 5 16 0" fill="none" stroke="#5c3418" stroke-width="1.4" opacity=".6"/>
    <circle cx="13.5" cy="32" r="7.5" fill="url(#${k}h)"/><circle cx="50.5" cy="32" r="7.5" fill="url(#${k}h)"/><circle cx="13.5" cy="32" r="4.2" fill="#eab48a"/><circle cx="50.5" cy="32" r="4.2" fill="#eab48a"/>
    <ellipse cx="32" cy="30" rx="17.5" ry="17" fill="url(#${k}h)"/>${shine(26, 19, 7, 3.2)}
    <path d="M29 13.5q1.5-4 3.5-1.5 1-3.5 3.5-.5" fill="none" stroke="#5c3418" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M18.5 32c0-6 5-9.5 8-9.5 2.3 0 4 1.6 5.5 1.6s3.2-1.6 5.5-1.6c3 0 8 3.5 8 9.5 0 8.5-6 14.5-13.5 14.5S18.5 40.5 18.5 32z" fill="url(#${k}f)"/>
    ${eye(26.2, 30.5)}${eye(37.8, 30.5)}
    <ellipse cx="30.6" cy="37.3" rx="1" ry=".8" fill="#6b3f1d"/><ellipse cx="33.4" cy="37.3" rx="1" ry=".8" fill="#6b3f1d"/>
    <path d="M27.5 40.5q4.5 3.4 9 0" fill="none" stroke="#6b3f1d" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M11 28c0-13 9-21 21-21s21 8 21 21" fill="none" stroke="#24221f" stroke-width="3.2" stroke-linecap="round"/>
    <rect x="6.5" y="25" width="7" height="13" rx="3.5" fill="#ff8a3d"/><rect x="50.5" y="25" width="7" height="13" rx="3.5" fill="#ff8a3d"/>
    <rect x="7.8" y="27" width="2" height="8" rx="1" fill="#fff" opacity=".35"/>`,
  // Codex: elefante con lentes
  elefante: k => `<defs><radialGradient id="${k}h" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#c3cddd"/><stop offset="1" stop-color="#7f8ba2"/></radialGradient></defs>
    <path d="M13 66c1-10 8-15 19-15s18 5 19 15z" fill="#7f8ba2"/>
    <path d="M17 18c-9-3-14 4-13 12s7 13 14 11z" fill="url(#${k}h)"/><path d="M47 18c9-3 14 4 13 12s-7 13-14 11z" fill="url(#${k}h)"/>
    <path d="M16 22c-6-1.5-8.5 3-8 7.5s4.5 8 8.5 7z" fill="#f0a3b4" opacity=".85"/><path d="M48 22c6-1.5 8.5 3 8 7.5s-4.5 8-8.5 7z" fill="#f0a3b4" opacity=".85"/>
    <ellipse cx="32" cy="28" rx="16" ry="16.5" fill="url(#${k}h)"/>${shine(26, 17, 6.5, 3)}
    <path d="M28.5 36c-.5 8 .5 13-2 17.5-1.3 2.4 1.2 4.2 3.4 2.6 3.6-2.6 4.6-10.4 4.6-20z" fill="url(#${k}h)"/>
    <path d="M28 44.5h5M28.3 48.5h4.4" stroke="#6c778d" stroke-width="1" stroke-linecap="round"/>
    <path d="M21 39q-4 5-1 9" fill="none" stroke="#fbf6ea" stroke-width="3" stroke-linecap="round"/><path d="M43 39q4 5 1 9" fill="none" stroke="#fbf6ea" stroke-width="3" stroke-linecap="round"/>
    ${eye(25.5, 28.5, 2.6, '#1c2232')}${eye(38.5, 28.5, 2.6, '#1c2232')}
    <circle cx="25.5" cy="28.5" r="5.4" fill="#9ef0c3" fill-opacity=".12" stroke="#1e2a24" stroke-width="1.7"/><circle cx="38.5" cy="28.5" r="5.4" fill="#9ef0c3" fill-opacity=".12" stroke="#1e2a24" stroke-width="1.7"/>
    <path d="M30.9 28h2.2" stroke="#1e2a24" stroke-width="1.7"/><path d="M22.5 25.5l2-1.5" stroke="#fff" stroke-width="1" opacity=".7" stroke-linecap="round"/>`,
  // Antigravity: futbolista con la 7 y vincha
  cr7: k => `<defs><linearGradient id="${k}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3a97f"/><stop offset="1" stop-color="#c88a60"/></linearGradient>
      <linearGradient id="${k}j" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef3b4e"/><stop offset="1" stop-color="#b81d30"/></linearGradient></defs>
    <path d="M12 66c1-11 9-16.5 20-16.5S51 55 52 66z" fill="url(#${k}j)"/><path d="M25.5 49.5 32 56l6.5-6.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>
    <text x="32" y="64.5" text-anchor="middle" font-family="IBM Plex Sans,Inter,Arial,sans-serif" font-weight="700" font-size="8" fill="#fff">7</text>
    <path d="M27.5 41h9v9.5q-4.5 3-9 0z" fill="#c07f56"/>
    <ellipse cx="19.5" cy="31" rx="2.4" ry="3.4" fill="#c88a60"/><ellipse cx="44.5" cy="31" rx="2.4" ry="3.4" fill="#c88a60"/>
    <path d="M20 29c0-9 5-15.5 12-15.5S44 20 44 29c0 9.5-5.5 16-12 16S20 38.5 20 29z" fill="url(#${k}s)"/>
    <path d="M19.5 26c-.5-9 5-14.5 12.5-14.5 8 0 13.5 5 12.5 14.5-1.5-4-3-6-5-6.5-3 1.5-11 1.5-14 0-2 .5-4.5 2.5-6 6.5z" fill="#24170f"/>
    <path d="M20.2 23.5q11.8-4.5 23.6 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    ${eye(26.6, 30, 2.5, '#2b1a10')}${eye(37.4, 30, 2.5, '#2b1a10')}
    <path d="M23.8 26.4q2.8-1.4 5.4-.2M34.8 26.2q2.6-1.2 5.4.2" fill="none" stroke="#24170f" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M31.4 32.5q-.8 2.6.6 3.4" fill="none" stroke="#a96d47" stroke-width="1.1" stroke-linecap="round"/>
    <path d="M27.8 38.6q4.2 3 8.4 0" fill="#fff" stroke="#8a4a32" stroke-width="1.1" stroke-linejoin="round"/>`,
  // CommandCode: bebé con gorrito
  bebe: k => `<defs><radialGradient id="${k}s" cx=".42" cy=".38" r=".75"><stop offset="0" stop-color="#ffe3cc"/><stop offset="1" stop-color="#f1bf98"/></radialGradient></defs>
    <path d="M14 66c1-9 8-14 18-14s17 5 18 14z" fill="#ff8fb1"/><path d="M24 52.5q8 5.5 16 0v3q-8 5-16 0z" fill="#fff" opacity=".9"/>
    <ellipse cx="14.5" cy="34" rx="3.2" ry="4.2" fill="#f1bf98"/><ellipse cx="49.5" cy="34" rx="3.2" ry="4.2" fill="#f1bf98"/>
    <circle cx="32" cy="33" r="17.5" fill="url(#${k}s)"/>${shine(26, 23, 6, 2.6)}
    <path d="M14.5 30c0-11 7.5-18.5 17.5-18.5S49.5 19 49.5 30c-4-3.5-10-5-17.5-5s-13.5 1.5-17.5 5z" fill="#ff6b9a"/>
    <path d="M14.5 30c4-3.5 10-5 17.5-5s13.5 1.5 17.5 5v2.5c-4-3-10-4.5-17.5-4.5s-13.5 1.5-17.5 4.5z" fill="#fff" opacity=".85"/>
    <circle cx="32" cy="10.5" r="3.6" fill="#fff"/>
    ${eye(25.6, 35, 3, '#2b2b3a')}${eye(38.4, 35, 3, '#2b2b3a')}
    <circle cx="21" cy="41" r="3" fill="#ff8fa8" opacity=".45"/><circle cx="43" cy="41" r="3" fill="#ff8fa8" opacity=".45"/>
    <ellipse cx="32" cy="44.5" rx="4.6" ry="3.4" fill="#8fd1ff"/><ellipse cx="32" cy="44.5" rx="2.2" ry="1.6" fill="#e8f6ff"/><rect x="30.6" y="46.5" width="2.8" height="3" rx="1.4" fill="#5fb4f0"/>`,
  // personas: piloto (casco blanco con franja roja y visor)
  rebel: k => `<defs><linearGradient id="${k}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d8dbe2"/></linearGradient></defs>
    <path d="M12 66c1-11 9-16 20-16s19 5 20 16z" fill="#ef7a33"/><path d="M26 50h12l-1 6h-10z" fill="#f4efe4"/><circle cx="23" cy="58" r="1.6" fill="#ffd166"/>
    <path d="M22 34c0-6 4.5-10 10-10s10 4 10 10c0 7.5-4.5 12.5-10 12.5S22 41.5 22 34z" fill="#eab28c"/>
    <path d="M15.5 34c0-13 7.5-21.5 16.5-21.5S48.5 21 48.5 34v5h-6v-7c0-5-4.5-7.5-10.5-7.5S21.5 27 21.5 32v7h-6z" fill="url(#${k}h)"/>
    <path d="M23.5 13.8q8.5-3.2 17 0" fill="none" stroke="#e5383b" stroke-width="3.2" stroke-linecap="round"/>${shine(24, 19, 4, 2)}
    <rect x="21" y="27" width="22" height="8" rx="4" fill="#1f2937"/><rect x="23" y="28.6" width="8" height="2" rx="1" fill="#7dd3fc" opacity=".55"/>
    <path d="M28 41.5q4 2.5 8 0" fill="none" stroke="#8a4a32" stroke-width="1.4" stroke-linecap="round"/>`,
  // oficial (admin)
  imperial: k => `<defs><linearGradient id="${k}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b7280"/><stop offset="1" stop-color="#3f4652"/></linearGradient></defs>
    <path d="M12 66c1-11 9-16 20-16s19 5 20 16z" fill="url(#${k}c)"/><path d="M27 50h10v6H27z" fill="#2f353f"/>
    <rect x="19" y="56" width="3" height="3" rx=".6" fill="#ef4444"/><rect x="23" y="56" width="3" height="3" rx=".6" fill="#3b82f6"/><rect x="27" y="56" width="3" height="3" rx=".6" fill="#facc15"/>
    <path d="M21 32c0-7 5-12 11-12s11 5 11 12c0 8.5-5 14.5-11 14.5S21 40.5 21 32z" fill="#f0c7a2"/>
    ${eye(27, 32.5, 2.3, '#1f2937')}${eye(37, 32.5, 2.3, '#1f2937')}
    <path d="M24.5 28.5h5M34.5 28.5h5" stroke="#5b4636" stroke-width="1.3" stroke-linecap="round"/><path d="M28.5 40.5h7" stroke="#8a4a32" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M18 24.5c1-8.5 6.5-12.5 14-12.5s13 4 14 12.5z" fill="url(#${k}c)"/><rect x="16" y="23" width="32" height="4.5" rx="2.2" fill="#2f353f"/>
    <rect x="29.5" y="15.5" width="5" height="4" rx="1" fill="#cbd5e1"/>`,
  // casco oscuro
  vader: k => `<defs><radialGradient id="${k}h" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#4b5263"/><stop offset=".55" stop-color="#1f232c"/><stop offset="1" stop-color="#0d0f14"/></radialGradient></defs>
    <path d="M10 66c1-11 10-16 22-16s21 5 22 16z" fill="#14171d"/><rect x="25" y="54" width="14" height="8" rx="1.5" fill="#2a2f39"/>
    <circle cx="28" cy="57" r="1" fill="#ef4444"/><circle cx="32" cy="57" r="1" fill="#22c55e"/><circle cx="36" cy="57" r="1" fill="#3b82f6"/>
    <path d="M14 50c0-24 7-37 18-37s18 13 18 37l-7 2-5-7H26l-5 7z" fill="url(#${k}h)"/>${shine(25, 21, 5.5, 3)}
    <path d="M21 32.5l9 1.5-.8 4.5-8.7-1.2zM43 32.5l-9 1.5.8 4.5 8.7-1.2z" fill="#06070a"/>
    <path d="M22 33.6l7 1.1" stroke="#fff" stroke-width=".7" opacity=".35"/>
    <path d="M29 41l3 7 3-7z" fill="#5a6274"/><path d="M26.5 47h11l-2.2 4.5h-6.6z" fill="#06070a"/>
    <path d="M28 48.5h8M28.6 50h6.8" stroke="#3a404d" stroke-width=".6"/>`,
  // sabio verde
  yoda: k => `<defs><radialGradient id="${k}s" cx=".42" cy=".35" r=".8"><stop offset="0" stop-color="#b5dc8e"/><stop offset="1" stop-color="#76a656"/></radialGradient></defs>
    <path d="M12 66c1-10 9-15 20-15s19 5 20 15z" fill="#a88b62"/><path d="M26 51l6 8 6-8" fill="#8a6f4a"/>
    <path d="M4 25l17 6.5-2 6.5C11 38 6 33 4 25z" fill="url(#${k}s)"/><path d="M60 25l-17 6.5 2 6.5c8 0 13-5 15-13z" fill="url(#${k}s)"/>
    <path d="M8 27.5l11 4.5-.8 3c-5 0-8.4-3-10.2-7.5zM56 27.5l-11 4.5.8 3c5 0 8.4-3 10.2-7.5z" fill="#e8a6a0" opacity=".45"/>
    <ellipse cx="32" cy="35" rx="14" ry="13.5" fill="url(#${k}s)"/>${shine(26, 26, 5, 2.4)}
    <path d="M21 28q11-5.5 22 0M22.5 31q9.5-3.5 19 0" fill="none" stroke="#6a9a4b" stroke-width="1" stroke-linecap="round"/>
    ${eye(26.4, 36, 2.9, '#3b2a10')}${eye(37.6, 36, 2.9, '#3b2a10')}
    <path d="M28 43.5q4 1.8 8 0" fill="none" stroke="#557d3a" stroke-width="1.3" stroke-linecap="round"/><path d="M30.5 39.5q1.5 1 3 0" fill="none" stroke="#557d3a" stroke-width="1" stroke-linecap="round"/>`,
};
// fondo: [tono oscuro arriba, tono abajo, color del brillo]
const AV_BG = { mono: ['#2b1d12', '#160f09', '#ff8a3d'], elefante: ['#152620', '#0b1511', '#62dc8e'], cr7: ['#14202e', '#0a1119', '#5aa9ff'], bebe: ['#2c1621', '#170b11', '#ff6b9a'],
  rebel: ['#2a1b12', '#150d08', '#ef7a33'], imperial: ['#1d2027', '#0f1115', '#94a3b8'], vader: ['#1b1d24', '#0b0c10', '#ef4444'], yoda: ['#1b2614', '#0d140a', '#9ccc74'] };
function avatar(kind, px, extra) {
  const s = Math.round(px * 16), [a, b, g] = AV_BG[kind], k = 'av-' + kind;
  return `<svg class="sprite avatar ${extra}" viewBox="0 0 64 64" width="${s}" height="${s}" aria-hidden="true">
    <defs><linearGradient id="${k}-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <radialGradient id="${k}-gl" cx=".5" cy=".85" r=".6"><stop offset="0" stop-color="${g}" stop-opacity=".55"/><stop offset="1" stop-color="${g}" stop-opacity="0"/></radialGradient>
    <clipPath id="${k}-clip"><rect width="64" height="64" rx="18"/></clipPath></defs>
    <g clip-path="url(#${k}-clip)"><rect width="64" height="64" fill="url(#${k}-bg)"/><rect width="64" height="64" fill="url(#${k}-gl)"/>${AV[kind](k)}</g>
    <rect x=".5" y=".5" width="63" height="63" rx="17.5" fill="none" stroke="${g}" stroke-opacity=".35"/></svg>`;
}
const agentKind = k => k.includes('antigrav') || k === 'r2d2' ? 'cr7' : k.includes('claude') || k === 'c3po' ? 'mono' : k.includes('codex') || k === 'bb8' ? 'elefante' : k.includes('command') || k.includes('chopper') || k === 'c1-10p' ? 'bebe' : null;
export function agentSprite(a, px = 4, extra = '') {
  const kind = agentKind((typeof a === 'string' ? a : (a?.key || a?.name || '')).toLowerCase());
  return kind ? avatar(kind, px, extra) : sprite('droid', a?.color || '#4fc3f7', px, extra);
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

// 計算引擎：資料與純邏輯，不碰 DOM（畫面在 js/ui/）
// ---------- 屬性相剋、寶可夢名單、配招與補位推薦 ----------
const TYPES = [
  { id: 'normal',   zh: '一般',   en: 'Normal',   color: '#9FA19F' },
  { id: 'fire',     zh: '火',     en: 'Fire',     color: '#E62829' },
  { id: 'water',    zh: '水',     en: 'Water',    color: '#2980EF' },
  { id: 'electric', zh: '電',     en: 'Electric', color: '#FAC000' },
  { id: 'grass',    zh: '草',     en: 'Grass',    color: '#3FA129' },
  { id: 'ice',      zh: '冰',     en: 'Ice',      color: '#3DCEF3' },
  { id: 'fighting', zh: '格鬥',   en: 'Fighting', color: '#FF8000' },
  { id: 'poison',   zh: '毒',     en: 'Poison',   color: '#9141CB' },
  { id: 'ground',   zh: '地面',   en: 'Ground',   color: '#915121' },
  { id: 'flying',   zh: '飛行',   en: 'Flying',   color: '#81B9EF' },
  { id: 'psychic',  zh: '超能力', en: 'Psychic',  color: '#EF4179' },
  { id: 'bug',      zh: '蟲',     en: 'Bug',      color: '#91A119' },
  { id: 'rock',     zh: '岩石',   en: 'Rock',     color: '#AFA981' },
  { id: 'ghost',    zh: '幽靈',   en: 'Ghost',    color: '#704170' },
  { id: 'dragon',   zh: '龍',     en: 'Dragon',   color: '#5060E1' },
  { id: 'dark',     zh: '惡',     en: 'Dark',     color: '#624D4E' },
  { id: 'steel',    zh: '鋼',     en: 'Steel',    color: '#60A1B8' },
  { id: 'fairy',    zh: '妖精',   en: 'Fairy',    color: '#EF70EF' },
];

// 攻擊方 → 2：效果絕佳(×2)、h：效果不好(×½)、0：沒有效果(×0)；沒列到的都是 ×1
const CHART = {
  normal:   { 2: [],                                              h: ['rock', 'steel'],                                                   0: ['ghost'] },
  fire:     { 2: ['grass', 'ice', 'bug', 'steel'],                h: ['fire', 'water', 'rock', 'dragon'],                                 0: [] },
  water:    { 2: ['fire', 'ground', 'rock'],                      h: ['water', 'grass', 'dragon'],                                        0: [] },
  electric: { 2: ['water', 'flying'],                             h: ['electric', 'grass', 'dragon'],                                     0: ['ground'] },
  grass:    { 2: ['water', 'ground', 'rock'],                     h: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'],      0: [] },
  ice:      { 2: ['grass', 'ground', 'flying', 'dragon'],         h: ['fire', 'water', 'ice', 'steel'],                                   0: [] },
  fighting: { 2: ['normal', 'ice', 'rock', 'dark', 'steel'],      h: ['poison', 'flying', 'psychic', 'bug', 'fairy'],                     0: ['ghost'] },
  poison:   { 2: ['grass', 'fairy'],                              h: ['poison', 'ground', 'rock', 'ghost'],                               0: ['steel'] },
  ground:   { 2: ['fire', 'electric', 'poison', 'rock', 'steel'], h: ['grass', 'bug'],                                                    0: ['flying'] },
  flying:   { 2: ['grass', 'fighting', 'bug'],                    h: ['electric', 'rock', 'steel'],                                       0: [] },
  psychic:  { 2: ['fighting', 'poison'],                          h: ['psychic', 'steel'],                                                0: ['dark'] },
  bug:      { 2: ['grass', 'psychic', 'dark'],                    h: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'],  0: [] },
  rock:     { 2: ['fire', 'ice', 'flying', 'bug'],                h: ['fighting', 'ground', 'steel'],                                     0: [] },
  ghost:    { 2: ['psychic', 'ghost'],                            h: ['dark'],                                                            0: ['normal'] },
  dragon:   { 2: ['dragon'],                                      h: ['steel'],                                                           0: ['fairy'] },
  dark:     { 2: ['psychic', 'ghost'],                            h: ['fighting', 'dark', 'fairy'],                                       0: [] },
  steel:    { 2: ['ice', 'rock', 'fairy'],                        h: ['fire', 'water', 'electric', 'steel'],                              0: [] },
  fairy:    { 2: ['fighting', 'dragon', 'dark'],                  h: ['fire', 'poison', 'steel'],                                         0: [] },
};

const IDS = TYPES.map(t => t.id);
const IDX = Object.fromEntries(IDS.map((id, i) => [id, i]));
const T = Object.fromEntries(TYPES.map(t => [t.id, t]));
const M = IDS.map(a => IDS.map(d => {
  const c = CHART[a];
  if (c[2].includes(d)) return 2;
  if (c.h.includes(d)) return 0.5;
  if (c[0].includes(d)) return 0;
  return 1;
}));
const DUALS = [];
for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) DUALS.push([IDS[i], IDS[j]]);

// 攻擊屬性 atk 打防守屬性 defs（1～2 個）的倍率
function eff(atk, defs) { return defs.reduce((m, d) => m * M[IDX[atk]][IDX[d]], 1); }
const FMT = { 0: '0', 0.125: '⅛', 0.25: '¼', 0.5: '½', 1: '1', 2: '2', 4: '4' };
const fmt = m => '×' + FMT[m];
const MSG = m => m === 0 ? '沒有效果' : m < 1 ? '效果不好' : m > 1 ? '效果絕佳' : '普通';

// 特性：只收「某屬性無效／傷害減半」這類純屬性倍率的（依神奇寶貝百科的特性說明）
const ABILITIES = [
  { id: 'levitate',       zh: '飄浮',     mod: { ground: 0 } },
  { id: 'earth-eater',    zh: '食土',     mod: { ground: 0 } },
  { id: 'flash-fire',     zh: '引火',     mod: { fire: 0 } },
  { id: 'well-baked',     zh: '焦香之軀', mod: { fire: 0 } },
  { id: 'water-absorb',   zh: '儲水',     mod: { water: 0 } },
  { id: 'storm-drain',    zh: '引水',     mod: { water: 0 } },
  { id: 'volt-absorb',    zh: '蓄電',     mod: { electric: 0 } },
  { id: 'lightning-rod',  zh: '避雷針',   mod: { electric: 0 } },
  { id: 'motor-drive',    zh: '電氣引擎', mod: { electric: 0 } },
  { id: 'sap-sipper',     zh: '食草',     mod: { grass: 0 } },
  { id: 'thick-fat',      zh: '厚脂肪',   mod: { fire: 0.5, ice: 0.5 } },
  { id: 'heatproof',      zh: '耐熱',     mod: { fire: 0.5 } },
  { id: 'water-bubble',   zh: '水泡',     mod: { fire: 0.5 } },
  { id: 'purifying-salt', zh: '潔淨之鹽', mod: { ghost: 0.5 } },
];
const AB = Object.fromEntries(ABILITIES.map(a => [a.id, a]));

// 防守方 defs（可帶特性 ab）被各屬性打的倍率分組
function defenseProfile(defs, ab) {
  const p = { 4: [], 2: [], 1: [], 0.5: [], 0.25: [], 0.125: [], 0: [] };
  IDS.forEach(a => p[eff(a, defs) * (AB[ab]?.mod[a] ?? 1)].push(a));
  return p;
}
function attackProfile(atk) {
  const p = { 2: [], 1: [], 0.5: [], 0: [] };
  IDS.forEach(d => p[eff(atk, [d])].push(d));
  return p;
}
// 招式組合 moves 打防守屬性 defs 的最佳倍率（挑最痛的那招）
function bestEff(moves, defs) { return Math.max(...moves.map(a => eff(a, defs))); }
// 依最佳倍率把防守方 targets（每個是 1～2 個屬性）分桶
function coverage(moves, targets) {
  const p = { 4: [], 2: [], 1: [], 0.5: [], 0.25: [], 0: [] };
  targets.forEach(defs => p[bestEff(moves, defs)].push(defs));
  return p;
}
// 從沒選的屬性裡挑下一招：依加入後雙屬性（次看單屬性）能打出效果絕佳的數量排序
function recommendMove(moves) {
  const se = (ms, targets) => targets.filter(defs => bestEff(ms, defs) >= 2).length;
  return IDS.filter(c => !moves.includes(c)).map(c => {
    const ms = [...moves, c];
    return { id: c, dual: se(ms, DUALS), single: se(ms, IDS.map(d => [d])) };
  }).sort((x, y) => y.dual - x.dual || y.single - x.single);
}
// 隊伍 members（每隻 1～2 個屬性）被各攻擊屬性打：怕（×2 以上）幾隻、抗（×½ 以下含無效）幾隻
function teamProfile(members) {
  return IDS.map(a => {
    const ms = members.map(defs => eff(a, defs));
    const weak = ms.filter(m => m >= 2).length, resist = ms.filter(m => m < 1).length;
    return { atk: a, ms, weak, resist, warn: weak >= 3 || (weak >= 2 && resist === 0) };
  });
}
// 隊伍缺口：有人怕、沒人抗的攻擊屬性
const teamGaps = rows => rows.filter(r => r.weak && !r.resist).map(r => r.atk);
// 其他隊員 others 加入屬性 defs 這隻後：隊伍缺口、⚠ 數，以及這隻自己的弱點數、抵抗數
function memberScore(others, defs) {
  const rows = teamProfile([...others, defs]);
  return {
    gaps: teamGaps(rows), warn: rows.filter(r => r.warn).length,
    weak: IDS.filter(a => eff(a, defs) >= 2).length, resist: IDS.filter(a => eff(a, defs) < 1).length,
  };
}
// 這隻（已選 base，0～1 個屬性）再補哪個屬性：others 是其他隊員；
// 依加入後的 ⚠ 數、缺口數由少到多排序，同分再比這隻自己弱點少、抵抗多
function recommendMember(others, base) {
  return IDS.filter(c => !base.includes(c)).map(c => ({ id: c, defs: [...base, c], ...memberScore(others, [...base, c]) }))
    .sort((x, y) => x.warn - y.warn || x.gaps.length - y.gaps.length || x.weak - y.weak || y.resist - x.resist);
}

// bs：種族值（base-stats.js）[HP, 攻擊, 防禦, 特攻, 特防, 速度]
const MONS = MONS_RAW.map(([key, zh, ty, s, d, base, mab]) => ({ key, zh, types: ty.split('.'), rank: { s, d }, base, bs: BASE_STATS[key], spe: BASE_STATS[key][5],
  megaAbils: mab ? mab.split('.') : [] }));
const MON = Object.fromEntries(MONS.map(m => [m.key, m]));
const family = m => m.base || m.key;
// 一般寶可夢 m 的超級進化型態（m 本身是超級進化就沒有）
const megasOf = m => m.base ? [] : MONS.filter(x => x.base === m.key);
const sameTypes = (a, b) => [...a].sort().join() === [...b].sort().join();

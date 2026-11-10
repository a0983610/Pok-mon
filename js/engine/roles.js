// 計算引擎：資料與純邏輯，不碰 DOM（畫面在 js/ui/）
// ---------- 角色：依 OP.GG 常用招式與特性判斷 ----------
// USAGE[寶可夢 key][s 單打／d 雙打] = { moves／abils／items: [[招式／特性／道具 key, 使用率%]...],
//   mates 隊友、win 勝於、lose 敗於: [寶可夢 key...]（OP.GG 的順序，前幾名） }
const parseUse = s => s ? s.split(' ').map(x => { const [k, p] = x.split(':'); return [k, +p]; }) : [];
const parseKeys = s => s ? s.split(' ') : [];
const USAGE = Object.fromEntries(Object.entries(USAGE_RAW).map(([k, [sm, dm, sa, da, si, di, st, dt, sw, dw, sl, dl]]) =>
  [k, { s: { moves: parseUse(sm), abils: parseUse(sa), items: parseUse(si), mates: parseKeys(st), win: parseKeys(sw), lose: parseKeys(sl) },
        d: { moves: parseUse(dm), abils: parseUse(da), items: parseUse(di), mates: parseKeys(dt), win: parseKeys(dw), lose: parseKeys(dl) } }]));
// 功能標籤：清單裡的招式或特性使用率達 ROLE_PCT% 就標上。sup＝輔助類：這類招式（含擊掌奇襲、冰凍之風這種
// 威力低、主要拿來輔助的攻擊招式）和特性都算「輔助招」，用來判斷這隻偏輸出還是偏輔助；守住、替身等不算任何一類
const ROLE_PCT = 30;
const ROLES = [
  { id: 'speed',    zh: '速度控制',  sup: true, moves: ['tailwind', 'trick-room', 'icy-wind', 'electroweb', 'thunder-wave', 'glare', 'nuzzle', 'toxic-thread'] },
  { id: 'disrupt',  zh: '擾亂',      sup: true, moves: ['fake-out', 'taunt', 'encore', 'haze', 'perish-song', 'skill-swap', 'entrainment', 'simple-beam', 'soak', 'trick', 'switcheroo'] },
  { id: 'redirect', zh: '引誘',      sup: true, moves: ['follow-me', 'rage-powder'] },
  { id: 'weaken',   zh: '削弱',      sup: true, moves: ['parting-shot', 'will-o-wisp', 'snarl', 'struggle-bug', 'charm', 'memento'], abils: ['intimidate'] },
  { id: 'ally',     zh: '隊友輔助',  sup: true, moves: ['helping-hand', 'wide-guard', 'quick-guard', 'reflect', 'light-screen', 'aurora-veil', 'life-dew', 'heal-pulse',
      'pollen-puff', 'ally-switch', 'after-you', 'instruct', 'decorate', 'coaching', 'healing-wish', 'revival-blessing'] },
  { id: 'status',   zh: '異常狀態',  sup: true, moves: ['spore', 'sleep-powder', 'hypnosis', 'yawn', 'toxic', 'will-o-wisp', 'thunder-wave', 'glare', 'nuzzle', 'toxic-thread'] },
  { id: 'hazard',   zh: '撒菱',      sup: true, moves: ['stealth-rock', 'spikes', 'toxic-spikes', 'sticky-web'] },
  { id: 'field',    zh: '天氣／場地', sup: true, moves: ['sunny-day', 'rain-dance', 'sandstorm', 'snowscape', 'chilly-reception', 'electric-terrain', 'grassy-terrain', 'misty-terrain', 'psychic-terrain'],
    abils: ['drought', 'drizzle', 'sand-stream', 'snow-warning', 'electric-surge', 'grassy-surge', 'misty-surge', 'psychic-surge'] },
  { id: 'setup',    zh: '強化', moves: ['swords-dance', 'dragon-dance', 'nasty-plot', 'calm-mind', 'bulk-up', 'quiver-dance', 'shell-smash', 'belly-drum', 'iron-defense', 'coil',
      'cosmic-power', 'cotton-guard', 'clangorous-soul', 'no-retreat', 'tidy-up', 'focus-energy', 'acid-armor', 'shelter', 'stockpile', 'minimize', 'amnesia', 'curse', 'agility', 'victory-dance', 'shift-gear'] },
  { id: 'pivot',    zh: '換人', moves: ['u-turn', 'volt-switch', 'flip-turn', 'parting-shot', 'teleport', 'baton-pass', 'chilly-reception', 'shed-tail'] },
  { id: 'heal',     zh: '回復', moves: ['recover', 'roost', 'slack-off', 'synthesis', 'moonlight', 'morning-sun', 'wish', 'rest', 'strength-sap', 'milk-drink', 'shore-up', 'soft-boiled', 'leech-seed', 'pain-split'] },
];
const ROLE = Object.fromEntries(ROLES.map(r => [r.id, r]));
const SUP_MOVES = new Set(ROLES.filter(r => r.sup).flatMap(r => r.moves));
const SUP_ABILS = new Set(ROLES.filter(r => r.sup).flatMap(r => r.abils || []));
// 寶可夢 key（超級進化沿用原型的統計）在 fmt 的角色；沒有統計資料回傳 null。
// 超級進化另外加上超級進化後的固定特性（mega，算 100%；和原型常用特性相同的只算一次，沒有中文說明的略過）。
// phys／spec／sup＝平均帶幾招物攻、特攻、輔助招（使用率加總 ÷ 100），main＝三者最多的那類（輔助同分算輔助），
// tags＝有的功能標籤，by 是撐起標籤的招式／特性 [中文名, 使用率, 是登錄的]。set：我方登錄的配招（見 useOf）
function roleOf(key, fmt, set) {
  const use = useOf(key, fmt, set);
  if (!use || !use.moves.length) return null;
  const mega = MON[key].megaAbils.filter(k => ABILS[k]);
  const abils = [...use.abils.filter(([k]) => !mega.includes(k)), ...mega.map(k => [k, 100, true])];
  let phys = 0, spec = 0, sup = 0;
  use.moves.forEach(([k, p]) => {
    if (SUP_MOVES.has(k)) sup += p;
    else if (MOVES[k][2] === 'physical') phys += p;
    else if (MOVES[k][2] === 'special') spec += p;
  });
  abils.forEach(([k, p]) => { if (SUP_ABILS.has(k)) sup += p; });
  const tags = ROLES.map(r => ({ id: r.id, by: [
    ...use.moves.filter(([k, p]) => p >= ROLE_PCT && r.moves.includes(k)).map(([k, p]) => [MOVES[k][0], p, use.reg?.moves]),
    ...abils.filter(([k, p]) => p >= ROLE_PCT && r.abils?.includes(k)).map(([k, p, m]) => [(m ? '超級進化後特性' : '特性') + ABILS[k][0], p, !m && use.reg?.abils]),
  ] })).filter(t => t.by.length);
  return { use, mega, phys: phys / 100, spec: spec / 100, sup: sup / 100, main: sup >= Math.max(phys, spec) ? 'sup' : phys >= spec ? 'phys' : 'spec', tags };
}
// 防守屬性 defs 的寶可夢實際打得出的攻擊屬性 [{ ty 屬性, zh 該屬性的招式中文名（多招用「、」連起來；本系時是 null） }]：
// 挑了寶可夢、fmt 有統計的看常用攻擊招式，同屬性的攻擊招式使用率加總 ROLE_PCT% 以上才算（同屬性常分散在幾招、單招沒到門檻，
// 如烈咬陸鯊龍尾、流星群各 28%；輔助用的攻擊招式、固定傷害和反擊類不吃相剋，都不算）；只選屬性或沒有統計的看本系
const FIXED_DMG = new Set(['counter', 'mirror-coat', 'metal-burst', 'comeuppance', 'endeavor', 'super-fang', 'ruination',
  'natures-madness', 'seismic-toss', 'night-shade', 'final-gambit', 'psywave']);
// 寶可夢 key 在 fmt 的 OP.GG 統計（超級進化沿用原型）；沒有統計回傳 undefined。
// set：我方登錄的配招 { moves: [招式 key ×4], item, ab, sp: [HP, 攻擊, 防禦, 特攻, 特防, 速度 的能力點數], nat: [↑能力索引, ↓能力索引] }
// （沒填的是空字串／0）。有填的招式／特性／道具當成使用率 100% 蓋過統計的同一欄，沒填的照舊看統計；
// 只有我方隊員會傳，對手一律看統計（鏡像對戰也不會混用）。有蓋過時多回傳 reg { moves, abils, items }＝哪幾欄是登錄的（畫面上登錄的不標使用率）
function useOf(key, fmt, set) {
  const use = USAGE[family(MON[key])]?.[fmt], moves = set ? set.moves.filter(Boolean) : [];
  if (!moves.length && !set?.ab && !set?.item) return use;
  return { ...(use || { moves: [], abils: [], items: [], mates: [], win: [], lose: [] }),
    ...(moves.length && { moves: moves.map(k => [k, 100]) }), ...(set.ab && { abils: [[set.ab, 100]] }), ...(set.item && { items: [[set.item, 100]] }),
    reg: { moves: moves.length > 0, abils: !!set.ab, items: !!set.item } };
}
// 空的配招；setFilled＝有沒有填任何一欄（什麼都沒填就當沒登錄，存 null）
const emptySet = () => ({ moves: ['', '', '', ''], item: '', ab: '', sp: [0, 0, 0, 0, 0, 0], nat: [0, 0] });
const setFilled = s => s.moves.some(Boolean) || !!s.item || !!s.ab || s.sp.some(Boolean) || !!s.nat[0];
function attacksOf(key, defs, fmt, set) {
  const use = key && useOf(key, fmt, set);
  if (!use || !use.moves.length) return defs.map(ty => ({ ty, zh: null }));
  const by = {};
  use.moves.filter(([k]) => MOVES[k][2] !== 'status' && !SUP_MOVES.has(k) && !FIXED_DMG.has(k)).forEach(([k, p]) => {
    const g = by[MOVES[k][1]] ||= { p: 0, zh: [] };
    g.p += p;
    g.zh.push(MOVES[k][0]);
  });
  return Object.entries(by).filter(([, g]) => g.p >= ROLE_PCT).map(([ty, g]) => ({ ty, zh: g.zh.join('、') }));
}
// 對手（熱門寶可夢或出戰選角填的對手）→ answerOf 用的 { defs, atk }，攻擊屬性和我方同一套算法
const monUnit = (m, fmt) => ({ defs: m.types, atk: attacksOf(m.key, m.types, fmt) });
// 超級石＝說明寫「…超級進化的持有物」的道具；一個家族有多種超級進化時，說明的括號寫明是哪一種（如「（超級噴火龍Ｘ）」）
const isStone = k => (ITEMS[k]?.[1] || '').includes('超級進化的持有物');
// 一般寶可夢 m 在 fmt 可能超級進化成的型態：[{ mon, p 帶這顆超級石的使用率, counted 算進對位判斷 }]。
// 使用率 ROLE_PCT% 以上才算（同常帶攻擊的門檻）；這隻沒有道具統計時 p 是 null、每種都算
function megaInfo(m, fmt) {
  const forms = megasOf(m), items = useOf(m.key, fmt)?.items || [];
  if (!items.length) return forms.map(x => ({ mon: x, p: null, counted: true }));
  return forms.map(x => {
    const p = items.filter(([k]) => isStone(k) && (forms.length === 1 || ITEMS[k][1].includes(`（${x.zh}）`))).reduce((s, [, q]) => s + q, 0);
    return { mon: x, p, counted: p >= ROLE_PCT };
  });
}
// 對手 m 的 unit，加上算進判斷的超級進化型態（answerOf 的 megas）
const oppUnit = (m, fmt) => ({ ...monUnit(m, fmt), megas: megaInfo(m, fmt).filter(x => x.counted).map(x => monUnit(x.mon, fmt)) });
// 超級進化型態寫成「超級噴火龍Ｙ 76%」（沒有統計的不寫 %）
const megaText = list => list.map(x => `<b>${x.mon.zh}</b>${chips(x.mon.types)}${x.p != null ? ` ${x.p}%` : ''}`).join('・');
// 隊伍該有的角色：物攻、特攻輸出各一，再加上 2026-11-09 資料裡該形式排名前 30 名至少 6 隻（兩成）有的功能
// （單打：強化 11、回復 9、換人 6 隻；雙打：速度控制 11、擾亂 6＋引誘 2、強化 6 隻）。tags 任一個有就算有
const NEEDS = {
  s: [{ id: 'phys', zh: '物攻輸出' }, { id: 'spec', zh: '特攻輸出' }, { id: 'setup', zh: '強化', tags: ['setup'] },
    { id: 'heal', zh: '回復', tags: ['heal'] }, { id: 'pivot', zh: '換人', tags: ['pivot'] }],
  d: [{ id: 'phys', zh: '物攻輸出' }, { id: 'spec', zh: '特攻輸出' }, { id: 'speed', zh: '速度控制', tags: ['speed'] },
    { id: 'disrupt', zh: '擾亂／引誘', tags: ['disrupt', 'redirect'] }, { id: 'setup', zh: '強化', tags: ['setup'] }],
};
// 角色 r 補得上需求 n 的招式／特性（輸出類需求看 main，回傳空陣列）；補不上回傳 null
function needBy(r, n) {
  if (!n.tags) return r.main === n.id ? [] : null;
  const by = r.tags.filter(t => n.tags.includes(t.id)).flatMap(t => t.by);
  return by.length ? by : null;
}
// 隊伍（roles：有統計資料的隊員角色）還缺的需求；一隻都沒有資料就不算缺
const lackNeeds = (roles, fmt) => roles.length ? NEEDS[fmt].filter(n => !roles.some(r => needBy(r, n))) : [];

// 從名單挑補位的寶可夢（屬性要包含 base；同家族已在隊上的不列）。依序比：
//   1. 搭配：解決幾個搭配提醒（fix）－新增幾個（add），提醒同「隊伍特性與場地招式」的 traitScan；
//      隊上有戲法空間時，慢的攻擊手（比熱門前 THREAT_N 的一半以上慢，看速度種族值）也算 fix 一項
//   2. 補上幾個隊伍缺的角色（fills；onTeam 依 fmt 常用招式／特性判斷）＋讓幾隻熱門威脅從沒解變成有對策（threats；
//      units 是其他隊員，格式同 answerOf，候選本身能擋或能剋就算，同熱門威脅檢查）
//   3. 常見隊友：候選和隊上成員出現在對方的 OP.GG 隊友名單裡（mates，隊上成員的 key）
//   4. recommendMember 的屬性評分，最後看排名（沒排名的排最後）
// 搭配、角色、隊友只在隊上已有挑了寶可夢的隊員、候選有排名時比（候選在 fmt 沒排名時，OP.GG 仍可能有零星統計，樣本太少不採用）。
// 超級進化和原型屬性一樣、比較結果也一樣時只留原型。fix 每項是 { w 解決的提醒, by 候選撐起它的特性／招式（traitScan 的 has 項目）}
// sets：隊上成員 key → 登錄的配招（見 useOf；候選不會在隊上，所以不受影響）
function recommendMon(others, base, fmt, onTeam = [], units = [], sets = {}) {
  const rk = m => m.rank[fmt] || Infinity, fams = onTeam.map(k => family(MON[k]));
  const lack = lackNeeds(onTeam.map(k => roleOf(k, fmt, sets[k])).filter(Boolean), fmt);
  const scan = onTeam.length ? traitScan(onTeam, fmt, sets) : null, before = scan ? scan.warns : [], me = onTeam.length;
  const top = scan && scan.has([], ['trick-room']).length ? topMons(fmt, THREAT_N) : null;
  const none = units.length ? threatCheck(units, fmt, THREAT_N).filter(t => !t.level).map(t => t.mon) : [];
  const list = MONS.filter(m => base.every(t => m.types.includes(t)) && !fams.includes(family(m)))
    .map(m => {
      const role = m.rank[fmt] ? roleOf(m.key, fmt) : null;
      const after = role && onTeam.length ? traitScan([...onTeam, m.key], fmt, sets) : null;
      // 「戲法空間下偏快」改由慢的攻擊手加分處理：一隻慢的加進來，偏快的比例常常還降不到一半
      const fix = after ? before.filter(w => w.kind !== 'trfast' && !after.warns.some(a => a.id === w.id))
        .map(w => ({ w, by: w.kind === 'need' ? after.set.filter(s => s.j === me && FIELD_SET[s.k] === w.f) : [] })) : [];
      if (after && top && role.main !== 'sup' && top.filter(t => t.spe < m.spe).length * 2 < top.length) fix.push({ w: { id: 'trslow', kind: 'trslow' }, by: [], spe: m.spe });
      const add = after ? after.warns.filter(a => !before.some(w => w.id === a.id)) : [];
      const me1 = { defs: m.types, atk: attacksOf(m.key, m.types, fmt) };
      const threats = none.filter(t => answerOf([me1], oppUnit(t, fmt)).level > 0);
      const mates = role ? onTeam.filter(k => useOf(k, fmt)?.mates.includes(family(m)) || role.use.mates.includes(family(MON[k]))) : [];
      return { mon: m, role, fills: role ? lack.filter(n => needBy(role, n)) : [], fix, add, threats, mates, ...memberScore(others, m.types) };
    });
  const syn = r => r.fix.length - r.add.length, gain = r => r.fills.length + r.threats.length;
  const sig = r => [r.fills.map(n => n.id), r.fix.map(f => f.w.id), r.add.map(w => w.id)].join('|');
  const byKey = Object.fromEntries(list.map(r => [r.mon.key, r]));
  return list.filter(r => !(r.mon.base && sameTypes(r.mon.types, MON[r.mon.base].types) && byKey[r.mon.base] && sig(byKey[r.mon.base]) === sig(r)))
    .sort((x, y) => syn(y) - syn(x) || gain(y) - gain(x) || y.mates.length - x.mates.length
      || x.warn - y.warn || x.gaps.length - y.gaps.length || rk(x.mon) - rk(y.mon));
}
// 全隊本系（隊員屬性）都打不出效果絕佳的單屬性對手
function stabGaps(members) {
  const stab = [...new Set(members.flat())];
  return IDS.filter(d => bestEff(stab, [d]) < 2);
}
// 排名前 n 的熱門寶可夢（不含超級進化，超級進化沿用原型排名），依排名排序
const topMons = (fmt, n) => MONS.filter(m => !m.base && m.rank[fmt] && m.rank[fmt] <= n).sort((x, y) => x.rank[fmt] - y.rank[fmt]);
// 隊員 members（每隻 { defs 屬性, atk attacksOf 的攻擊屬性 }）對一隻對手 opp（同格式，monUnit）：safe＝對手的攻擊招式打這隻都 ×1 以下、
// hit＝這隻的攻擊招式能剋對手（都是 members 的索引）；同一隻兩者兼具＝有解(2)，只有其一＝半解(1)，都沒有＝沒解(0)。
// 對手沒有常用攻擊招式（純輔助）時 bestEff 是 −Infinity，每隻都算 safe。
// opp.megas：對手可能超級進化成的型態（同格式，見 oppUnit）；有的話 safe／hit 要對進化前後每種型態都成立
function answerOf(members, opp) {
  const safe = [], hit = [], forms = [opp, ...(opp.megas || [])];
  members.forEach(({ defs, atk }, i) => {
    if (forms.every(f => bestEff(f.atk.map(a => a.ty), defs) <= 1)) safe.push(i);
    if (forms.every(f => bestEff(atk.map(a => a.ty), f.defs) >= 2)) hit.push(i);
  });
  return { safe, hit, level: safe.some(i => hit.includes(i)) ? 2 : safe.length || hit.length ? 1 : 0 };
}
// 熱門寶可夢逐隻檢查隊員 members（連常帶超級石的超級進化型態一起看）
const threatCheck = (members, fmt, n) => topMons(fmt, n).map(m => ({ mon: m, ...answerOf(members, oppUnit(m, fmt)) }));
// 從隊員 members（格式同 answerOf）挑 k 隻對上對手 opps（每個是 monUnit）：列出所有組合（idx 是 members 的索引），
// 依沒解的對手數（少→多）、有解的對手數（多→少）、同一隻兩者兼具的配對總數（多→少）排序。
// 一場只能超級進化一隻：alt[i]＝隊員 i 是超級進化時，不進化（原型）的版本。組合裡有 2 隻以上超級進化時，
// 逐一試只讓其中一隻進化、其他用原型，取排序最好的那種；evo＝進化的那隻（組合裡超級進化不到 2 隻時是 null）
function bringCombos(members, opps, k, alt = []) {
  const combos = [];
  (function rec(start, cur) {
    if (cur.length === k) return combos.push(cur.slice());
    for (let i = start; i < members.length; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); }
  })(0, []);
  const cmp = (x, y) => x.none - y.none || y.solved - x.solved || y.pairs - x.pairs;
  const score = (idx, evo) => {
    const res = opps.map(o => answerOf(idx.map(i => alt[i] && evo != null && i !== evo ? alt[i] : members[i]), o));
    // full[p]：組合裡第 p 隻能兩者兼具的對手數
    const full = idx.map((_, p) => res.filter(r => r.safe.includes(p) && r.hit.includes(p)).length);
    return { idx, evo, res, full, none: res.filter(r => !r.level).length, solved: res.filter(r => r.level === 2).length, pairs: full.reduce((s, n) => s + n, 0) };
  };
  return combos.map(idx => {
    const megas = idx.filter(i => alt[i]);
    return megas.length > 1 ? megas.map(e => score(idx, e)).sort(cmp)[0] : score(idx, null);
  }).sort(cmp);
}
// 雙打先發的輔助：這幾種功能標籤（ROLES）的招式／特性，如順風、戲法空間、擊掌奇襲、跟我來、幫助、威嚇、開天氣／場地
const LEAD_SUP = ['speed', 'disrupt', 'redirect', 'ally', 'weaken', 'field'];
// 反制強化的招式：挑釁、再來一次、黑霧、清除之煙、吼叫、吹飛、龍尾、巴投（另外特性純樸也算）
const ANTI_SETUP = ['taunt', 'encore', 'haze', 'clear-smog', 'roar', 'whirlwind', 'dragon-tail', 'circle-throw'];
// 寶可夢 key 在 fmt 能反制強化的招式／特性（使用率 ROLE_PCT% 以上；超級進化看固定特性），寫成「挑釁 45%」；set 見 useOf
function antiSetupOf(key, fmt, set) {
  const m = MON[key], use = useOf(key, fmt, set);
  const moves = (use?.moves || []).filter(([k, p]) => p >= ROLE_PCT && ANTI_SETUP.includes(k)).map(([k, p]) => MOVES[k][0] + (use.reg?.moves ? '' : ` ${p}%`));
  const abils = m.base ? (m.megaAbils.includes('unaware') ? [`超級進化後特性${abilZh('unaware')}`] : [])
    : (use?.abils || []).filter(([k, p]) => k === 'unaware' && p >= ROLE_PCT).map(([k, p]) => `特性${abilZh(k)}` + (use.reg?.abils ? '' : ` ${p}%`));
  return [...moves, ...abils];
}
// 先發：從組合 c（bringCombos 的結果）任挑 n 隻（單打 1 隻、雙打 2 隻），依序比
//   1. noAtk：都是輔助手（隊伍角色的 main 是 sup）的排最後；只選屬性、沒有統計的隊員當打手
//   2. cover：合起來能兩者兼具（有解）的對手數（多→少）
//   3. loose：壓不住的對手強化手（setups 裡的對手索引；都剋不到、也都沒有 antiSetupOf 的招式／特性）（少→多）
//   4. weak：共同弱點＝對手常帶的攻擊屬性（含算進去的超級進化型態）裡兩隻都受到 ×2 以上的（少→多；雙打才看）
//   5. sup：有沒有先發輔助（LEAD_SUP，看 fmt 的 OP.GG 常用招式／特性，寫成「順風 57%」；雙打才看，只選屬性的隊員沒有）
//   6. 速度種族值加總（高→低）
// uOf、sOf、kOf、setOf：members 索引 → unit（不進化的超級進化用原型）、速度、寶可夢 key、登錄的配招（見 useOf）；opps 是對手的 unit（oppUnit）
function leadPick(c, n, uOf, sOf, kOf, opps, setups, fmt, setOf = () => undefined) {
  const atk = [...new Set(opps.flatMap(u => [u, ...(u.megas || [])].flatMap(f => f.atk.map(a => a.ty))))];
  const roleIn = j => kOf(j) && roleOf(kOf(j), fmt, setOf(j));
  const supOf = j => { const r = roleIn(j); return r ? [...new Set(r.tags.filter(t => LEAD_SUP.includes(t.id)).flatMap(t => t.by.map(([zh, p, reg]) => reg ? zh : `${zh} ${p}%`)))] : []; };
  const antiOf = j => kOf(j) ? antiSetupOf(kOf(j), fmt, setOf(j)) : [];
  // 組合裡任挑 n 隻的位置（c.idx 的索引）
  const sets = n === 1 ? c.idx.map((_, p) => [p]) : c.idx.flatMap((_, p) => c.idx.slice(p + 1).map((__, d) => [p, p + 1 + d]));
  return sets.map(ps => {
    const js = ps.map(p => c.idx[p]), anti = js.some(j => antiOf(j).length);
    return { js, noAtk: js.every(j => roleIn(j)?.main === 'sup'),
      cover: c.res.filter(r => ps.some(x => r.safe.includes(x) && r.hit.includes(x))).length,
      loose: anti ? [] : setups.filter(o => !ps.some(x => c.res[o].hit.includes(x))),
      weak: n === 2 ? atk.filter(ty => js.every(j => eff(ty, uOf(j).defs) >= 2)) : [],
      sup: n === 2 ? js.map(j => [j, supOf(j)]).filter(([, by]) => by.length) : [], spe: js.reduce((s, j) => s + sOf(j), 0) };
  }).sort((x, y) => x.noAtk - y.noAtk || y.cover - x.cover || x.loose.length - y.loose.length || x.weak.length - y.weak.length
    || (y.sup.length > 0) - (x.sup.length > 0) || y.spe - x.spe)[0];
}
// 出戰選角：帶幾隻、先發幾隻依攻略網站整理的排位規則（單打 6 選 3、雙打 6 選 4）
const BRING_N = { s: 3, d: 4 }, LEAD_N = { s: 1, d: 2 };
// 我方 mems（[{ defs 屬性, key 寶可夢 key（只選屬性的是空字串）, set 登錄的配招（見 useOf）}...]）對上對手 opps（寶可夢）在 fmt 該帶誰、誰先發。回傳
//   k 帶幾隻、lead 先發幾隻、units 我方的 unit、alt 超級進化不進化時的原型 unit、oppUnits 對手的 unit（oppUnit）、
//   oppMegas 對手可能超級進化成的寶可夢、setupBy 每隻對手撐起「強化」標籤的招式、setups 強化手的對手索引、
//   combos 所有帶法（bringCombos，第一個最好）、pick 第 1 名組合的先發（leadPick）
function bringPlan(mems, opps, fmt) {
  const k = Math.min(BRING_N[fmt], mems.length), lead = Math.min(LEAD_N[fmt], k);
  const units = mems.map(x => ({ defs: x.defs, atk: attacksOf(x.key, x.defs, fmt, x.set) })), monOf = j => MON[mems[j].key];
  // 對手選一般型態、但常帶超級石的，進化前後都要看（oppUnit）
  const oppMegas = opps.map(m => megaInfo(m, fmt).filter(x => x.counted).map(x => x.mon));
  const oppUnits = opps.map(m => oppUnit(m, fmt));
  // 我方超級進化不進化時的版本（原型；招式不因進化改變，登錄的配招照用），給 bringCombos 算「一場只能進化一隻」
  const alt = mems.map((x, j) => { const b = monOf(j)?.base && MON[monOf(j).base]; return b ? { defs: b.types, atk: attacksOf(b.key, b.types, fmt, x.set) } : null; });
  const combos = bringCombos(units, oppUnits, k, alt), best = combos[0];
  const spe = j => monOf(j)?.spe || 0;
  // 先發（不進化的超級進化看原型的屬性和速度）：從第 1 名組合挑（leadPick；單打 1 隻，雙打 2 隻一起看搭配）
  const speIn = (c, j) => alt[j] && c.evo != null && j !== c.evo ? MON[monOf(j).base].spe : spe(j);
  const unitIn = (c, j) => alt[j] && c.evo != null && j !== c.evo ? alt[j] : units[j];
  // 對手的強化手：常帶強化招式（隊伍角色的「強化」標籤，如劍舞、詭計、龍之舞）的，存對手索引和撐起標籤的招式
  const setupBy = opps.map(m => roleOf(m.key, fmt)?.tags.find(t => t.id === 'setup')?.by || []);
  const setups = setupBy.map((by, o) => by.length ? o : -1).filter(o => o >= 0);
  const pick = leadPick(best, lead, j => unitIn(best, j), j => speIn(best, j), j => mems[j].key, oppUnits, setups, fmt, j => mems[j].set);
  return { k, lead, units, alt, oppUnits, oppMegas, setupBy, setups, combos, pick };
}

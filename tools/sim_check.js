// 對戰模擬對照 Pokémon Showdown 冠軍版（mod champions）：檢查 js/engine 的模擬引擎、傷害計算有沒有算錯或漏算。
// 第一次用先在 repo 根目錄裝 Showdown（裝在 tools/node_modules，不進 git）：npm install --prefix tools --ignore-scripts --no-package-lock
// 用法（在 repo 根目錄）：
//   node tools/sim_check.js [組數 300] [每組場數 200] [種子 7] [排名前幾名 100]
//     從單打排名前幾名（含超級進化）隨機挑兩隻、各挑一招，雙方每回合固定出那招，兩邊各打幾場，比勝率、回合數、第一回合後剩血；
//     有明顯差異（z 檢定）的列出來，牽涉到 KNOWN 已知缺口的標 △、其他標 ✘（要查的）
//   node tools/sim_check.js one 寶可夢A 寶可夢B 招式A 招式B [場數 200]   只比一組，並印出兩邊第一場的逐回合紀錄
//   node tools/sim_check.js moves   招式資料（OP.GG 的 MOVES）對照 Showdown：屬性、分類、威力、命中、PP、先制
//   node tools/sim_check.js cover [每組場數 200] [種子 7] [move／ability／item]   全面覆蓋：單打有使用率的每一招、特性、道具都找會帶的寶可夢
//     對幾隻對手打（見 cover），列出有差異的項目與模擬不會出的招（上面的隨機組合只抽前幾名的預設 4 招，覆蓋不到的靠這個）
//   node tools/sim_check.js team [組數 200] [每組場數 200] [種子 7]   3 對 3：換人相關的（撒菱類、出場特性、急速折返、紅牌、吼叫、接棒…）要有後排才比得到（見 team）
// 雙方的配招、點數、性格、特性、道具都照模擬用的（OP.GG 預設：simMon），Showdown 用「[Gen 9 Champions] Custom Game」（Lv50、不驗隊伍）。
// 想出的招不能選（PP 用完、被挑釁、定身、巨力錘連用、再來一次或講究圍巾鎖在別招）時兩邊都改出招式欄第一個能選的；擊掌奇襲類上場第一回合以後不當備用。
// 注意：npm 上的 Showdown 不一定跟得上遊戲改版（0.11.11 是 2026-07 的，早於 1.2 版：祈願、吸取力量的 PP 遊戲已經改成 8），
// 查到的這類招式資料比對前先改成冠軍版的（SD_FIX）；moves 模式比的是沒改的原始資料。
const fs = require('fs'), vm = require('vm'), path = require('path');
const R = path.resolve(__dirname, '..');
let SD;
try { SD = require(require.resolve('pokemon-showdown', { paths: [__dirname] })); }
catch { console.error('找不到 pokemon-showdown，先在 repo 根目錄執行：npm install --prefix tools --ignore-scripts --no-package-lock'); process.exit(1); }
const { Battle, Dex } = SD, dex = Dex.mod('champions');

// ---------- 載入網頁的計算引擎（不碰 DOM 的部分）----------
const ctxG = { console };
vm.createContext(ctxG);
vm.runInContext(['base-stats.js', 'mons-data.js', 'js/engine/core.js', 'js/engine/roles.js', 'js/engine/damage.js', 'js/engine/sim.js']
  .map(f => fs.readFileSync(path.join(R, f), 'utf8')).join('\n;\n') + `
;globalThis.E = { MONS, MON, MOVES, ITEMS, ABILS, ABIL_ZH, SIM_FIRST, SIM_SUP, SIM_PRI, SIM_TWICE, simMon, simStart, simTurn, simOver, simWinner, simAct, simCtx, simGreedyPick,
  simCanUse, statOf, natOf, stoneOf, isStone, useOf, defaultSet, SIM_HEALMV, simSound, simBench, simNeed, simReplace, simOpts };`, ctxG);
const E = ctxG.E;
const alnum = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- 已知的缺口（還沒做的）：Showdown id → 原因；有差異的組合牽涉到這些就標 △ ----------
const KNOWN = Object.fromEntries(Object.entries({
  // OP.GG 是草屬性，Showdown 冠軍版 mod 與 Smogon 冠軍版計算機是鋼屬性；2026-11-12 使用者選照 OP.GG 不改
  '捕獸夾屬性（照 OP.GG 的草，使用者決定）': 'snaptrap',
}).flatMap(([why, ks]) => ks.split(' ').map(k => [k, why])));
// 冠軍版改過、npm 的 Showdown 0.11.11 還沒跟上的招式資料（OP.GG 的才對）：比對前先把 Showdown 的改成冠軍版的（moves 模式不改，才看得到差在哪）。
// 祈願、吸取力量 PP 12→8（1.2 版，Serebii／theclick／Automaton；冠軍版 PP＝(pp ÷ 5 ＋ 1) × 4，所以 pp 填 5）；
// 劈開威力 70→80（Bulbapedia、Pokémon Zone）；流星突擊威力 150→170（Regulation M-C，Pokémon Zone、PokéBase）
const SD_FIX = { wish: { pp: 5 }, strengthsap: { pp: 5 }, slash: { basePower: 80 }, meteorassault: { basePower: 170 } };
// （Showdown 的招式物件是凍結的：照原本的建一個新的換進快取，對戰時 dex.moves.get 拿到的就是改過的）
const fixSD = () => Object.entries(SD_FIX).forEach(([id, fix]) => { const old = dex.moves.get(id); dex.moves.moveCache.set(id, dex.deepFreeze(new old.constructor({ ...old, ...fix }))); });

// ---------- 招式資料對照（moves）----------
function moves() {
  const use = {};
  for (const fmt of ['s', 'd']) for (const m of E.MONS.filter(m => !m.base && m.rank[fmt] > 0 && m.rank[fmt] <= 100))
    for (const [k, p] of E.useOf(m.key, fmt)?.moves || []) (use[k] ||= { s: 0, d: 0 })[fmt] += p;
  // 冠軍版 PP（scripts.ts calculatePP；init 已把 pp 超過 20 的改成 20）
  const sdPP = mv => mv.noPPBoosts ? mv.pp : (mv.pp / 5 + 1) * 4;
  const rows = [];
  for (const [k, [zh, type, cat, bp, , pp, acc, pri]] of Object.entries(E.MOVES)) {
    const mv = dex.moves.get(k), d = [];
    if (!mv.exists) { rows.push([k, zh, 'Showdown 沒有這招']); continue; }
    if (type !== mv.type.toLowerCase()) d.push(`屬性 ${type}→${mv.type}`);
    if (cat !== mv.category.toLowerCase()) d.push(`分類 ${cat}→${mv.category}`);
    if ((bp ?? 0) !== (mv.basePower || 0)) d.push(`威力 ${bp}→${mv.basePower}`);
    if ((acc ?? null) !== (mv.accuracy === true ? null : mv.accuracy)) d.push(`命中 ${acc}→${mv.accuracy}`);
    if (pp !== sdPP(mv)) d.push(`PP ${pp}→${sdPP(mv)}`);
    if ((pri || 0) !== mv.priority) d.push(`先制 ${pri}→${mv.priority}`);
    const simPri = E.SIM_SUP[k]?.p ?? E.SIM_PRI[k] ?? 0;
    if (E.SIM_SUP[k] || E.MOVES[k][2] !== 'status') { if (simPri !== mv.priority) d.push(`模擬的先制表 ${simPri}（Showdown ${mv.priority}）`); }
    if (d.length) rows.push([k, zh, d.join('、')]);
  }
  const w = k => (use[k]?.s || 0) + (use[k]?.d || 0);
  rows.sort((a, b) => w(b[0]) - w(a[0]));
  console.log(`MOVES ${Object.keys(E.MOVES).length} 招，和 Showdown 冠軍版不同的 ${rows.length} 招（前面的數字＝單打／雙打前 100 名的使用率加總）：`);
  for (const [k, zh, t] of rows) console.log(`${use[k]?.s || 0}/${use[k]?.d || 0}\t${k} ${zh}：${t}`);
}

// ---------- 寶可夢、配招對照到 Showdown ----------
// OP.GG 的 key → Showdown 的寶可夢（同 tools/update_mons.py 的 dex_id／weights）
const DEX_REGION = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' };
const DEX_FIX = { 'floette-eternal-flower': 'floetteeternal', 'mega-meowstic': 'meowsticmmega', 'maushold-family-of-four': 'mausholdfour', 'maushold-family-of-three': 'maushold' };
function dexId(key) {
  const mega = key.startsWith('mega-');
  let parts = (mega ? key.slice(5) : key).split('-').filter(p => p !== 'plumage').map(p => DEX_REGION[p] || p);
  if (parts.at(-1) === 'male') parts = parts.slice(0, -1); else if (parts.at(-1) === 'female') parts[parts.length - 1] = 'f';
  if (mega) return ['x', 'y', 'z'].includes(parts.at(-1)) ? alnum(parts.slice(0, -1).join('')) + 'mega' + parts.at(-1) : alnum(parts.join('')) + 'mega';
  return alnum(parts.join(''));
}
function speciesOf(key) {
  const sid = dexId(key), parts = key.split('-').filter(p => p !== 'plumage'), base = alnum(parts[0]);
  const cands = [DEX_FIX[key], sid, parts.at(-1) === 'female' ? sid.slice(0, -1) : null,
    parts.length > 1 && alnum(dex.species.get(base).baseForme) === parts.at(-1) ? base : null];
  const hit = cands.find(c => c && dex.species.get(c).exists);
  return hit ? dex.species.get(hit).name : null;
}
const STAT_ID = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const natureOf = ([u, d] = []) => !u || !d || u === d ? 'Serious' : dex.natures.all().find(n => n.plus === STAT_ID[u] && n.minus === STAT_ID[d]).name;
// 模擬用的一隻（simMon；our＝配招，沒給照 OP.GG 預設）→ Showdown 的配招；對不起來的回傳 { err }。超級進化帶自己的超級石（模擬裡超級進化沒有道具，Showdown 要有石頭）
function sdSet(key, our) {
  const M = E.simMon(key, our, undefined, 0, 's'), b = M.b, m = E.MON[key];
  if (!b.sp) return { err: '沒有點數統計' };
  const species = speciesOf(key);
  if (!species) return { err: '找不到寶可夢' };
  // 超級進化一定帶著自己的超級石：資料裡找不到（OP.GG 沒有統計的，如一般的烈咬陸鯊進化石）就用 Showdown 的 requiredItem
  const item = m.base ? E.stoneOf(m) || dex.species.get(species).requiredItem : M.item, errs = [];
  if (item && !dex.items.get(item).exists) errs.push('道具 ' + item);
  if (b.ab && !dex.abilities.get(b.ab).exists) errs.push('特性 ' + b.ab);
  M.moves.forEach(k => { if (!dex.moves.get(k).exists) errs.push('招式 ' + k); });
  if (errs.length) return { err: 'Showdown 沒有：' + errs.join('、') };
  return { key, our, M, set: { name: key, species, ability: b.ab ? dex.abilities.get(b.ab).name : '', item: item ? dex.items.get(item).name : '',
    moves: M.moves.map(k => dex.moves.get(k).name), evs: Object.fromEntries(STAT_ID.map((s, i) => [s, b.sp[i]])),
    ivs: Object.fromEntries(STAT_ID.map(s => [s, 31])), nature: natureOf(b.nat), level: 50 } };
}
const ourStats = (key, b) => STAT_ID.map((_, i) => E.statOf(E.MON[key].bs[i], b.sp[i], i, E.natOf(b.nat, i)));
// 有種子的亂數（我們這邊；Showdown 用它自己的）
const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// ---------- 兩邊各打 n 場 ----------
// 我們：想出的招 k 照遊戲規則能不能選（同 Showdown request 的 disabled）；一定失敗的輔助招照樣出（Showdown 也會出然後失敗）
function ourAct(st, s, k) {
  const M = E.simAct(st, s);
  if (M.rech) return { t: 'rech' };
  if (M.chg) return { t: 'mv', k: M.chg };
  if (M.v.rage) return { t: 'mv', k: M.v.rage.k };
  const ok = x => M.pp[x] > 0 && !(M.v.taunt && E.SIM_SUP[x]) && M.v.dis?.k !== x && !(E.SIM_TWICE.has(x) && M.last === x)
    && !(M.v.hblock && E.SIM_HEALMV.has(x)) && !(M.v.tchop && E.simSound(x))
    && !(M.v.enc && M.moves.includes(M.v.encK) && M.pp[M.v.encK] > 0 && M.v.encK !== x)
    && !(M.lock && M.item === 'choice-scarf' && M.moves.includes(M.lock) && M.lock !== x);
  // 擊掌奇襲類上場第一回合以後兩邊都改出備用招（模擬的 simOpts 本來就不列，Showdown 能選但一定失敗；同 sdChoice）
  const first = x => E.SIM_FIRST.has(x) && M.in !== st.turn;
  if (ok(k) && !first(k)) return { t: 'mv', k };
  return { t: 'mv', k: M.moves.find(x => ok(x) && !first(x)) || 'struggle' };
}
function runOurs(A, B, ma, mb, n, seed, log) {
  const rnd = mulberry32(seed), ctx = E.simCtx('s'), out = [];
  for (let r = 0; r < n; r++) {
    const st = E.simStart([{ mons: [E.simMon(A.key, A.our, undefined, 0, 's')] }, { mons: [E.simMon(B.key, B.our, undefined, 1, 's')] }], log && !r);
    const fr = () => [0, 1].map(s => Math.max(0, E.simAct(st, s).hp) / E.simAct(st, s).max);
    let t1 = null;
    while (!E.simOver(st) && st.turn < 100) {
      E.simTurn(ctx, st, [ourAct(st, 0, ma), ourAct(st, 1, mb)], rnd, 0, (c, s) => E.simGreedyPick(ctx, c, s));
      if (st.turn === 1) t1 = fr();
    }
    out.push({ w: E.simWinner(st), turns: st.turn, t1, log: st.log });
  }
  return out;
}
function sdChoice(side, want) {
  const req = side.activeRequest;
  if (!req || req.wait) return '';
  if (req.teamPreview) return 'team 1';
  if (req.forceSwitch) return 'pass';
  // 擊掌奇類上場後出過招就改出備用招（Showdown fakeout onTry 看 activeMoveActions；activeTurns 在第一回合選招時已經是 1，不能用）
  const mv = req.active[0].moves, first = id => ['fakeout', 'firstimpression'].includes(id) && side.active[0].activeMoveActions > 0;
  let i = mv.findIndex(m => m.id === want && !m.disabled && !first(m.id));
  if (i < 0) i = mv.findIndex(m => !m.disabled && !first(m.id));
  if (i < 0) i = mv.findIndex(m => !m.disabled);
  return `move ${i + 1}`;
}
// Showdown 沒指定性別時公母各半隨機（pokemon.ts sample(['M','F'])）；模擬照種族比例（FEMALE），所以每場照種族比例幫 Showdown 指定性別，兩邊條件一樣
const genderRnd = mulberry32(99);
const withGender = set => { const sp = dex.species.get(set.species); return sp.gender ? set : { ...set, gender: genderRnd() < sp.genderRatio.F ? 'F' : 'M' }; };
function runSD(A, B, ma, mb, n) {
  const out = [];
  for (let r = 0; r < n; r++) {
    const b = new Battle({ formatid: 'gen9championscustomgame' });
    b.setPlayer('p1', { name: 'A', team: [withGender(A.set)] });
    b.setPlayer('p2', { name: 'B', team: [withGender(B.set)] });
    b.makeChoices('team 1', 'team 1');
    const fr = () => [b.p1, b.p2].map(x => Math.max(0, x.pokemon[0].hp) / x.pokemon[0].maxhp);
    const stats = [b.p1, b.p2].map(x => [x.pokemon[0].maxhp, ...STAT_ID.slice(1).map(s => x.pokemon[0].storedStats[s])]);
    let t1 = null, moved = 0;
    while (!b.ended && b.turn <= 100) {
      b.makeChoices(sdChoice(b.p1, alnum(ma)), sdChoice(b.p2, alnum(mb)));
      if (++moved === 1) t1 = fr();
    }
    out.push({ w: b.winner === 'A' ? 0 : b.winner === 'B' ? 1 : -1, turns: Math.min(b.turn, 100), t1, stats, log: r ? null : b.log });
  }
  return out;
}
// ---------- 比較：勝率差 ≥ 8 點且 z ≥ 3.5、平均回合差 ≥ 0.5 且 z ≥ 4、第一回合後剩血差 ≥ 3% 且 z ≥ 4 ----------
const mean = xs => xs.reduce((a, x) => a + x, 0) / xs.length;
const vari = xs => { const m = mean(xs); return xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1); };
const zOf = (xa, xb) => { const d = mean(xa) - mean(xb), se = Math.sqrt(vari(xa) / xa.length + vari(xb) / xb.length); return se ? d / se : d ? Infinity : 0; };
const pct = x => (x * 100).toFixed(0) + '%';
function compare(o, s) {
  const f = [], big = (xa, xb, d, z) => Math.abs(mean(xa) - mean(xb)) >= d && Math.abs(zOf(xa, xb)) >= z;
  for (const w of [0, 1]) { const p = rs => rs.map(x => +(x.w === w)); if (big(p(o), p(s), 0.08, 3.5)) f.push(`${'AB'[w]}贏 ${pct(mean(p(o)))} vs SD ${pct(mean(p(s)))}`); }
  const tt = rs => rs.map(x => x.turns);
  if (big(tt(o), tt(s), 0.5, 4)) f.push(`回合 ${mean(tt(o)).toFixed(2)} vs SD ${mean(tt(s)).toFixed(2)}`);
  for (const i of [0, 1]) { const h = rs => rs.map(x => x.t1[i]); if (big(h(o), h(s), 0.03, 4)) f.push(`第一回合後 ${'AB'[i]} 剩 ${(mean(h(o)) * 100).toFixed(1)}% vs SD ${(mean(h(s)) * 100).toFixed(1)}%`); }
  return f;
}

// ---------- 全面覆蓋（cover）：單打有使用率的每一招、每個特性、每個道具都和 Showdown 對打過 ----------
// 每一項找會帶它的寶可夢（OP.GG 單打有排名的，照這項的使用率高到低、同家族只取一隻，取 HOLD 隻；超級進化的固定特性用超級進化型態），
// 配招照預設、把這項換進去（招式不在前 4 招就換掉第 4 招、特性、道具），對 OPP 隻單打前 100 名的對手（預設配招）：
// 招式就固定出這招，特性、道具隨機挑一招能出的；對手隨機挑一招（兩邊都是輔助招就重挑）。各打 n 場，同 compare 比較。
// 模擬不會出的招（simCanUse 不收）、Showdown 沒有的直接列出來。組合分給 worker_threads 一起跑。
// 用法：node tools/sim_check.js cover [每組場數 200] [種子 7] [只看 move／ability／item]
async function cover() {
  const [N, SEED, ONLY] = [+(process.argv[3] || 200), +(process.argv[4] || 7), process.argv[5]];
  const HOLD = 2, OPP = 3, rnd = mulberry32(SEED), pickOf = xs => xs[Math.floor(rnd() * xs.length)];
  const ranked = E.MONS.filter(m => m.rank.s > 0);
  // 每一項的使用率加總與帶的寶可夢 [key, 使用率]
  const T = { move: new Map(), ability: new Map(), item: new Map() };
  const put = (t, k, key, p) => { const x = T[t].get(k) || { w: 0, by: [] }; x.w += p; x.by.push([key, p]); T[t].set(k, x); };
  for (const m of ranked) {
    if (m.base) { const ab = E.simMon(m.key, undefined, undefined, 0, 's').b.ab; if (ab) put('ability', ab, m.key, 100); continue; }
    const u = E.useOf(m.key, 's');
    if (!u) continue;
    u.moves.forEach(([k, p]) => put('move', k, m.key, p));
    u.abils.forEach(([k, p]) => put('ability', k, m.key, p));
    u.items.forEach(([k, p]) => { if (!E.isStone(k)) put('item', k, m.key, p); });
  }
  // 能力值要先對得上（同一般模式）；每隻只比一次
  const statOk = {}, okKey = k => { if (!(k in statOk)) { const x = sdSet(k); statOk[k] = !x.err && runSD(x, x, x.M.moves[0], x.M.moves[0], 1)[0].stats[0].every((v, i) => v === ourStats(k, x.M.b)[i]); } return statOk[k]; };
  const pool = ranked.filter(m => m.rank.s <= 100 && okKey(m.key)).map(m => sdSet(m.key));
  const holders = (t, k, x) => {
    const out = [], fams = new Set(), errs = [];
    for (const [key] of x.by.slice().sort((a, b) => b[1] - a[1] || E.MON[a[0]].rank.s - E.MON[b[0]].rank.s)) {
      const f = E.MON[key].base || key, ds = E.defaultSet(key, 's');
      if (fams.has(f) || !ds) continue;
      const our = t === 'move' ? { ...ds, moves: ds.moves.includes(k) ? ds.moves : [...ds.moves.filter(Boolean).slice(0, 3), k] }
        : t === 'ability' && !E.MON[key].base ? { ...ds, ab: k } : t === 'item' ? { ...ds, item: k } : ds;
      const s = sdSet(key, our);
      if (s.err || !okKey(key)) { errs.push(`${key}：${s.err || '能力值對不上'}`); continue; }
      fams.add(f);
      out.push(s);
      if (out.length >= HOLD) break;
    }
    return { out, errs };
  };
  const zhOf = (t, k) => t === 'move' ? E.MOVES[k]?.[0] : t === 'ability' ? E.ABILS[k]?.[0] || E.ABIL_ZH[k] : E.ITEMS[k]?.[0];
  const noFirst = M => M.moves.filter(k => !E.SIM_FIRST.has(k));
  const targets = [], cases = [];
  for (const t of ['move', 'ability', 'item']) {
    if (ONLY && ONLY !== t) continue;
    for (const [k, x] of [...T[t]].sort((a, b) => b[1].w - a[1].w)) {
      const tg = { t, k, zh: zhOf(t, k) || k, w: Math.round(x.w), cases: [], note: '' };
      targets.push(tg);
      const sdx = t === 'move' ? dex.moves.get(k) : t === 'ability' ? dex.abilities.get(k) : dex.items.get(k);
      if (!sdx.exists) { tg.note = 'Showdown 沒有'; continue; }
      if (t === 'move' && !E.simCanUse(k)) { tg.note = '模擬不會出'; continue; }
      const h = holders(t, k, x);
      if (!h.out.length) { tg.note = '沒有能比的寶可夢（' + h.errs.slice(0, 2).join('；') + '）'; continue; }
      for (const A of h.out) for (let o = 0; o < OPP; o++) {
        const others = pool.filter(B => (E.MON[B.key].base || B.key) !== (E.MON[A.key].base || A.key));
        for (let tries = 0; tries < 10; tries++) {
          const B = pickOf(others), ma = t === 'move' ? k : pickOf(noFirst(A.M)), mb = pickOf(noFirst(B.M));
          if (!ma || !mb || E.MOVES[ma][2] === 'status' && E.MOVES[mb][2] === 'status') continue;
          tg.cases.push(cases.length);
          cases.push({ id: cases.length, A: { key: A.key, our: A.our }, B: { key: B.key, our: B.our }, ma, mb, n: N, seed: SEED * 100000 + cases.length, tg });
          break;
        }
      }
    }
  }
  console.log(`單打有排名 ${ranked.length} 隻（對手：前 100 名能比的 ${pool.length} 隻）；招式 ${T.move.size}、特性 ${T.ability.size}、道具 ${T.item.size} 項，共 ${cases.length} 組、各 ${N} 場`);
  // 分給 worker_threads
  const os = require('os'), nw = Math.max(1, Math.min(os.cpus().length - 1, cases.length)), t0 = Date.now();
  let next = 0, done = 0, shown = 0;
  await new Promise(resolve => {
    for (let i = 0; i < nw; i++) {
      const w = new Worker(__filename);
      const give = () => { if (next < cases.length) { const { tg, ...c } = cases[next++]; w.postMessage(c); } else w.terminate(); };
      w.on('message', ({ id, f }) => {
        cases[id].f = f;
        if (++done === cases.length) resolve();
        if (Date.now() - shown > 30000) { shown = Date.now(); console.log(`  ${done}／${cases.length}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`); }
        give();
      });
      w.on('error', e => { console.error(e); process.exit(1); });
      give();
    }
  });
  // 報告：有問題的項目（照使用率），已知缺口標 △
  let bad = 0, unk = 0;
  const lines = [];
  for (const tg of targets) {
    const cs = tg.cases.map(i => cases[i]), fl = cs.filter(c => c.f.length);
    if (!tg.note && !fl.length) continue;
    // 已知原因：雙方的特性、道具、整套招式（想出的招不能用時會改出別招）
    const known = c => [...new Set([c.A, c.B].flatMap(x => { const s = sdSet(x.key, x.our); return [alnum(s.set.ability), alnum(s.set.item), ...s.M.moves.map(alnum)]; })
      .concat([alnum(c.ma), alnum(c.mb)]).filter(x => KNOWN[x]).map(x => KNOWN[x]))];
    const allKnown = fl.length && fl.every(c => known(c).length);
    if (!allKnown) unk++;
    bad++;
    // Showdown 沒有的（冠軍版新增，如波導防護）比不了，標 △
    const noSD = tg.note === 'Showdown 沒有';
    if (noSD) unk--;
    lines.push(`${tg.note && !noSD ? '✘' : allKnown || noSD ? '△' : '✘'} [${tg.t}] ${tg.zh}（${tg.k}）使用率加總 ${tg.w}：${tg.note || `${fl.length}／${cs.length} 組有差異`}`);
    // 重跑：node tools/sim_check.js one <A 的寫法> <B> <招A> <招B>（特性、道具和預設不同的接 +ab:／+it:）
    const spec = x => { const ds = E.defaultSet(x.key, 's') || {}, o = x.our || ds; return x.key + (o.ab !== ds.ab ? `+ab:${o.ab}` : '') + (o.item !== ds.item ? `+it:${o.item}` : ''); };
    for (const c of fl) lines.push(`    ${E.MON[c.A.key].zh}(${E.MOVES[c.ma]?.[0] || c.ma}) vs ${E.MON[c.B.key].zh}(${E.MOVES[c.mb]?.[0] || c.mb}) [${spec(c.A)} ${spec(c.B)} ${c.ma} ${c.mb}]：${c.f.join('；')}${known(c).length ? '　⇐ 已知：' + known(c).join('、') : ''}`);
  }
  console.log(lines.join('\n'));
  console.log(`\n${targets.length} 項、${cases.length} 組（${((Date.now() - t0) / 1000).toFixed(0)} 秒）：有問題 ${bad} 項，其中不是已知原因的 ${unk} 項`);
}

// ---------- 3 對 3（team）----------
// 雙方各 3 隻（單打前 100 名能比的，同家族不重複），每隻隨機固定一招（擊掌奇襲類除外；同 ourAct／sdChoice，不能選時改出第一個能選的）；
// 倒下補位、急速折返類、逃脫按鍵、危險迴避等要自己選換誰時，兩邊都換「隊伍順序最前面、還站著的」（被吹走、紅牌照各自的亂數）。
// 比勝率、回合數、第一回合後雙方全隊剩下 HP 的平均（同 compare）。
// swp＝每回合每一方主動換人的機率（換到隊伍順序最前面、還站著的；被困住、要休息、鎖招時照出招）：比再生力、換上來吃撒菱類、出場特性、換人比出招早這些
// TA／TB：[{ key, our }]，MA／MB：每隻固定出的招
function runOurs3(TA, TB, MA, MB, n, seed, log, swp = 0) {
  const rnd = mulberry32(seed), prng = mulberry32(seed ^ 0x5bd1e995), ctx = E.simCtx('s'), out = [], pick = (c, s) => E.simBench(c, s)[0];
  for (let r = 0; r < n; r++) {
    const st = E.simStart([TA, TB].map((T, s) => ({ mons: T.map(x => E.simMon(x.key, x.our, undefined, s, 's')) })), log && !r);
    const fr = () => st.sd.map(x => x.mons.reduce((t, m) => t + Math.max(0, m.hp) / m.max, 0) / x.mons.length);
    const act = (s, M) => { if (swp && prng() < swp) { const sw = E.simOpts(ctx, st, s).find(o => o.t === 'sw'); if (sw) return sw; } return ourAct(st, s, M[st.sd[s].act]); };
    let t1 = null;
    while (!E.simOver(st) && st.turn < 100) {
      E.simTurn(ctx, st, [act(0, MA), act(1, MB)], rnd, 0, pick);
      while (!E.simOver(st) && (E.simNeed(st, 0) || E.simNeed(st, 1))) E.simReplace(st, [0, 1].map(s => E.simNeed(st, s) ? { t: 'sw', i: pick(st, s) } : { t: 'pass' }), rnd);
      // 第一回合打完、補位也換上來之後（Showdown 補位完才進第 2 回合）
      if (st.turn === 1) t1 = fr();
    }
    out.push({ w: E.simWinner(st), turns: st.turn, t1: t1 || fr(), log: st.log });
  }
  return out;
}
// Showdown 那邊要選換誰：隊伍原本順序（names）最前面、還站著、不在場上的（side.pokemon 換人時會重排，照名字找現在的位置）
function sdPick(req, names) {
  const ps = req.side.pokemon.map((p, i) => ({ i, name: p.ident.split(': ')[1], ok: !p.condition.endsWith(' fnt') && !p.active }));
  const want = names.map(nm => ps.find(p => p.name === nm && p.ok)).find(Boolean);
  return want ? `switch ${want.i + 1}` : 'pass';
}
// keys＝隊伍原本順序的寶可夢 key：復生祈禱要選倒下的哪一隻時，同模擬挑種族值總和最高的（一樣高取隊伍順序前面的）
function sdChoice3(side, names, mv, keys) {
  const req = side.activeRequest;
  if (!req || req.wait) return '';
  if (req.teamPreview) return 'team 123';
  if (req.forceSwitch && req.side.pokemon.some(p => p.reviving)) {
    const ps = req.side.pokemon.map((p, i) => ({ i, name: p.ident.split(': ')[1], dead: p.condition.endsWith(' fnt') }));
    const bst = nm => E.MON[keys[names.indexOf(nm)]].bs.reduce((t, v) => t + v, 0);
    const dead = names.map(nm => ps.find(p => p.name === nm && p.dead)).filter(Boolean);
    return dead.length ? `switch ${dead.reduce((a, p) => bst(p.name) > bst(a.name) ? p : a).i + 1}` : 'pass';
  }
  if (req.forceSwitch) return sdPick(req, names);
  const act = req.side.pokemon.find(p => p.active).ident.split(': ')[1];
  return sdChoice(side, alnum(mv[names.indexOf(act)]));
}
function runSD3(TA, TB, MA, MB, n, swp = 0) {
  // 名字用短的（Showdown 名字最多 20 字，永恆之花花葉蒂的 key 會被截掉、對不上）
  const out = [], names = ['a', 'b'].map(p => [0, 1, 2].map(i => p + i)), prng = mulberry32(n * 7919 + 13);
  for (let r = 0; r < n; r++) {
    const b = new Battle({ formatid: 'gen9championscustomgame' });
    b.setPlayer('p1', { name: 'A', team: TA.map((x, i) => withGender({ ...x.set, name: names[0][i] })) });
    b.setPlayer('p2', { name: 'B', team: TB.map((x, i) => withGender({ ...x.set, name: names[1][i] })) });
    b.makeChoices('team 123', 'team 123');
    const fr = () => [b.p1, b.p2].map(x => x.pokemon.reduce((t, p) => t + Math.max(0, p.hp) / p.maxhp, 0) / x.pokemon.length);
    let t1 = null, guard = 0;
    while (!b.ended && b.turn <= 100 && guard++ < 1000) {
      const t0 = b.turn, cs = [sdChoice3(b.p1, names[0], MA, TA.map(x => x.key)), sdChoice3(b.p2, names[1], MB, TB.map(x => x.key))];
      [b.p1, b.p2].forEach((side, i) => {
        // 主動換人：選得了就換（被困住、要休息、鎖招時 Showdown 不給選，改回出招）
        const req = side.activeRequest;
        if (swp && cs[i].startsWith('move') && prng() < swp) {
          const sw = sdPick(req, names[i]);
          if (sw !== 'pass' && side.choose(sw)) return;
          side.clearChoice();
        }
        if (cs[i] && !side.choose(cs[i])) throw new Error(`${side.id} 選「${cs[i]}」失敗：${side.choice.error}\n${JSON.stringify(side.activeRequest)}`);
        if (!cs[i] && side.activeRequest && !side.activeRequest.wait) throw new Error(`${side.id} 沒有選：${JSON.stringify(side.activeRequest)}`);
      });
      b.commitChoices();
      if (t0 === 1 && b.turn === 2 && !t1) t1 = fr();
    }
    out.push({ w: b.winner === 'A' ? 0 : b.winner === 'B' ? 1 : -1, turns: Math.min(b.turn, 100), t1: t1 || fr(), log: r ? null : b.log });
  }
  return out;
}
// 用法：node tools/sim_check.js team [組數 200] [每組場數 200] [種子 7] [主動換人機率 0]
async function team() {
  const [C, N, SEED, SWP] = [+(process.argv[3] || 200), +(process.argv[4] || 200), +(process.argv[5] || 7), +(process.argv[6] || 0)];
  const rnd = mulberry32(SEED), pickOf = xs => xs[Math.floor(rnd() * xs.length)];
  const okStats = x => !x.err && runSD(x, x, x.M.moves[0], x.M.moves[0], 1)[0].stats[0].every((v, i) => v === ourStats(x.key, x.M.b)[i]);
  const pool = E.MONS.filter(m => m.rank.s > 0 && m.rank.s <= 100).map(m => sdSet(m.key)).filter(okStats);
  const fam = x => E.MON[x.key].base || x.key;
  const pickTeam = () => { const T = []; while (T.length < 3) { const x = pickOf(pool); if (!T.some(y => fam(y) === fam(x))) T.push(x); } return T; };
  const cases = [];
  for (let c = 0; c < C; c++) {
    const [TA, TB] = [pickTeam(), pickTeam()], mv = T => T.map(x => pickOf(x.M.moves.filter(k => !E.SIM_FIRST.has(k))));
    cases.push({ id: c, kind: 'team', TA: TA.map(x => ({ key: x.key, our: x.our })), TB: TB.map(x => ({ key: x.key, our: x.our })), MA: mv(TA), MB: mv(TB), n: N, seed: SEED * 100000 + c, swp: SWP });
  }
  console.log(`3 對 3：單打前 100 名能比的 ${pool.length} 隻，${C} 組、各 ${N} 場${SWP ? `，每回合 ${SWP * 100}% 主動換人` : ''}`);
  const os = require('os'), nw = Math.max(1, Math.min(os.cpus().length - 1, cases.length)), t0 = Date.now();
  let next = 0, done = 0, shown = 0;
  await new Promise(resolve => {
    for (let i = 0; i < nw; i++) {
      const w = new Worker(__filename);
      const give = () => { if (next < cases.length) w.postMessage(cases[next++]); else w.terminate(); };
      w.on('message', ({ id, f }) => {
        cases[id].f = f;
        if (++done === cases.length) resolve();
        if (Date.now() - shown > 30000) { shown = Date.now(); console.log(`  ${done}／${cases.length}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`); }
        give();
      });
      w.on('error', e => { console.error(e); process.exit(1); });
      give();
    }
  });
  const zh = (T, M) => T.map((x, i) => `${E.MON[x.key].zh}(${E.MOVES[M[i]]?.[0] || M[i]})`).join('、');
  const spec = T => T.map(x => x.key).join(',');
  let bad = 0;
  for (const c of cases) {
    if (!c.f.length) continue;
    bad++;
    console.log(`✘ #${c.id} ${zh(c.TA, c.MA)} vs ${zh(c.TB, c.MB)} [${spec(c.TA)} ${spec(c.TB)} ${c.MA.join(',')} ${c.MB.join(',')}]：${c.f.join('；')}`);
  }
  console.log(`\n${cases.length} 組、各 ${N} 場：有差異 ${bad} 組（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
}
// 重跑一組 3 對 3 並印出兩邊第一場：node tools/sim_check.js team1 a,b,c d,e,f 招,招,招 招,招,招 [場數 200] [主動換人機率 0]
function team1() {
  const [ta, tb, ma, mb, n, swp] = process.argv.slice(3), TA = ta.split(',').map(k => sdSet(k)), TB = tb.split(',').map(k => sdSet(k));
  const o = runOurs3(TA, TB, ma.split(','), mb.split(','), +(n || 200), 1, true, +(swp || 0)), s = runSD3(TA, TB, ma.split(','), mb.split(','), +(n || 200), +(swp || 0));
  console.log(compare(o, s).join('；') || '沒有差異');
  console.log('--- 我們（第一場）---\n' + o[0].log.join('\n'));
  console.log('--- Showdown（第一場）---\n' + s[0].log.filter(l => !/^\|(t:|j|player|teamsize|gen|tier|rule|clearpoke|poke|teampreview|gametype|upkeep|split|$)/.test(l)).join('\n'));
}

// ---------- 主程式 ----------
const { Worker, isMainThread, parentPort } = require('worker_threads');
if (process.argv[2] !== 'moves') fixSD();
if (!isMainThread) {
  // cover 的背景執行緒：收到一組 { id, A, B（{ key, our }）, ma, mb, n, seed }，回傳 compare 的差異
  parentPort.on('message', ({ id, kind, A, B, ma, mb, TA, TB, MA, MB, n, seed, swp }) => {
    if (kind === 'team') {
      const ta = TA.map(x => sdSet(x.key, x.our)), tb = TB.map(x => sdSet(x.key, x.our));
      return parentPort.postMessage({ id, f: compare(runOurs3(ta, tb, MA, MB, n, seed, false, swp), runSD3(ta, tb, MA, MB, n, swp)) });
    }
    const a = sdSet(A.key, A.our), b = sdSet(B.key, B.our);
    parentPort.postMessage({ id, f: compare(runOurs(a, b, ma, mb, n, seed, false), runSD(a, b, ma, mb, n)) });
  });
} else if (process.argv[2] === 'cover') cover();
else if (process.argv[2] === 'team') team();
else if (process.argv[2] === 'team1') team1();
else main();
function main() {
const args = process.argv.slice(2);
if (args[0] === 'moves') { moves(); process.exit(0); }
const one = args[0] === 'one' ? args.slice(1, 5) : null;
const [CASES, N, SEED, TOP] = one ? [1, +(args[5] || 200), 1, 0] : [+(args[0] || 300), +(args[1] || 200), +(args[2] || 7), +(args[3] || 100)];
const sets = {};
if (one) {
  // 寫法「寶可夢+ab:特性+it:道具」（同 cover 印的）：配招照預設，想出的招不在前 4 招就換掉第 4 招，再換特性、道具（it: 後面空白＝不帶）
  one.slice(0, 2).forEach((spec, n) => {
    const [key, ...opt] = spec.split('+'), o = Object.fromEntries(opt.map(x => [x.slice(0, 2), x.slice(3)])), ds = E.defaultSet(key, 's'), mv = one[2 + n];
    const our = ds && { ...ds, moves: ds.moves.includes(mv) ? ds.moves : [...ds.moves.filter(Boolean).slice(0, 3), mv], ...('ab' in o && { ab: o.ab }), ...('it' in o && { item: o.it }) };
    const x = sdSet(key, our);
    if (x.err) { console.error(`${spec}：${x.err}`); process.exit(1); }
    sets[spec] = x;
  });
} else {
  const pool = E.MONS.filter(m => m.rank.s > 0 && m.rank.s <= TOP).map(m => m.key);
  for (const k of pool) {
    const x = sdSet(k);
    if (x.err) { console.log(`  略過 ${k}：${x.err}`); continue; }
    // 能力值要先對得上（我們的 statOf vs Showdown 的 storedStats），對不上的也是要查的
    const sv = runSD(x, x, x.M.moves[0], x.M.moves[0], 1)[0].stats[0], ov = ourStats(k, x.M.b);
    if (sv.some((v, i) => v !== ov[i])) console.log(`  ✘ 能力值不同 ${k}：我們 ${ov} vs Showdown ${sv}`); else sets[k] = x;
  }
  console.log(`單打前 ${TOP} 名（含超級進化）${pool.length} 隻，能比 ${Object.keys(sets).length} 隻`);
}
const rnd = mulberry32(SEED), keys = Object.keys(sets), pickOf = xs => xs[Math.floor(rnd() * xs.length)], cases = [];
if (one) cases.push(one);
else while (cases.length < CASES) {
  const ka = pickOf(keys), kb = pickOf(keys), ma = pickOf(sets[ka].M.moves.filter(k => !E.SIM_FIRST.has(k))), mb = pickOf(sets[kb].M.moves.filter(k => !E.SIM_FIRST.has(k)));
  if (ma && mb && !(E.MOVES[ma][2] === 'status' && E.MOVES[mb][2] === 'status')) cases.push([ka, kb, ma, mb]);
}
const t0 = Date.now(), tally = {};
let bad = 0, unknown = 0;
cases.forEach(([ka, kb, ma, mb], ci) => {
  if (one && !sets[ka]?.M.moves.includes(ma)) console.log(`注意：${ma} 不在 ${ka} 模擬用的招式裡（${sets[ka].M.moves.join(' ')}），兩邊都會改出第一個能選的`);
  const o = runOurs(sets[ka], sets[kb], ma, mb, N, SEED * 1000 + ci, !!one), s = runSD(sets[ka], sets[kb], ma, mb, N), f = compare(o, s);
  const ai = k => `${sets[k].set.ability}/${sets[k].set.item || '沒有道具'}`;
  const known = [...new Set([ka, kb].flatMap(k => [alnum(sets[k].set.ability), alnum(sets[k].set.item)]).concat([alnum(ma), alnum(mb)]).filter(x => KNOWN[x]).map(x => KNOWN[x]))];
  if (f.length) { bad++; if (!known.length) unknown++; known.forEach(x => { tally[x] = (tally[x] || 0) + 1; }); }
  if (f.length || one) console.log(`${!f.length ? '○' : known.length ? '△' : '✘'} #${ci} ${E.MON[sets[ka].key].zh}(${E.MOVES[ma]?.[0] || ma}) vs ${E.MON[sets[kb].key].zh}(${E.MOVES[mb]?.[0] || mb})`
    + ` [${ka} ${kb} ${ma} ${mb}]〈${ai(ka)}｜${ai(kb)}〉：${f.join('；') || '沒有差異'}${known.length ? '　⇐ 已知：' + known.join('、') : ''}`);
  if (one) {
    console.log('--- 我們（第一場）---\n' + o[0].log.join('\n'));
    console.log('--- Showdown（第一場）---\n' + s[0].log.filter(l => !/^\|(t:|j|player|teamsize|gen|tier|rule|clearpoke|poke|teampreview|gametype|upkeep|split|$)/.test(l)).join('\n'));
  }
});
if (!one) {
  console.log(`\n${cases.length} 組、各 ${N} 場：有差異 ${bad} 組（${(bad / cases.length * 100).toFixed(1)}%），其中原因不在已知清單的 ${unknown} 組（✘），${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  const t = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (t.length) console.log('已知原因（牽涉到的組數，一組可能多個）：' + t.map(([k, v]) => `${k} ${v}`).join('、'));
}
}

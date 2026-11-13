// 對戰模擬對照 Pokémon Showdown 冠軍版（mod champions）：檢查 js/engine 的模擬引擎、傷害計算有沒有算錯或漏算。
// 第一次用先在 repo 根目錄裝 Showdown（裝在 tools/node_modules，不進 git）：npm install --prefix tools --ignore-scripts --no-package-lock
// 用法（在 repo 根目錄）：
//   node tools/sim_check.js [組數 300] [每組場數 200] [種子 7] [排名前幾名 100]
//     從單打排名前幾名（含超級進化）隨機挑兩隻、各挑一招，雙方每回合固定出那招，兩邊各打幾場，比勝率、回合數、第一回合後剩血；
//     有明顯差異（z 檢定）的列出來，牽涉到 KNOWN 已知缺口的標 △、其他標 ✘（要查的）
//   node tools/sim_check.js one 寶可夢A 寶可夢B 招式A 招式B [場數 200]   只比一組，並印出兩邊第一場的逐回合紀錄
//   node tools/sim_check.js moves   招式資料（OP.GG 的 MOVES）對照 Showdown：屬性、分類、威力、命中、PP、先制
// 雙方的配招、點數、性格、特性、道具都照模擬用的（OP.GG 預設：simMon），Showdown 用「[Gen 9 Champions] Custom Game」（Lv50、不驗隊伍）。
// 想出的招不能選（PP 用完、被挑釁、定身、再來一次或講究圍巾鎖在別招）時兩邊都改出招式欄第一個能選的；擊掌奇襲類上場第一回合以後不當備用。
// 注意：npm 上的 Showdown 不一定跟得上遊戲改版（0.11.11 是 2026-07 的，早於 1.2 版：祈願、吸取力量的 PP 遊戲已經改成 8），
// 這類差異列在 KNOWN 的「Showdown 舊資料」。
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
;globalThis.E = { MONS, MON, MOVES, SIM_FIRST, SIM_SUP, SIM_PRI, simMon, simStart, simTurn, simOver, simWinner, simAct, simCtx, simGreedyPick,
  statOf, natOf, stoneOf, useOf };`, ctxG);
const E = ctxG.E;
const alnum = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- 已知的缺口（還沒做的）：Showdown id → 原因；有差異的組合牽涉到這些就標 △ ----------
const KNOWN = Object.fromEntries(Object.entries({
  '持久力': 'stamina', '碎裂鎧甲': 'weakarmor', '幻覺': 'illusion', '危險迴避': 'emergencyexit', '火焰之軀': 'flamebody', '輕裝': 'unburden',
  '複製': 'trace', '電力轉換': 'electromorphosis', '自信過度': 'moxie', '正義之心': 'justified', '心情不定': 'moody', '黏滑': 'gooey',
  '毒刺': 'poisonpoint', '迷人之軀': 'cutecharm', '毒滿地': 'toxicdebris', '怒火沖天': 'berserk', '熱交換攻擊+1': 'thermalexchange',
  '吸收類特性的回血／強化': 'lightningrod stormdrain motordrive sapsipper waterabsorb voltabsorb flashfire eartheater dryskin',
  '超級狠辣椒特性': 'spicyspray', '超級龍頭地鼠特性': 'piercingdrill', '超級大食花特性': 'innardsout', '超級日光（日光束不蓄力）': 'megasol',
  '巨劍突擊副作用': 'glaiverush', '電光雙擊失去屬性': 'doubleshock', '靈騷': 'poltergeist', '岩斧撒岩': 'stoneaxe', '千重濤撒菱': 'ceaselessedge',
  '巨力錘不能連用': 'gigatonhammer', '逆鱗': 'outrage', '羽棲失去飛行屬性': 'roost', '綁住類': 'infestation whirlpool firespin sandtomb bind wrap',
  '冰旋清場地': 'icespinner', '連續攻擊固定3下': 'bulletseed rockblast iciclespear pinmissile watershuriken scaleshot tailslap',
  '逃脫按鍵': 'ejectbutton', '紅牌': 'redcard', '場地種子': 'psychicseed grassyseed electricseed mistyseed',
  'Showdown 舊資料（祈願、吸取力量 PP）': 'wish strengthsap',
}).flatMap(([why, ks]) => ks.split(' ').map(k => [k, why])));

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
// 模擬用的一隻（simMon）→ Showdown 的配招；對不起來的回傳 { err }。超級進化帶自己的超級石（模擬裡超級進化沒有道具，Showdown 要有石頭）
function sdSet(key) {
  const M = E.simMon(key, undefined, undefined, 0, 's'), b = M.b, m = E.MON[key];
  if (!b.sp) return { err: '沒有點數統計' };
  const species = speciesOf(key);
  if (!species) return { err: '找不到寶可夢' };
  const item = m.base ? E.stoneOf(m) : M.item, errs = [];
  if (item && !dex.items.get(item).exists) errs.push('道具 ' + item);
  if (b.ab && !dex.abilities.get(b.ab).exists) errs.push('特性 ' + b.ab);
  M.moves.forEach(k => { if (!dex.moves.get(k).exists) errs.push('招式 ' + k); });
  if (errs.length) return { err: 'Showdown 沒有：' + errs.join('、') };
  return { M, set: { name: key, species, ability: b.ab ? dex.abilities.get(b.ab).name : '', item: item ? dex.items.get(item).name : '',
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
  const ok = x => M.pp[x] > 0 && !(M.v.taunt && E.SIM_SUP[x]) && M.v.dis?.k !== x
    && !(M.v.enc && M.moves.includes(M.v.encK) && M.pp[M.v.encK] > 0 && M.v.encK !== x)
    && !(M.lock && M.item === 'choice-scarf' && M.moves.includes(M.lock) && M.lock !== x);
  if (ok(k)) return { t: 'mv', k };
  return { t: 'mv', k: M.moves.find(x => ok(x) && !(E.SIM_FIRST.has(x) && M.in !== st.turn)) || 'struggle' };
}
function runOurs(ka, kb, ma, mb, n, seed, log) {
  const rnd = mulberry32(seed), ctx = E.simCtx('s'), out = [];
  for (let r = 0; r < n; r++) {
    const st = E.simStart([{ mons: [E.simMon(ka, undefined, undefined, 0, 's')] }, { mons: [E.simMon(kb, undefined, undefined, 1, 's')] }], log && !r);
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
  const mv = req.active[0].moves;
  let i = mv.findIndex(m => m.id === want && !m.disabled);
  if (i < 0) i = mv.findIndex(m => !m.disabled && !(['fakeout', 'firstimpression'].includes(m.id) && side.active[0].activeTurns > 0));
  if (i < 0) i = mv.findIndex(m => !m.disabled);
  return `move ${i + 1}`;
}
function runSD(A, B, ma, mb, n) {
  const out = [];
  for (let r = 0; r < n; r++) {
    const b = new Battle({ formatid: 'gen9championscustomgame' });
    b.setPlayer('p1', { name: 'A', team: [A.set] });
    b.setPlayer('p2', { name: 'B', team: [B.set] });
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

// ---------- 主程式 ----------
const args = process.argv.slice(2);
if (args[0] === 'moves') { moves(); process.exit(0); }
const one = args[0] === 'one' ? args.slice(1, 5) : null;
const [CASES, N, SEED, TOP] = one ? [1, +(args[5] || 200), 1, 0] : [+(args[0] || 300), +(args[1] || 200), +(args[2] || 7), +(args[3] || 100)];
const sets = {};
if (one) {
  for (const k of one.slice(0, 2)) { const x = sdSet(k); if (x.err) { console.error(`${k}：${x.err}`); process.exit(1); } sets[k] = x; }
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
  const o = runOurs(ka, kb, ma, mb, N, SEED * 1000 + ci, !!one), s = runSD(sets[ka], sets[kb], ma, mb, N), f = compare(o, s);
  const ai = k => `${sets[k].set.ability}/${sets[k].set.item || '沒有道具'}`;
  const known = [...new Set([ka, kb].flatMap(k => [alnum(sets[k].set.ability), alnum(sets[k].set.item)]).concat([alnum(ma), alnum(mb)]).filter(x => KNOWN[x]).map(x => KNOWN[x]))];
  if (f.length) { bad++; if (!known.length) unknown++; known.forEach(x => { tally[x] = (tally[x] || 0) + 1; }); }
  if (f.length || one) console.log(`${!f.length ? '○' : known.length ? '△' : '✘'} #${ci} ${E.MON[ka].zh}(${E.MOVES[ma]?.[0] || ma}) vs ${E.MON[kb].zh}(${E.MOVES[mb]?.[0] || mb})`
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

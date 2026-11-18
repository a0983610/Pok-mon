// 一步一步和模擬 AI 對打（單打 3 對 3）：第 0 方＝玩家（人或 subagent 下指令），第 1 方＝AI（預設 tree:400＝模擬分頁「標準」）。
// 用途：讓「不是模擬引擎」的玩家打一場，看 AI 的選擇哪裡怪、玩家的選擇和 AI 建議哪裡不同，再用 mc 從那個局面實打驗證誰對。
// 雙方都看得到對方的完整配置（同 tools/sim_ai.js 預設：AI 看得到對手的招式道具特性）。不需要 Showdown。
// 用法（在 repo 根目錄；檔案＝這一局的紀錄 JSON，建議放 AgentData\temp\sim_play\）：
//   node tools/sim_play.js new 檔案 [種子 20261118] [AI tree:400] [排名前幾名 60]
//     隨機兩隊（同 sim_ai.js：單打前幾名、各 3 隻、同家族不重複、超級進化最多 1 隻、配招 OP.GG 預設、先發第一隻），印出第一個要選的局面
//   node tools/sim_play.js show 檔案                 印出目前要選的局面（打完了就印結果）
//   node tools/sim_play.js go 檔案 選項編號 [p隊伍編號] [理由…]
//     第 0 方選「可選」裡的第幾個；用急速折返類（或被吼走）要換上誰可加 p0／p1／p2（隊伍編號，沒給照簡單規則 simGreedyPick）；
//     理由會記進檔案（賽後 review 看）。AI 這一步早就在同一個局面選好了（雙方同時出），不會看你的選擇
//   node tools/sim_play.js review 檔案              賽後：逐筆列第 0 方的選擇、理由，和 AI（同一次樹搜尋）建議第 0 方的出法比例、各選項評分、快速（ply1）的建議
//   node tools/sim_play.js mc 檔案 選擇編號 [每格場數 60] [執行緒 4]
//     從第幾個選擇（review 的 #）的局面，雙方選項的每種組合各實打 n 場：這一步照組合出，之後雙方都用快速（ply1）照亂數打完；
//     各格共用同一組亂數（成對比較）。印第 0 方得分率（贏 1、平手 0.5）矩陣，再列雙方各選項對「對手照 AI 這次算的出法比例」
//     與「對手實際出的」的得分率 ± 標準誤（AI 的選項也評，看 AI 自己選得對不對）
//   node tools/sim_play.js audit 檔案 [每個選項場數 60] [執行緒 4] [ai／all]
//     整局掃描：每個 AI 有 2 個以上選項的局面（all＝玩家的也算），每個選項各實打 n 場（對方這一步照 AI 算的出法比例抽、之後雙方快速），
//     列「照 AI 的出法比例比最好的選項少拿幾點勝率」（損失 ± 標準誤；玩家照實際選的），最後列損失明顯的局面。不靠玩家挑哪一步可疑
// 重播：每次都從頭照紀錄打到目前（亂數有種子、AI 的選擇存在檔案裡），所以紀錄檔就是整局的全部狀態。
const fs = require('fs'), vm = require('vm'), path = require('path'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const R = path.resolve(__dirname, '..');
const FILES = ['base-stats.js', 'mons-data.js', 'js/engine/core.js', 'js/engine/roles.js', 'js/engine/damage.js', 'js/engine/sim.js'];
const NAMES = ['MONS', 'MON', 'MOVES', 'TYPES', 'IDX', 'ITEMS', 'ABILS', 'FIELD_ZH', 'HITS', 'SIM_SUP', 'SIM_STATUS_ZH', 'SIM_HAZ_ZH', 'SIM_MAX_TURN', 'abilZh',
  'simMon', 'simItems', 'simStart', 'simTurn', 'simReplace', 'simPhase', 'simPhaseOpts', 'simDecide', 'simSearch', 'simGreedyPick', 'simRng', 'simHash', 'simKey',
  'simBaseKey', 'simCtx', 'simClone', 'simHit', 'simExp', 'simAcc', 'simSwitch', 'simSpeed', 'simFaster', 'simTypes', 'simWx', 'simTer', 'simWinner', 'simDraw'];
let E0;
function engine() {
  if (E0) return E0;
  const g = { console };
  vm.createContext(g);
  vm.runInContext(FILES.map(f => fs.readFileSync(path.join(R, f), 'utf8')).join('\n;\n')
    + `\n;globalThis.E = { ${NAMES.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} };`, g);
  return E0 = g.E;
}
const load = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const save = (f, G) => fs.writeFileSync(f, JSON.stringify(G, null, 1));

// ---------- 組隊（同 tools/sim_ai.js 的 teams，一組） ----------
function team2(seed, top) {
  const E = engine(), rnd = E.simRng(seed), pickOf = xs => xs[Math.floor(rnd() * xs.length)];
  const pool = E.MONS.filter(m => m.rank.s > 0 && m.rank.s <= top).map(m => m.key), fam = k => E.MON[k].base || k;
  const one = () => {
    const T = [];
    while (T.length < 3) { const k = pickOf(pool); if (!T.some(x => fam(x) === fam(k)) && !(E.MON[k].base && T.some(x => E.MON[x].base))) T.push(k); }
    return T;
  };
  return [one(), one()];
}

// ---------- AI 在一個局面的選擇 ----------
// 第 1 方照 G.ai 選（亂數種子＝局面編號，重播不重算）；同時存下同一次計算給第 0 方的建議（樹搜尋的出法比例與各選項評分）和快速（ply1）的建議，賽後 review 用
const r3 = x => Math.round(x * 1000) / 1000;
// v＝[第 0 方選項][第 1 方選項] 的分數（第 0 方角度）；第 0 方各選項對「第 1 方照 p1 出」的分數
const rowVal = (v, p1) => v.map(r => r.reduce((t, x, j) => t + x * p1[j], 0));
function decideAI(E, st, phase, G, di) {
  const [algo, n] = G.ai.split(':'), rnd = E.simRng((G.seed ^ Math.imul(0x9e3779b1, di + 1)) >>> 0), t0 = Date.now();
  const out = algo === 'tree' ? E.simSearch(E.simCtx('s'), st, phase, +n || 400, rnd, true) : E.simDecide(E.simCtx('s'), st, phase, rnd, true);
  const D = { ai: E.simKey(out[1]), ms: Date.now() - t0 };
  const x = out.stats;
  if (x) {
    // ply1 的 v 是 simValue（−1.5～1.5），換成 0～1 和樹搜尋一樣
    const v = algo === 'tree' ? x.v : x.v.map(r => r.map(y => (y + 1.5) / 3));
    D.sug = { opts: x.opts.map(os => os.map(E.simKey)), p: x.p.map(p => p.map(r3)), val: rowVal(v, x.p[1]).map(r3) };
  }
  if (algo !== 'ply1') {
    const q = E.simDecide(E.simCtx('s'), st, phase, null, true);
    if (q.stats) D.ply1 = { opts: q.stats.opts[0].map(E.simKey), p: q.stats.p[0].map(r3) };
  }
  return D;
}

// ---------- 重播 ----------
// 從頭照紀錄打：G.d[i]＝第 i 個「有一方要選」的局面 { ai AI 的選擇, a 第 0 方的選擇（還沒選是 null）, pin, why, … }。
// 第 0 方只有一個選項時自動照做（不算一個要選的局面，但 AI 有得選時仍記一筆，auto: true）。
// stopAt＝停在第幾個局面（mc、audit 用，不管選了沒、含 auto）；回傳停下來的局面，或打完的 { over }。dirty＝這次有新算 AI 的選擇（要存檔）
function replay(G, stopAt = Infinity) {
  const E = engine(), ctx = E.simCtx('s'), rnd = E.simRng(G.seed);
  const st = E.simStart(G.T.map((keys, s) => { const items = E.simItems(keys, 's'); return { mons: keys.map((k, j) => E.simMon(k, undefined, items[j], s, 's')) }; }), true);
  let di = 0, pin = null, logAt = 0, dirty = false;
  const pick = (c, s, hit) => s === 0 && pin != null && c.sd[0].mons[pin]?.hp > 0 && c.sd[0].act !== pin ? pin : E.simGreedyPick(ctx, c, s, hit);
  for (;;) {
    const phase = E.simPhase(st);
    if (phase === 'over') return { E, ctx, st, over: true, logAt, dirty };
    const O = [0, 1].map(s => E.simPhaseOpts(ctx, st, s, phase));
    let acts;
    if (O[0].length === 1 && O[1].length === 1) acts = [O[0][0], O[1][0]];
    else {
      if (!G.d[di]) { G.d[di] = { ...decideAI(E, st, phase, G, di), a: O[0].length === 1 ? E.simKey(O[0][0]) : null, auto: O[0].length === 1 }; dirty = true; }
      const D = G.d[di];
      if (di >= stopAt || (!D.auto && D.a == null)) return { E, ctx, st, phase, O, D, di, logAt, dirty, rnd, pick };
      if (!D.auto) logAt = st.log.length;
      const find = s => O[s].find(o => E.simKey(o) === (s ? D.ai : D.a));
      acts = [find(0), find(1)];
      if (!acts[0] || !acts[1]) throw new Error(`第 ${di} 個局面的紀錄和選項對不起來（引擎改過？）`);
      pin = D.pin ?? null;
      di++;
    }
    if (phase === 'turn') E.simTurn(ctx, st, acts, rnd, 0, pick); else E.simReplace(st, acts, rnd);
    pin = null;
  }
}

// ---------- 顯示（第 0 方的角度） ----------
const STAT_ZH = { atk: '攻擊', def: '防禦', spa: '特攻', spd: '特防', spe: '速度', acc: '命中', eva: '閃避' };
const CAT_ZH = { physical: '物理', special: '特殊', status: '變化' };
const tz = (E, t) => E.TYPES[E.IDX[t]]?.zh || t;
const nameOf = (E, M) => E.MON[E.simBaseKey(M)].zh;
const pct = (v, max) => Math.round(Math.max(0, v) / max * 100);
const optLabel = (E, st, s, o) => o.t === 'mv' ? (E.MOVES[o.k]?.[0] || o.k) : o.t === 'sw' ? `換成 [${o.i}] ${nameOf(E, st.sd[s].mons[o.i])}`
  : o.t === 'rech' ? '休息（這回合不能動）' : o.t === 'pass' ? '不用換' : o.t === 'none' ? '什麼都不能做' : o.t;
// 打倒機率：各下 16 個亂數（不算急所）加總 ≥ hp 的比例；3 下以內全部列舉，更多下回傳 null（只標「可能打倒」）
function koP(rows, hp) {
  if (rows.length > 3) return null;
  let n = 0, all = 0;
  const go = (h, sum) => { if (h === rows.length) { all++; if (sum >= hp) n++; return; } rows[h].forEach(x => go(h + 1, sum + x)); };
  go(0, 0);
  return n / all;
}
// A 用招式 k 打 D：傷害範圍（16 個亂數的最低～最高，連續攻擊各下加總；不含命中率）、期望（含命中率）、打倒機率（看 D 現在的 HP、不算急所，命中率另外標）
function dmgText(E, ctx, st, A, D, k) {
  const r = E.simHit(ctx, st, A, D, k, false, true);
  if (!r.eff) return '無效' + (r.fail ? `（${r.fail}）` : '');
  const lo = r.rolls.reduce((t, x) => t + x[0], 0), hi = r.rolls.reduce((t, x) => t + x[15], 0), ex = E.simExp(ctx, st, A, D, k);
  const acc = Math.min(100, Math.round(E.simAcc(st, A, D, k, false))), cond = acc < 100 ? `（要命中，命中率 ${acc}%）` : '';
  let ko = '';
  if (r.endured && D.hp >= D.max && hi >= D.hp) ko = '，會被氣勢披帶／結實撐住';
  else if (hi >= D.hp) { const p = koP(r.rolls, D.hp); ko = (p == null ? '，可能打倒' : p >= 1 ? '，確定打倒' : `，打倒機率 ${Math.round(p * 100)}%`) + cond; }
  return `${pct(lo, D.max)}～${pct(hi, D.max)}%（期望 ${pct(ex, D.max)}%${ko}）`;
}
// 換下場就清掉的狀態（M.v）：看得懂的寫中文，程式內部的記錄不列；沒列在這裡的照欄位名稱列
const V_HIDE = new Set(['mt', 'got', 'up', 'metro', 'fc', 'mim', 'db', 'asw', 'aswUsed', 'protUsed', 'stall', 'fickle', 'pt', 'types', 'encK', 'fling', 'b0']);
const V_ZH = { taunt: '被挑釁', seed: '被寄生種子', curse: '被詛咒', yawn: '打哈欠（回合結束睡著）', focus: '集氣', charge: '充電', trap: '不能換人',
  prot: '守住中', endure: '挺住', conf: '混亂', flinch: '畏縮', octo: '被蛸固纏住', shackle: '被縫影縫住', hblock: '回復封鎖', tchop: '不能用聲音招式',
  smack: '被擊落（在地面）', mrise: '電磁飄浮', mini: '變小', attract: '著迷', salt: '鹽醃', syrup: '糖漿炸彈', impr: '封印', gastro: '特性失效',
  add: '加上了屬性', spe: '速度互換過', roost: '羽棲（這回合失去飛行）', glaive: '巨劍突擊後（受到傷害 ×2）', ff: '引火發動', unb: '輕裝發動',
  hangry: '飽了又餓（空腹）', cud: '反芻', beak: '加熱鳥嘴', fallen: '大將' };
function volText(E, M) {
  return Object.entries(M.v).filter(([k, x]) => x && !V_HIDE.has(k)).map(([k, x]) =>
    k === 'sub' ? `替身（剩 ${pct(x, M.max)}%）` : k === 'stock' ? `蓄力 ${x} 次` : k === 'dis' ? `${E.MOVES[x.k]?.[0] || x.k}被定身` : k === 'enc' ? `被再來一次（只能用${E.MOVES[M.v.encK]?.[0] || ''}）`
      : k === 'rage' ? `逆鱗類鎖住${E.MOVES[x.k]?.[0] || ''}` : k === 'bind' ? '被綁住' : V_ZH[k] || k);
}
// 第 s 方隊伍第 i 隻換上場會吃多少（隱形岩、撒菱…）：在複本上換一次看 HP 少多少
function entryHurt(E, st, s, i) {
  const c = E.simClone(st), M = c.sd[s].mons[i], h0 = M.hp;
  c.log = null;
  E.simSwitch(c, s, i, null);
  return Math.max(0, h0 - Math.max(0, M.hp));
}
const descOf = (tab, k) => String(tab?.[k]?.[1] || '').replace(/\s+/g, '');
function monBlock(E, ctx, st, s, i) {
  const M = st.sd[s].mons[i], act = st.sd[s].act === i;
  if (M.hp <= 0) return [`  [${i}] ${nameOf(E, M)}：倒下`];
  const boost = Object.entries(M.st).filter(([, v]) => v).map(([k, v]) => `${STAT_ZH[k] || k}${v > 0 ? '+' : ''}${v}`).join(' ');
  const stt = M.status ? (E.SIM_STATUS_ZH[M.status] || M.status) + (M.status === 'slp' ? `（還要睡 ${M.slp}）` : M.status === 'tox' ? `（計數 ${M.tox}，每回合扣的越來越多）` : '') : '';
  const bs = E.MON[M.fk || M.key]?.bs || E.MON[M.key].bs, mega = !!E.MON[M.key].base;
  const L = [`  [${i}] ${act ? '★場上' : '後排'} ${nameOf(E, M)}（${E.simTypes(M).map(t => tz(E, t)).join('／')}）HP ${Math.max(0, M.hp)}/${M.max}（${pct(M.hp, M.max)}%）`
    + (stt ? `｜${stt}` : '') + (boost ? `｜能力 ${boost}` : '') + `｜道具 ${M.item ? E.ITEMS?.[M.item]?.[0] || M.item : mega ? '超級石（已超級進化）' : '無'}｜特性 ${E.abilZh(M.b.ab) || M.b.ab}`
    + `｜速度 ${E.simSpeed(ctx, st, M)}｜種族值 ${bs.join('/')}`];
  L.push(`      特性：${descOf(E.ABILS, M.b.ab) || '（沒有說明）'}${M.item && descOf(E.ITEMS, M.item) ? `｜道具：${descOf(E.ITEMS, M.item)}` : ''}`);
  const extra = [M.lock && `講究鎖住${E.MOVES[M.lock]?.[0]}`, M.chg && `蓄力中${E.MOVES[M.chg]?.[0]}`, M.rech && '下回合要休息', act && M.last && `上一招${E.MOVES[M.last]?.[0] || M.last}`,
    ...(act ? volText(E, M) : [])].filter(Boolean);
  if (extra.length) L.push(`      狀態：${extra.join('、')}`);
  const foes = st.sd[1 - s].mons.map((D, j) => [D, j]).filter(([D]) => D.hp > 0);
  for (const k of M.moves) {
    const mv = E.MOVES[k], acc = mv[6] ?? 100, pri = mv[7] || 0;
    const head = `      ${mv[0]}（${tz(E, mv[1])}／${CAT_ZH[mv[2]] || mv[2]}${mv[3] ? '／威力 ' + mv[3] : ''}${acc < 100 ? '／命中 ' + acc : ''}${pri ? '／先制 ' + (pri > 0 ? '+' : '') + pri : ''}`
      + `${E.HITS[k] ? '／' + (E.HITS[k][1] || E.HITS[k][0] + ' 下') : ''}）PP ${M.pp[k]}/${mv[5]}`;
    const desc = String(mv[4] || '').replace(/\s+/g, '').slice(0, 70);
    if (E.SIM_SUP[k]) { L.push(`${head}：${desc}`); continue; }
    L.push(`${head}：` + foes.map(([D, j]) => `[${j}]${nameOf(E, D)}${st.sd[1 - s].act === j ? '(場上)' : ''} ${dmgText(E, ctx, st, M, D, k)}`).join('｜'));
    L.push(`        說明：${desc}`);
  }
  return L;
}
// 第 0 方場上那隻這回合不能選的招式與原因（simOpts 濾掉的；原因只分辨得出常見的幾種）
function cantText(E, st, O) {
  const M = st.sd[0].mons[st.sd[0].act];
  if (!O.every(o => o.t === 'mv' || o.t === 'sw')) return '';
  const can = new Set(O.filter(o => o.t === 'mv').map(o => o.k));
  const why = k => M.pp[k] <= 0 ? 'PP 用完' : M.v.taunt && E.SIM_SUP[k] ? '被挑釁' : M.v.dis?.k === k ? '被定身' : M.lock && M.lock !== k ? '講究鎖住別的招'
    : M.v.enc ? '被再來一次' : '一定會失敗或條件不符（例如滿血不能回復、上場第一回合限定、對手已有異常）';
  const no = M.moves.filter(k => !can.has(k));
  return no.length ? '【這回合不能選】' + no.map(k => `${E.MOVES[k]?.[0] || k}（${why(k)}）`).join('、') : '';
}
function fieldText(E, st) {
  const f = [], wx = E.simWx(st), ter = E.simTer(st);
  if (wx) f.push(`天氣 ${E.FIELD_ZH[wx] || wx}${st.wx?.n != null ? `（剩 ${st.wx.n} 回合）` : ''}`);
  if (ter) f.push(`場地 ${E.FIELD_ZH[ter] || ter}${st.ter?.n != null ? `（剩 ${st.ter.n} 回合）` : ''}`);
  if (st.troom) f.push(`戲法空間（${JSON.stringify(st.troom)}）`);
  ['我方', '對手'].forEach((who, s) => {
    const x = st.sd[s], h = Object.entries(x.haz).filter(([, v]) => v).map(([k, v]) => `${E.SIM_HAZ_ZH[k] || k}${v > 1 ? '×' + v : ''}`);
    const sc = Object.entries(x.scr || {}).map(([k, v]) => `${E.MOVES[k]?.[0] || k}（剩 ${v}）`);
    const o = [...h, ...sc, x.tw > 0 && `順風（剩 ${x.tw}）`, x.wish && '祈願'].filter(Boolean);
    if (o.length) f.push(`${who}場上：${o.join('、')}`);
  });
  return f.join('；') || '無';
}
function show(r, G) {
  const { E, ctx, st } = r, out = [];
  out.push(`===== ${r.over ? '對戰結束' : `選擇 #${r.di}：第 ${st.turn + 1} 回合${r.phase === 'replace' ? '（補位：選誰上場）' : ''}`} =====`);
  out.push('【剛剛發生的事】');
  st.log.slice(r.logAt).forEach(t => out.push('  ' + t.trim()));
  if (r.over) {
    const w = E.simWinner(st);
    out.push(w === 0 ? '結果：我方（你）贏' : w === 1 ? '結果：對手（AI）贏' : `結果：平手（打滿 ${E.SIM_MAX_TURN} 回合）`);
    return out.join('\n');
  }
  out.push(`【場地】${fieldText(E, st)}`);
  out.push('（傷害：範圍＝16 個亂數最低～最高、不含命中率與急所；期望＝含命中率的平均；打倒機率看目前 HP、不算急所，命中率不到 100 另外標）');
  ['我方（你）', '對手（AI）'].forEach((who, s) => { out.push(`【${who}】`); st.sd[s].mons.forEach((_, i) => out.push(...monBlock(E, ctx, st, s, i))); });
  const a = E.simSpeed(ctx, st, st.sd[0].mons[st.sd[0].act]), b = E.simSpeed(ctx, st, st.sd[1].mons[st.sd[1].act]);
  out.push(`【速度】場上我方 ${a}、對手 ${b}${st.troom ? '（戲法空間：慢的先動）' : ''} → 同先制等級時${a === b ? '同速（各 50%）' : E.simFaster(st, a, b) ? '我方先動' : '對手先動'}`);
  const cant = r.phase === 'turn' ? cantText(E, st, r.O[0]) : '';
  if (cant) out.push(cant);
  // 換人選項標換上場會吃的傷害（隱形岩、撒菱…）
  const lab = o => { const t = optLabel(E, st, 0, o); if (o.t !== 'sw') return t; const h = entryHurt(E, st, 0, o.i); return h ? `${t}（進場吃 ${pct(h, st.sd[0].mons[o.i].max)}%）` : t; };
  out.push('【可選】' + r.O[0].map((o, n) => `${n}) ${lab(o)}`).join('　'));
  out.push(`下指令：node tools/sim_play.js go ${G.file} 選項編號 [p隊伍編號] 理由`);
  out.push('（選擇編號是整局的局面編號；只有 AI 要選的局面（例如 AI 補位）不會給你看，所以編號會跳）');
  return out.join('\n');
}
// 走到下一個要選的局面並印出；有新算的 AI 選擇就存檔
function advance(file, G) {
  const r = replay(G);
  if (r.over && !G.w) { G.w = r.E.simWinner(r.st); r.dirty = true; }
  if (r.dirty) save(file, G);
  console.log(show(r, { ...G, file }));
}

// ---------- review：逐筆列第 0 方的選擇和 AI 的建議 ----------
function review(G) {
  const E = engine();
  console.log(`AI＝${G.ai}；隊伍 我方 ${G.T[0].map(k => E.MON[k].zh).join('、')} vs AI ${G.T[1].map(k => E.MON[k].zh).join('、')}；結果 ${G.w === 0 ? '我方贏' : G.w === 1 ? 'AI 贏' : G.w == null ? '還沒打完' : '平手'}`);
  // 標籤要局面才知道換成誰：重播一次，每個局面記下選項名稱
  const names = [];
  for (let i = 0; i < G.d.length; i++) {
    const r = replay(G, i);
    if (r.over) break;
    const lab = o => optLabel(E, r.st, 0, o), byKey = new Map(r.O[0].map(o => [E.simKey(o), lab(o)])), byKey1 = new Map(r.O[1].map(o => [E.simKey(o), optLabel(E, r.st, 1, o)]));
    names[i] = { me: byKey, ai: byKey1, st: `${nameOf(E, r.st.sd[0].mons[r.st.sd[0].act])}(${pct(r.st.sd[0].mons[r.st.sd[0].act].hp, r.st.sd[0].mons[r.st.sd[0].act].max)}%) vs ${nameOf(E, r.st.sd[1].mons[r.st.sd[1].act])}(${pct(r.st.sd[1].mons[r.st.sd[1].act].hp, r.st.sd[1].mons[r.st.sd[1].act].max)}%)`, turn: r.st.turn + 1, phase: r.phase };
  }
  G.d.forEach((D, i) => {
    const n = names[i];
    if (!n || D.auto || D.a == null) return;
    const me = n.me, sug = D.sug, q = D.ply1;
    const line = sug ? sug.opts[0].map((k, j) => `${me.get(k) || k} ${(sug.p[0][j] * 100).toFixed(0)}%／評分 ${sug.val[j].toFixed(3)}`).join('　') : '';
    const top = sug ? sug.opts[0][sug.p[0].indexOf(Math.max(...sug.p[0]))] : null, pq = q ? q.opts[q.p.indexOf(Math.max(...q.p))] : null;
    console.log(`\n#${i} 第 ${n.turn} 回合${n.phase === 'replace' ? '補位' : ''} ${n.st}：你選 ${me.get(D.a)}${D.pin != null ? `（p${D.pin}）` : ''}${top && top !== D.a ? '　★和 AI 建議不同' : ''}`);
    if (D.why) console.log(`  理由：${D.why}`);
    console.log(`  AI 建議你：${line}`);
    if (q) console.log(`  快速（ply1）建議你：${me.get(pq)}`);
    const mixAi = sug ? sug.opts[1].map((k, j) => [n.ai.get(k) || k, sug.p[1][j]]).filter(([, x]) => x > 0).map(([l, x]) => `${l} ${(x * 100).toFixed(0)}%`).join('、') : '';
    console.log(`  AI 自己出：${n.ai.get(D.ai)}${mixAi ? `（出法比例 ${mixAi}）` : ''}（算 ${D.ms} 毫秒）`);
  });
}

// ---------- mc：從局面實打 ----------
// 第 r 場：這一步第 0 方出 O[0][i]、第 1 方出 O[1][j]，之後雙方快速（ply1）照亂數打完（第 r 場的亂數各格同一組＝成對比較）。回傳第 0 方的分數
function mcGame(G, base, i, j, r) {
  const E = engine(), st = E.simClone(base.st), ctx = E.simCtx('s'), rnd = E.simRng(E.simHash(`${G.seed}|${base.di}|${r}`)), pick = (c, s, hit) => E.simGreedyPick(ctx, c, s, hit);
  st.log = null;
  const acts = [base.O[0][i], base.O[1][j]];
  if (base.phase === 'turn') E.simTurn(ctx, st, acts, rnd, 0, pick); else E.simReplace(st, acts, rnd);
  for (;;) {
    const ph = E.simPhase(st);
    if (ph === 'over') break;
    const a = E.simDecide(ctx, st, ph, rnd);
    if (ph === 'turn') E.simTurn(ctx, st, a, rnd, 0, pick); else E.simReplace(st, a, rnd);
  }
  const w = E.simWinner(st);
  return w === 0 ? 1 : w === 1 ? 0 : 0.5;
}
// 平均、標準誤、百分比（要放在下面呼叫 main() 之前：main 開頭同步執行的部分會用到）
const mean = xs => xs.reduce((t, x) => t + x, 0) / xs.length;
const se = xs => { const m = mean(xs); return Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)) / Math.sqrt(xs.length); };
const pc = x => (x * 100).toFixed(1) + '%';
// 局面 base 第 s 方各選項照 AI 這次算的出法比例（存檔的比例四捨五入過，加總不一定是 1，重新正規化）；沒有記錄就是實際出的那個 1
function pOf(E, base, s) {
  const sug = base.D.sug, O = base.O[s], key = s ? base.D.ai : base.D.a;
  const p = O.map(o => { const k = sug ? sug.opts[s].indexOf(E.simKey(o)) : -1; return k < 0 ? 0 : sug.p[s][k]; }), t = p.reduce((a, x) => a + x, 0);
  return t ? p.map(x => x / t) : O.map(o => E.simKey(o) === key ? 1 : 0);
}
// worker：t.di 局面（重播結果留著重用），t.i／t.j 雙方這一步的選項；t.s 有給（audit）時是第 t.s 方出第 t.j 個、
// 對方照 AI 算的出法比例抽（第 r 場各選項抽到同一個），回傳第 t.s 方的分數
if (!isMainThread) {
  const { G } = workerData, bases = new Map(), E = engine();
  const baseOf = di => { if (!bases.has(di)) bases.set(di, replay(G, di)); return bases.get(di); };
  parentPort.on('message', t => {
    const base = baseOf(t.di);
    if (t.s == null) return parentPort.postMessage({ ...t, sc: mcGame(G, base, t.i, t.j, t.r) });
    const k = E.simDraw(pOf(E, base, 1 - t.s), E.simRng(E.simHash(`${G.seed}|${t.di}|${t.r}|opp`))), sc = mcGame(G, base, t.s ? k : t.j, t.s ? t.j : k, t.r);
    parentPort.postMessage({ ...t, sc: t.s ? 1 - sc : sc });
  });
} else if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
// 給分析腳本用：require 這個檔案取得引擎與重播（局面 replay(G, 選擇編號).st）
module.exports = { engine, replay, load };

// 把 tasks 分給 nw 個 worker，每個結果回來呼叫 got
async function runTasks(G, tasks, nw, got) {
  let next = 0, done = 0;
  if (!tasks.length) return;
  await new Promise(resolve => {
    for (let w0 = 0; w0 < Math.min(nw, tasks.length); w0++) {
      const w = new Worker(__filename, { workerData: { G } });
      const give = () => { if (next < tasks.length) w.postMessage(tasks[next++]); else w.terminate(); };
      w.on('message', m => { got(m); if (++done === tasks.length) resolve(); give(); });
      w.on('error', e => { console.error(e); process.exit(1); });
      give();
    }
  });
}
// 雙方每種選擇組合各打 n 場（第 0 方的分數），印矩陣，再列雙方各選項對「對手照 AI 這次算的出法比例」與「對手實際出的」的得分率
async function mc(G, di, n, nw) {
  const E = engine(), base = replay(G, di);
  if (base.over || base.di !== di) throw new Error(`#${di} 不是要選的局面`);
  const O = base.O, tasks = [], sc = O[0].map(() => O[1].map(() => [])), t0 = Date.now(), f = pc;
  O[0].forEach((_, i) => O[1].forEach((_, j) => { for (let r = 0; r < n; r++) tasks.push({ di, i, j, r }); }));
  await runTasks(G, tasks, nw, m => { sc[m.i][m.j][m.r] = m.sc; });
  const lab = O.map((os, s) => os.map(o => optLabel(E, base.st, s, o)));
  // 照出法比例 p 混合各格（第 r 場同一組亂數：先把每場的分數照比例加權，再算平均與標準誤）
  const mix = (cells, p) => { const xs = cells[0].map((_, r) => cells.reduce((t, c, k) => t + p[k] * c[r], 0)); return `${f(mean(xs))} ± ${(se(xs) * 100).toFixed(1)}`; };
  const sug = base.D.sug;
  const valOf = (s, o) => { const k = sug && s === 0 ? sug.opts[0].indexOf(E.simKey(o)) : -1; return k >= 0 ? `、評分 ${sug.val[k].toFixed(3)}` : ''; };
  const act = [O[0].findIndex(o => E.simKey(o) === base.D.a), O[1].findIndex(o => E.simKey(o) === base.D.ai)], p = [pOf(E, base, 0), pOf(E, base, 1)];
  console.log(`#${di} 第 ${base.st.turn + 1} 回合${base.phase === 'replace' ? '補位' : ''}：雙方每種組合各 ${n} 場（這一步照組合出、之後雙方快速照亂數打完；${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
  console.log('第 0 方（你）得分率矩陣：列＝你、欄＝AI');
  console.log('  ' + ['', ...lab[1]].join('｜'));
  O[0].forEach((_, i) => console.log(`  ${lab[0][i]}｜${O[1].map((_, j) => f(mean(sc[i][j]))).join('｜')}`));
  console.log('你的各選項：對 AI 照它算的出法比例｜對 AI 實際出的');
  O[0].forEach((_, i) => console.log(`  ${lab[0][i]}（AI 建議你 ${f(p[0][i])}${valOf(0, O[0][i])}）：${mix(sc[i], p[1])}｜${f(mean(sc[i][act[1]]))}${i === act[0] ? '　← 你選的' : ''}`));
  console.log('AI 的各選項（AI 的得分率）：對你照 AI 算的你的出法比例｜對你實際出的');
  const inv = O[1].map((_, j) => O[0].map((_, i) => sc[i][j].map(x => 1 - x)));
  O[1].forEach((_, j) => console.log(`  ${lab[1][j]}（AI 出法比例 ${f(p[1][j])}）：${mix(inv[j], p[0])}｜${f(mean(inv[j][act[0]]))}${j === act[1] ? '　← AI 出的' : ''}`));
}

// audit：整局每個局面，第 s 方（sides，預設只看 AI＝1）有 2 個以上選項的，每個選項各打 n 場（對方照 AI 這次算的出法比例抽、之後雙方快速照亂數打完），
// 損失＝最好的選項 − 照實際出法（AI：這次算的出法比例；玩家：實際選的）的得分率，同一場各選項同一組亂數算成對差的標準誤。
// 最好的選項是事後從 n 場挑的，損失會略為高估（場數越少越明顯）
async function audit(G, n, nw, sides) {
  const E = engine(), pts = [], t0 = Date.now();
  for (let di = 0; di < G.d.length; di++) {
    const base = replay(G, di);
    if (base.over || base.di !== di) break;
    // 玩家只有一個選項（auto）或還沒選的不算
    sides.forEach(s => { if (base.O[s].length > 1 && !(s === 0 && (base.D.auto || base.D.a == null))) pts.push({ di, s, base }); });
  }
  const tasks = [], sc = new Map();
  pts.forEach(({ di, s, base }) => { sc.set(`${di}|${s}`, base.O[s].map(() => [])); base.O[s].forEach((_, j) => { for (let r = 0; r < n; r++) tasks.push({ di, s, j, r }); }); });
  console.log(`${pts.length} 個局面、${tasks.length} 場（${nw} 個執行緒）`);
  await runTasks(G, tasks, nw, m => { sc.get(`${m.di}|${m.s}`)[m.j][m.r] = m.sc; });
  const who = s => s ? 'AI' : '你';
  const rows = pts.map(({ di, s, base }) => {
    const V = sc.get(`${di}|${s}`), m = V.map(mean), best = m.indexOf(Math.max(...m)), O = base.O[s];
    const p = s ? pOf(E, base, 1) : O.map(o => E.simKey(o) === base.D.a ? 1 : 0), act = O.findIndex(o => E.simKey(o) === (s ? base.D.ai : base.D.a));
    const loss = V[0].map((_, r) => V[best][r] - V.reduce((t, x, j) => t + p[j] * x[r], 0));
    const st = base.st, A = M => `${nameOf(E, M)}(${pct(M.hp, M.max)}%)`, lab = O.map(o => optLabel(E, st, s, o));
    const head = `#${di} 第 ${st.turn + 1} 回合${base.phase === 'replace' ? '補位' : ''} ${who(s)}｜${A(st.sd[s].mons[st.sd[s].act])} vs ${A(st.sd[1 - s].mons[st.sd[1 - s].act])}`;
    const mix = s ? '出法 ' + p.map((x, j) => x > 0 ? `${lab[j]} ${(x * 100).toFixed(0)}%` : '').filter(Boolean).join('、') + ` → 出了${lab[act]}` : `選了${lab[act]}`;
    return { s, L: mean(loss), S: se(loss), line: `${head}：損失 ${(mean(loss) * 100).toFixed(1)} ± ${(se(loss) * 100).toFixed(1)} 點；${mix}；最好 ${lab[best]}\n    各選項${who(s)}得分率：${lab.map((l, j) => `${l} ${pc(m[j])}`).join('｜')}` };
  });
  rows.forEach(x => console.log(x.line));
  console.log(`\n（${((Date.now() - t0) / 1000).toFixed(0)} 秒；每個選項 ${n} 場，對方這一步照 AI 算的出法比例抽、之後雙方快速打完）`);
  sides.forEach(s => {
    const xs = rows.filter(x => x.s === s);
    if (!xs.length) return;
    const big = xs.filter(x => x.L >= 0.05 && x.L > 2 * x.S).sort((a, b) => b.L - a.L);
    console.log(`${who(s)}：${xs.length} 個局面，損失合計 ${(xs.reduce((t, x) => t + x.L, 0) * 100).toFixed(1)} 點；明顯的（≥ 5 點且 > 2 倍標準誤）${big.length} 個：${big.map(x => x.line.split('：')[0].split(' ')[0] + ` ${(x.L * 100).toFixed(1)}`).join('、') || '無'}`);
  });
}

async function main() {
  const [mode, file, ...a] = process.argv.slice(2);
  if (!file) throw new Error('用法見 tools/sim_play.js 開頭：new／show／go／review／mc／audit');
  if (mode === 'new') {
    const seed = +(a[0] || 20261118), ai = a[1] || 'tree:400', top = +(a[2] || 60);
    if (!/^(ply1|tree:\d+)$/.test(ai)) throw new Error(`AI 寫 ply1 或 tree:次數（例如 tree:400），收到「${ai}」`);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const G = { seed, ai, top, T: team2(seed, top), d: [] };
    save(file, G);
    advance(file, G);
  } else if (mode === 'show') advance(file, load(file));
  else if (mode === 'go') {
    const G = load(file), r = replay(G);
    if (r.over) { advance(file, G); return; }
    const n = +a[0];
    if (!Number.isInteger(n) || !r.O[0][n]) throw new Error(`選項編號要是 0～${r.O[0].length - 1}，收到「${a[0]}」`);
    let rest = a.slice(1), pin = null;
    if (/^p\d$/.test(rest[0] || '')) { pin = +rest[0].slice(1); rest = rest.slice(1); }
    Object.assign(r.D, { a: engine().simKey(r.O[0][n]), ...(pin != null && { pin }), ...(rest.length && { why: rest.join(' ') }) });
    save(file, G);
    advance(file, G);
  } else if (mode === 'review') review(load(file));
  else if (mode === 'mc') {
    const G = load(file), di = +a[0], n = +(a[1] || 60), nw = Math.max(1, Math.min(+(a[2] || 4), os.cpus().length - 1));
    if (!Number.isInteger(di)) throw new Error('用法：node tools/sim_play.js mc 檔案 選擇編號 [每格場數 60] [執行緒 4]');
    await mc(G, di, n, nw);
  } else if (mode === 'audit') {
    const G = load(file), n = +(a[0] || 60), nw = Math.max(1, Math.min(+(a[1] || 4), os.cpus().length - 1)), sides = a[2] === 'all' ? [1, 0] : [1];
    if (!n || a[2] && !['ai', 'all'].includes(a[2])) throw new Error('用法：node tools/sim_play.js audit 檔案 [每個選項場數 60] [執行緒 4] [ai／all]');
    await audit(G, n, nw, sides);
  } else throw new Error('用法見 tools/sim_play.js 開頭：new／show／go／review／mc／audit');
}

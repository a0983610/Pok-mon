// 一步一步和模擬 AI 對打（單打，各 6 隻選 3 隻）：第 0 方＝玩家（人或 subagent 下指令），第 1 方＝AI（預設 tree:400＝模擬分頁「標準」）。
// 用途：讓「不是模擬引擎」的玩家打一場，看 AI 的選擇哪裡怪、玩家的選擇和 AI 建議哪裡不同，再用 mc 從那個局面實打驗證誰對。
// 選角時看得到對手的 6 隻、看不到對手帶誰；帶出場後雙方看得到對方帶的 3 隻的完整配置（同 tools/sim_ai.js 預設：AI 看得到對手的招式道具特性）。不需要 Showdown。
// 用法（在 repo 根目錄；檔案＝這一局的紀錄 JSON，建議放 AgentData\temp\sim_play\）：
//   node tools/sim_play.js new 檔案 [種子 20261118] [AI tree:400] [排名前幾名 60] [隊伍 6]
//     隨機兩隊（同 sim_ai.js：單打前幾名、同家族不重複、超級進化最多 1 隻、配招 Showdown 預設、道具同一隊不重複）。
//     隊伍 6（預設）＝各 6 隻：AI 用模擬選帶法（bringSim，單執行緒約 1～3 分鐘）帶 3 隻，印出雙方 6 隻給玩家選（見 bring）；
//     隊伍 3＝直接各 3 隻、先發第一隻（2026-11-19 以前的做法），印出第一個要選的局面
//   node tools/sim_play.js bring 檔案 先發編號 編號 編號 [理由…]   隊伍 6 的局：第 0 方帶哪 3 隻（[0]～[5]，第一個先發）
//   node tools/sim_play.js show 檔案                 印出目前要選的局面（還沒選角就印雙方 6 隻；打完了就印結果）
//   node tools/sim_play.js go 檔案 選項編號 [p隊伍編號] [理由…]
//     第 0 方選「可選」裡的第幾個；用急速折返類（或被吼走）要換上誰可加 p0／p1／p2（隊伍編號，沒給照簡單規則 simGreedyPick）；
//     理由會記進檔案（賽後 review 看）。AI 這一步早就在同一個局面選好了（雙方同時出），不會看你的選擇
//   node tools/sim_play.js review 檔案              賽後：選角（第 0 方帶的和出戰選角會建議它帶的），再逐筆列第 0 方的選擇、理由，
//     和 AI（同一次樹搜尋）建議第 0 方的出法比例、各選項評分、快速（ply1）的建議
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
  'simBaseKey', 'simCtx', 'simClone', 'simHit', 'simExp', 'simAcc', 'simSwitch', 'simSpeed', 'simFaster', 'simTypes', 'simWx', 'simTer', 'simWinner', 'simDraw',
  'simPri', 'FLAG', 'SIM_SEC', 'SIM_RECOIL', 'SIM_DRAIN', 'SIM_STANCE', 'bringPlan', 'SIM_OHKO', 'simMoveZh', 'simMoveType', 'WX_AB', 'TER_AB'];
// 出戰選角（bringPlan）要用的 traitScan 在網頁的 js/ui/team.js（整個檔一載入就會碰畫面元素）：只取 THREAT_N 和 NO_WEATHER～traitScan 那一段（同 tools/sim_ai.js）
function traitSrc(txt) {
  const a = txt.indexOf('const NO_WEATHER'), b = txt.indexOf('\nconst warnShort'), t = txt.match(/^const THREAT_N = .*$/m);
  if (a < 0 || b < a || !t) throw new Error('js/ui/team.js 找不到 traitScan 那一段（THREAT_N、NO_WEATHER～warnShort 之前），出戰選角用不了');
  return t[0] + '\n' + txt.slice(a, b);
}
let E0;
function engine() {
  if (E0) return E0;
  const g = { console };
  vm.createContext(g);
  vm.runInContext([...FILES.map(f => fs.readFileSync(path.join(R, f), 'utf8')), traitSrc(fs.readFileSync(path.join(R, 'js/ui/team.js'), 'utf8'))].join('\n;\n')
    + `\n;globalThis.E = { ${NAMES.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} };`, g);
  return E0 = g.E;
}
const load = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const save = (f, G) => fs.writeFileSync(f, JSON.stringify(G, null, 1));

// ---------- 組隊（同 tools/sim_ai.js 的 teams，一組） ----------
function team2(seed, top, size) {
  const E = engine(), rnd = E.simRng(seed), pickOf = xs => xs[Math.floor(rnd() * xs.length)];
  const pool = E.MONS.filter(m => m.rank.s > 0 && m.rank.s <= top).map(m => m.key), fam = k => E.MON[k].base || k;
  const one = () => {
    const T = [];
    while (T.length < size) { const k = pickOf(pool); if (!T.some(x => fam(x) === fam(k)) && !(E.MON[k].base && T.some(x => E.MON[x].base))) T.push(k); }
    return T;
  };
  return [one(), one()];
}
// 出戰選角（bringPlan）第 1 名的帶法：keys（6 隻）對上對手 opp（6 隻；看不到對手帶誰，雙方配招都照 Showdown 常見）帶哪幾隻
// （隊伍索引，先發排第一；同 simMyPlan）。隊伍裡超級進化最多 1 隻，不會遇到「只能進化一隻」
const planOf = (E, keys, opp) => E.bringPlan(keys.map(k => ({ defs: E.MON[k].types, key: k })), opp.map(k => E.MON[k]), 's');
const leadFirst = (c, lead) => [lead, ...c.idx.filter(j => j !== lead)];
function bringIdx(E, keys, opp) {
  const plan = planOf(E, keys, opp);
  return leadFirst(plan.combos[0], plan.pick.js[0]);
}
// AI 用模擬選帶法（同 tools/sim_ai.js 的 bringSim、網頁出戰選角的「用模擬比較帶法」；2026-11-19 sim_ai vs 量過：對「照第 1 名帶」得分率 58.8%±2.3
// （猜的對手帶法故意不含對手實際帶的保守版））：第 s 方的候補＝出戰選角第 1 名組合換三種先發＋第 2～BSIM_C 名組合（先發照 leadOf）；
// 對手的帶法＝把對手也當成用出戰選角選（看得到我方 6 隻）的前 BSIM_SC 種。每個候補對每種對手帶法打 BSIM_K 場（雙方快速 ply1、我方當第 0 方、
// 同一場候補之間同一組亂數），挑得分率（贏 1、平手 0.5）最高的，同分取前面的。單執行緒約 1～3 分鐘。
// 回傳 { js 隊伍索引（先發排第一）, at 第幾個候補（0＝和出戰選角第 1 名一樣）, sc 各候補得分率 }
const BSIM_C = 4, BSIM_SC = 5, BSIM_K = 16;
function bringSim(E, six, s, seed) {
  const mine = six[s], opp = six[1 - s], items = six.map(keys => E.simItems(keys, 's'));
  const mp = planOf(E, mine, opp), top = mp.combos[0], lead0 = mp.pick.js[0], op = planOf(E, opp, mine);
  const cands = [lead0, ...top.idx.filter(j => j !== lead0)].map(l => leadFirst(top, l)).concat(mp.combos.slice(1, BSIM_C).map(c => leadFirst(c, mp.leadOf(c).js[0])));
  const scs = op.combos.slice(0, BSIM_SC).map(c => leadFirst(c, op.leadOf(c).js[0]));
  // 這次選角的場次共用計算快取（我方固定第 0 方、每隻的配招道具固定）；每場複製一份 ctx 物件，推演的同速輪流（ctx.flip）不帶到下一場
  const shared = E.simCtx('s');
  const sc = cands.map(js => {
    let t = 0;
    scs.forEach((oj, r) => {
      for (let i = 0; i < BSIM_K; i++) {
        const ctx = { ...shared }, rnd = E.simRng(E.simHash(`bring:${seed}:${s}:${r}:${i}`)), pick = (c, x, hit) => E.simGreedyPick(ctx, c, x, hit);
        const st = E.simStart([[js, mine, items[s]], [oj, opp, items[1 - s]]].map(([idx, keys, its], x) => ({ mons: idx.map(j => E.simMon(keys[j], undefined, its[j], x, 's')) })), false);
        for (;;) {
          const ph = E.simPhase(st);
          if (ph === 'over') break;
          const a = E.simDecide(ctx, st, ph, rnd);
          if (ph === 'turn') E.simTurn(ctx, st, a, rnd, 0, pick); else E.simReplace(st, a, rnd);
        }
        const w = E.simWinner(st);
        t += w === 0 ? 1 : w === 1 ? 0 : 0.5;
      }
    });
    return t / (scs.length * BSIM_K);
  });
  const at = sc.indexOf(Math.max(...sc));
  return { js: cands[at], at, sc: sc.map(r3) };
}
// 雙方帶出場的 { keys 寶可夢 key（先發排第一）, items 道具 }：隊伍 6 的局照 G.pick（G.six 的索引），道具照 6 隻分配（同一隊不重複）再取帶的；
// 隊伍 3 的局是 G.T，道具照 3 隻分配
function lineup(E, G) {
  if (!G.six) return G.T.map(keys => ({ keys, items: E.simItems(keys, 's') }));
  if (!G.pick[0]) throw new Error('還沒選角：先用 bring 選第 0 方帶哪 3 隻');
  return G.six.map((six, s) => { const items = E.simItems(six, 's'); return { keys: G.pick[s].map(j => six[j]), items: G.pick[s].map(j => items[j]) }; });
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
  const st = E.simStart(lineup(E, G).map((x, s) => ({ mons: x.keys.map((k, j) => E.simMon(k, undefined, x.items[j], s, 's')) })), true);
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
const optLabel = (E, st, s, o) => o.t === 'mv' ? E.simMoveZh(o.k) : o.t === 'sw' ? `換成 [${o.i}] ${nameOf(E, st.sd[s].mons[o.i])}`
  : o.t === 'rech' ? '休息（這回合不能動）' : o.t === 'pass' ? '不用換' : o.t === 'none' ? '什麼都不能做' : o.t;
// 打倒機率：各下 16 個亂數（不算急所）加總 ≥ hp 的比例；3 下以內全部列舉，更多下回傳 null（只標「可能打倒」）
function koP(rows, hp) {
  if (rows.length > 3) return null;
  let n = 0, all = 0;
  const go = (h, sum) => { if (h === rows.length) { all++; if (sum >= hp) n++; return; } rows[h].forEach(x => go(h + 1, sum + x)); };
  go(0, 0);
  return n / all;
}
// A 用招式 k 打 D：傷害範圍（16 個亂數的最低～最高，連續攻擊各下加總；不含命中率）、期望（含命中率）、打倒機率（看 D 現在的 HP、不算急所，命中率另外標），
// 再加上自己會吃的（selfText）。一擊必殺只寫命中率（期望值模式的傷害是「剩下的 HP × 命中率」，寫成範圍會誤導）
function dmgText(E, ctx, st, A, D, k) {
  const r = E.simHit(ctx, st, A, D, k, false, true);
  if (!r.eff) return '無效' + (r.fail ? `（${r.fail}）` : '');
  if (E.SIM_OHKO.has(k)) return `一擊必殺：命中 ${r.acc}%，打中就倒下${E.simHit(ctx, st, A, D, k, false, false).endured ? '（現在滿 HP 帶氣勢披帶，會撐住剩 1）' : ''}`;
  const lo = r.rolls.reduce((t, x) => t + x[0], 0), hi = r.rolls.reduce((t, x) => t + x[15], 0), ex = E.simExp(ctx, st, A, D, k);
  const acc = Math.min(100, Math.round(E.simAcc(st, A, D, k, false))), cond = acc < 100 ? `（要命中，命中率 ${acc}%）` : '';
  let ko = '';
  if (r.endured && D.hp >= D.max && hi >= D.hp) ko = '，會被氣勢披帶／結實撐住';
  else if (hi >= D.hp) { const p = koP(r.rolls, D.hp); ko = (p == null ? '，可能打倒' : p >= 1 ? '，確定打倒' : `，打倒機率 ${Math.round(p * 100)}%`) + cond; }
  return `${pct(lo, D.max)}～${pct(hi, D.max)}%（期望 ${pct(ex, D.max)}%${ko}）${selfText(E, A, D, k, Math.min(ex, D.hp))}`;
}
// A 用 k 打 D 自己會吃的：反作用力（打出傷害 × 比例，dealt＝期望打出的傷害）、接觸懲罰（凸凸頭盔每打中一下 1/6、粗糙皮膚 1/8，同 simContactHurt；
// 接觸同 simMove：特性遠隔不算）
function selfText(E, A, D, k, dealt) {
  const xs = [], rc = E.SIM_RECOIL[k];
  if (rc) xs.push(`反作用力約自己 ${pct(dealt * rc[0] / rc[1], A.max)}%`);
  if (E.FLAG.contact.has(k) && A.b.ab !== 'long-reach') {
    const f = (D.item === 'rocky-helmet' ? 1 / 6 : 0) + (D.b.ab === 'rough-skin' ? 1 / 8 : 0);
    if (f) xs.push(`每打中一下自己扣 ${pct(A.max * f, A.max)}%（${[D.item === 'rocky-helmet' && '凸凸頭盔', D.b.ab === 'rough-skin' && '粗糙皮膚'].filter(Boolean).join('、')}）`);
  }
  return xs.length ? `，${xs.join('，')}` : '';
}
// 換下場就清掉的狀態（M.v）：看得懂的寫中文，程式內部的記錄不列；沒列在這裡的照欄位名稱列
const V_HIDE = new Set(['mt', 'got', 'up', 'metro', 'fc', 'mim', 'asw', 'aswUsed', 'protUsed', 'stall', 'fickle', 'pt', 'types', 'encK', 'fling', 'b0']);
const V_ZH = { db: '同命中（下次出招前被打倒，打倒牠的也會倒下）', taunt: '被挑釁', seed: '被寄生種子', curse: '被詛咒', yawn: '打哈欠（回合結束睡著）', focus: '集氣', charge: '充電', trap: '不能換人',
  prot: '守住中', endure: '挺住', conf: '混亂', flinch: '畏縮', octo: '被蛸固纏住', shackle: '被縫影縫住', hblock: '回復封鎖', tchop: '不能用聲音招式',
  smack: '被擊落（在地面）', mrise: '電磁飄浮', mini: '變小', attract: '著迷', salt: '鹽醃', syrup: '糖漿炸彈', impr: '封印', gastro: '特性失效',
  add: '加上了屬性', spe: '速度互換過', roost: '羽棲（這回合失去飛行）', glaive: '巨劍突擊後（受到傷害 ×2）', ff: '引火發動', unb: '輕裝發動',
  hangry: '飽了又餓（空腹）', cud: '反芻', beak: '加熱鳥嘴', fallen: '大將' };
function volText(E, M) {
  return Object.entries(M.v).filter(([k, x]) => x && !V_HIDE.has(k)).map(([k, x]) =>
    k === 'sub' ? `替身（剩 ${pct(x, M.max)}%）` : k === 'stock' ? `蓄力 ${x} 次` : k === 'dis' ? `${E.MOVES[x.k]?.[0] || x.k}被定身` : k === 'enc' ? `被再來一次（只能用${E.MOVES[M.v.encK]?.[0] || ''}）`
      : k === 'rage' ? `逆鱗類鎖住${E.MOVES[x.k]?.[0] || ''}` : k === 'bind' ? '被綁住' : k === 'taunt' && typeof x === 'number' ? `被挑釁（剩 ${x} 回合）` : V_ZH[k] || k);
}
// 招式的附加效果（SIM_SEC：機率＋異常／畏縮／混亂／能力變化）、反作用力與吸血的比例
function effText(E, k) {
  const sts = o => Object.entries(o).map(([s, v]) => `${STAT_ZH[s] || s}${v > 0 ? '+' : ''}${v}`).join('、');
  const stt = s => [].concat(s).map(x => E.SIM_STATUS_ZH[x] || x).join('／');
  const xs = (E.SIM_SEC[k] || []).map(x => `${x.c}% ${x.s ? stt(x.s) : x.fl ? '畏縮' : x.cf ? '混亂' : x.d ? '對手' + sts(x.d) : x.me ? '自己' + sts(x.me) : '特殊效果（見說明）'}`);
  const frac = r => r[1] === 100 ? `${r[0]}%` : `${r[0]}/${r[1]}`;
  if (E.SIM_RECOIL[k]) xs.push(`反作用力＝打出傷害的 ${frac(E.SIM_RECOIL[k])}`);
  if (E.SIM_DRAIN[k]) xs.push(`吸血＝打出傷害的 ${frac(E.SIM_DRAIN[k])}`);
  if (k === 'avalanche') xs.push('這回合先被對手打到時威力 ×2（畫面照上一回合有沒有被打估）');
  return xs.join('、');
}
// 特性戰鬥切換（堅盾劍怪）：出招時變刀劍形態、王者盾牌變盾牌形態（同 simStance）；回傳 [盾牌形態, 刀劍形態] 的複本，不是就 null
const stanceForms = (E, M) => M.b.ab === 'stance-change' && !M.tf && Object.values(E.SIM_STANCE).includes(M.key)
  ? [{ ...M, fk: E.SIM_STANCE.shield }, { ...M, fk: E.SIM_STANCE.blade }] : null;
// 第 s 方隊伍第 i 隻換上場會吃多少（隱形岩、撒菱…）：在複本上換一次看 HP 少多少
function entryHurt(E, st, s, i) {
  const c = E.simClone(st), M = c.sd[s].mons[i], h0 = M.hp;
  c.log = null;
  E.simSwitch(c, s, i, null);
  return Math.max(0, h0 - Math.max(0, M.hp));
}
const descOf = (tab, k) => String(tab?.[k]?.[1] || '').replace(/\s+/g, '');
// 資料沒有說明（或沒有中文名）的特性（冠軍版的超級進化）：[中文名（資料有就空字串）, 模擬怎麼算]，照 js/engine/sim.js、damage.js 的處理寫
const ABIL_NOTE = {
  'mega-sol': ['', '自己出招時一律當成晴天：火屬性 ×1.5、水屬性 ×0.5（下雨也一樣）、日光束不用蓄力、氣象球變火屬性；場上實際的天氣不變'],
  'spicy-spray': ['', '被攻擊招式打中時，讓攻擊方灼傷（火屬性等本來不會灼傷的不受）'],
  'aerilate': ['', '一般屬性招式變成飛行屬性，威力 ×1.2'],
  'dragonize': ['', '一般屬性招式變成龍屬性，威力 ×1.2'],
  'fire-mane': ['', '火屬性招式的攻擊 ×1.5'],
  'fairy-aura': ['', '雙方的妖精屬性招式威力 ×1.33（自己或對手有這個特性都算）'],
  'parental-bond': ['', '只打一下的單體攻擊招式改成打兩下，第 2 下傷害 ¼'],
  'aura-guard': ['', '受到接觸招式的傷害減半；特性互換、遊魂、木乃伊、胃液對它沒用'],
  'innards-out': ['', '被攻擊招式打倒時，打倒牠的寶可夢受到和那一招打掉的 HP 一樣多的傷害'],
  'shadow-tag': ['踩影', '對手不能換人（幽靈屬性、同樣是踩影的不受影響；急速折返類、被吹走照樣換）'],
  'unseen-fist': ['無形拳', '接觸招式穿透守住類（含廣域／快速防守），穿透時傷害 ¼'],
  'piercing-drill': ['', '接觸招式穿透守住類（含廣域／快速防守），穿透時傷害 ¼'],
  'eelevate': ['', '（模擬沒有處理這個特性）'],
};
const abName = (E, k) => E.abilZh(k) || ABIL_NOTE[k]?.[0] || k;
// pre＝選角時的預覽（沒有誰在場上，不標場上／後排）
function monBlock(E, ctx, st, s, i, pre = false) {
  const M = st.sd[s].mons[i], act = !pre && st.sd[s].act === i;
  if (M.hp <= 0) return [`  [${i}] ${nameOf(E, M)}：倒下`];
  const boost = Object.entries(M.st).filter(([, v]) => v).map(([k, v]) => `${STAT_ZH[k] || k}${v > 0 ? '+' : ''}${v}`).join(' ');
  // 睡眠：每次輪到出招減 1（早起減 2），減完還大於 0 才繼續睡（同 simMove）
  const stt = M.status ? (E.SIM_STATUS_ZH[M.status] || M.status) + (M.status === 'slp' ? `（第 ${M.b.ab === 'early-bird' ? Math.ceil(M.slp / 2) : M.slp} 次輪到出招時醒來並行動）` : M.status === 'tox' ? `（計數 ${M.tox}，每回合扣的越來越多）`
    : M.status === 'frz' ? `（計數 ${M.frz}：每次輪到出招減 1，減到 0 一定融化，沒到 0 時每次 1/4 機率融化）` : '') : '';
  const bs = E.MON[M.fk || M.key]?.bs || E.MON[M.key].bs, mega = !!E.MON[M.key].base;
  const L = [`  [${i}] ${pre ? '' : act ? '★場上 ' : '後排 '}${nameOf(E, M)}（${E.simTypes(M).map(t => tz(E, t)).join('／')}）HP ${Math.max(0, M.hp)}/${M.max}（${pct(M.hp, M.max)}%）`
    + (stt ? `｜${stt}` : '') + (boost ? `｜能力 ${boost}` : '') + `｜道具 ${M.item ? E.ITEMS?.[M.item]?.[0] || M.item : mega ? '超級石（已超級進化）' : '無'}｜特性 ${abName(E, M.b.ab)}`
    + `｜速度 ${E.simSpeed(ctx, st, M)}｜種族值 ${bs.join('/')}`];
  L.push(`      特性：${descOf(E.ABILS, M.b.ab) || ABIL_NOTE[M.b.ab]?.[1] || '（沒有說明）'}${M.item && descOf(E.ITEMS, M.item) ? `｜道具：${descOf(E.ITEMS, M.item)}` : ''}`);
  const extra = [M.lock && `講究鎖住${E.MOVES[M.lock]?.[0]}`, M.chg && `蓄力中${E.MOVES[M.chg]?.[0]}`, M.rech && '下回合要休息', act && M.last && `上一招${E.simMoveZh(M.last)}`,
    ...(act ? volText(E, M) : [])].filter(Boolean);
  if (extra.length) L.push(`      狀態：${extra.join('、')}`);
  const foes = st.sd[1 - s].mons.map((D, j) => [D, j]).filter(([D]) => D.hp > 0);
  // 戰鬥切換：自己出攻擊招時照刀劍形態算；對手是戰鬥切換的，盾牌、刀劍兩種形態都列（牠先出招就變刀劍形態挨打）
  const myForms = stanceForms(E, M), atk = myForms ? myForms[1] : M;
  if (myForms) L.push('      （戰鬥切換：出攻擊招時變刀劍形態，下面自己的傷害照刀劍形態算；用王者盾牌變回盾牌形態）');
  for (const k of M.moves) {
    const mv = E.MOVES[k], acc = mv[6] ?? 100, pri = E.simPri(st, M, k), pri0 = E.simPri(st, { ...M, b: { ...M.b, ab: '' } }, k);
    // 實際的屬性（氣象球照天氣、皮膚類特性等，simMoveType），和資料上的不同時註明
    const ty = E.simMoveType(st, atk, k) || mv[1];
    const head = `      ${mv[0]}（${tz(E, ty)}${ty !== mv[1] ? `（原本${tz(E, mv[1])}）` : ''}／${CAT_ZH[mv[2]] || mv[2]}${mv[3] ? '／威力 ' + mv[3] : ''}${acc < 100 ? '／命中 ' + acc : ''}`
      + `${pri ? '／先制 ' + (pri > 0 ? '+' : '') + pri + (pri !== pri0 ? `（${abName(E, M.b.ab)}）` : '') : ''}${E.FLAG.contact.has(k) ? '／接觸' : ''}`
      + `${E.HITS[k] ? '／' + (E.HITS[k][1] || E.HITS[k][0] + ' 下') : ''}）PP ${M.pp[k]}/${mv[5]}`;
    const desc = String(mv[4] || '').replace(/\s+/g, '').slice(0, 70), eff = effText(E, k);
    if (E.SIM_SUP[k]) { L.push(`${head}：${desc}`); continue; }
    L.push(`${head}：` + foes.map(([D, j]) => {
      const fs = stanceForms(E, D), name = `[${j}]${nameOf(E, D)}${!pre && st.sd[1 - s].act === j ? '(場上)' : ''}`;
      return fs ? `${name} 盾牌形態 ${dmgText(E, ctx, st, atk, fs[0], k)}／刀劍形態 ${dmgText(E, ctx, st, atk, fs[1], k)}` : `${name} ${dmgText(E, ctx, st, atk, D, k)}`;
    }).join('｜'));
    L.push(`        說明：${desc}${eff ? `｜附加：${eff}` : ''}`);
  }
  return L;
}
// 第 0 方場上那隻這回合不能選的招式與原因（simOpts 濾掉的；原因只分辨得出常見的幾種）
function cantText(E, st, O) {
  const M = st.sd[0].mons[st.sd[0].act];
  if (!O.every(o => o.t === 'mv' || o.t === 'sw')) return '';
  const can = new Set(O.filter(o => o.t === 'mv').map(o => o.k));
  const why = k => M.pp[k] <= 0 ? 'PP 用完' : k === 'destiny-bond' && M.v.db ? '同命連續使用會失敗' : M.v.taunt && E.SIM_SUP[k] ? '被挑釁' : M.v.dis?.k === k ? '被定身' : M.lock && M.lock !== k ? '講究鎖住別的招'
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
const DMG_NOTE = '（傷害：範圍＝16 個亂數最低～最高、不含命中率與急所；期望＝含命中率的平均（所以可能比最低還低）；打倒機率看目前 HP、不算急所，命中率不到 100 另外標；'
  + '後面列自己會吃的反作用力、凸凸頭盔等）';
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
  out.push(DMG_NOTE);
  ['我方（你）', '對手（AI）'].forEach((who, s) => { out.push(`【${who}】`); st.sd[s].mons.forEach((_, i) => out.push(...monBlock(E, ctx, st, s, i))); });
  // 補位時場上有倒下的，速度比較沒有意義，不列
  if (r.phase === 'turn') {
    const a = E.simSpeed(ctx, st, st.sd[0].mons[st.sd[0].act]), b = E.simSpeed(ctx, st, st.sd[1].mons[st.sd[1].act]);
    out.push(`【速度】場上我方 ${a}、對手 ${b}${st.troom ? '（戲法空間：慢的先動）' : ''} → 同先制等級時${a === b ? '同速（各 50%）' : E.simFaster(st, a, b) ? '我方先動' : '對手先動'}`);
  }
  const cant = r.phase === 'turn' ? cantText(E, st, r.O[0]) : '';
  if (cant) out.push(cant);
  // 換人選項標換上場會吃的傷害（隱形岩、撒菱…）
  const lab = o => {
    const t = optLabel(E, st, 0, o);
    if (o.t !== 'sw') return t;
    const h = entryHurt(E, st, 0, o.i), B = st.sd[0].mons[o.i];
    return h >= B.hp ? `${t}（進場就會被打倒）` : h ? `${t}（進場吃 ${pct(h, B.max)}%）` : t;
  };
  out.push('【可選】' + r.O[0].map((o, n) => `${n}) ${lab(o)}`).join('　'));
  out.push(`下指令：node tools/sim_play.js go ${G.file} 選項編號 [p隊伍編號] 理由`);
  out.push('（選擇編號是整局的局面編號；只有 AI 要選的局面（例如 AI 補位）不會給你看，所以編號會跳）');
  return out.join('\n');
}
// 選角：雙方 6 隻（第 0 方的角度），每隻的配置、招式對對方每一隻的傷害（同局面的格式）。
// 雙方 6 隻排成一個局面來算：simStart 開局時第一隻發動的出場效果（開天氣場地、變身、種子等）都不要，換回剛做好的寶可夢、清掉天氣場地
function preview(G, file) {
  const E = engine(), ctx = E.simCtx('s'), mons = G.six.map((six, s) => { const items = E.simItems(six, 's'); return six.map((k, j) => E.simMon(k, undefined, items[j], s, 's')); });
  const st = E.simStart(mons.map(ms => ({ mons: ms })), false, []);
  st.sd.forEach((x, s) => { x.mons = mons[s]; });
  st.wx = st.ter = null;
  const out = ['===== 選角：雙方各 6 隻，選 3 隻帶出場（第一隻先發） =====',
    `（看得到對手的 6 隻、看不到對手帶哪 3 隻；AI ${G.bsim ? '用模擬比較出戰選角前幾名的帶法再挑' : '照出戰選角的建議帶'}，也看不到你帶誰。帶出場後雙方都看得到對方帶的 3 隻）`,
    DMG_NOTE, '（選角的傷害都是滿 HP、沒有能力變化、沒有天氣場地；出場特性（威嚇、開天氣場地等）沒算）'];
  // 出場會開天氣／場地的（simEntryField 的 WX_AB、TER_AB）：上面的傷害沒算，另外列
  const field = mons.flatMap((ms, s) => ms.map(M => [s, M, E.WX_AB[M.b.ab] || E.TER_AB[M.b.ab]]).filter(x => x[2]))
    .map(([s, M, f]) => `${s ? '對手' : '我方'}${nameOf(E, M)}出場開${E.FIELD_ZH[f] || f}`);
  if (field.length) out.push(`【出場會開天氣／場地（上面的傷害沒算）】${field.join('、')}`);
  ['我方（你）', '對手（AI）'].forEach((who, s) => { out.push(`【${who}】`); st.sd[s].mons.forEach((_, i) => out.push(...monBlock(E, ctx, st, s, i, true))); });
  out.push(`下指令：node tools/sim_play.js bring ${file} 先發編號 編號 編號 理由（我方方括號裡的 [0]～[5]）`);
  return out.join('\n');
}
// 走到下一個要選的局面並印出（還沒選角就印選角）；有新算的 AI 選擇就存檔
function advance(file, G) {
  if (G.six && !G.pick[0]) { console.log(preview(G, file)); return; }
  const r = replay(G);
  if (r.over && !G.w) { G.w = r.E.simWinner(r.st); r.dirty = true; }
  if (r.dirty) save(file, G);
  console.log(show(r, { ...G, file }));
}

// ---------- review：逐筆列第 0 方的選擇和 AI 的建議 ----------
function review(G) {
  const E = engine(), L = lineup(E, G), zh = keys => keys.map(k => E.MON[k].zh).join('、');
  console.log(`AI＝${G.ai}；隊伍 我方 ${zh(L[0].keys)} vs AI ${zh(L[1].keys)}（先發排第一）；結果 ${G.w === 0 ? '我方贏' : G.w === 1 ? 'AI 贏' : G.w == null ? '還沒打完' : '平手'}`);
  if (G.six) {
    const sug = bringIdx(E, G.six[0], G.six[1]).map(j => G.six[0][j]);
    console.log(`選角：雙方 6 隻 我方 ${zh(G.six[0])}｜AI ${zh(G.six[1])}`);
    console.log(`  你帶 ${zh(L[0].keys)}；出戰選角第 1 名會建議你帶 ${zh(sug)}${sug.join() === L[0].keys.join() ? '（一樣）' : '　★不同'}`);
    if (G.bwhy) console.log(`  理由：${G.bwhy}`);
    if (G.bsim) console.log(`  AI 用模擬選：${G.bsim.at ? `第 ${G.bsim.at + 1} 個候補（和出戰選角第 1 名不同）` : '和出戰選角第 1 名一樣'}；` +
      `各候補得分率 ${G.bsim.sc.map(x => (x * 100).toFixed(0) + '%').join('、')}（前 3 個＝第 1 名組合換先發，之後＝第 2～${BSIM_C} 名組合）`);
  }
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
  if (!file) throw new Error('用法見 tools/sim_play.js 開頭：new／bring／show／go／review／mc／audit');
  if (mode === 'new') {
    const seed = +(a[0] || 20261118), ai = a[1] || 'tree:400', top = +(a[2] || 60), size = +(a[3] || 6);
    if (!/^(ply1|tree:\d+)$/.test(ai)) throw new Error(`AI 寫 ply1 或 tree:次數（例如 tree:400），收到「${ai}」`);
    if (![3, 6].includes(size)) throw new Error(`隊伍寫 6（各 6 隻選 3 隻）或 3（直接 3 對 3），收到「${a[3]}」`);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const T = team2(seed, top, size);
    // 隊伍 6：six＝雙方 6 隻，pick＝雙方帶的（six 的索引，先發排第一；AI 的現在就用模擬選好（bsim 記選了第幾個候補與各候補得分率），第 0 方的等 bring）
    let G;
    if (size === 6) {
      console.log('AI 用模擬選帶法中（約 1～3 分鐘）…');
      const b = bringSim(engine(), T, 1, seed);
      G = { seed, ai, top, six: T, pick: [null, b.js], bsim: { at: b.at, sc: b.sc }, d: [] };
    } else G = { seed, ai, top, T, d: [] };
    save(file, G);
    advance(file, G);
  } else if (mode === 'bring') {
    const G = load(file);
    if (!G.six) throw new Error('這局是直接 3 對 3（new 的隊伍 3），沒有選角');
    if (G.pick[0]) throw new Error('這局已經選過角了');
    const js = a.slice(0, 3).map(Number);
    if (js.length < 3 || js.some(j => !Number.isInteger(j) || !G.six[0][j]) || new Set(js).size < 3)
      throw new Error(`要寫 3 個不同的隊伍編號（我方方括號裡的 [0]～[${G.six[0].length - 1}]，第一個先發），收到「${a.slice(0, 3).join(' ')}」`);
    G.pick[0] = js;
    if (a.length > 3) G.bwhy = a.slice(3).join(' ');
    save(file, G);
    advance(file, G);
  } else if (mode === 'show') advance(file, load(file));
  else if (mode === 'go') {
    const G = load(file), r = replay(G);
    if (r.over) { advance(file, G); return; }
    const n = +a[0];
    if (!Number.isInteger(n) || !r.O[0][n]) throw new Error(`選項編號要是 0～${r.O[0].length - 1}，收到「${a[0]}」`);
    let rest = a.slice(1), pin = null;
    if (/^p\d+$/.test(rest[0] || '')) {
      pin = +rest[0].slice(1); rest = rest.slice(1);
      const P = r.st.sd[0].mons[pin];
      if (!P || P.hp <= 0 || r.st.sd[0].act === pin) throw new Error(`p 後面要寫後排還站著的隊伍編號（畫面上 [0]～[${r.st.sd[0].mons.length - 1}] 方括號裡的數字），收到「p${pin}」`);
    }
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
  } else throw new Error('用法見 tools/sim_play.js 開頭：new／bring／show／go／review／mc／audit');
}

// 單打對位勝率的事先計算：產生 repo 根目錄的 sim-matrix.js（網頁「隊伍分析」「出戰選角」的單打對位直接查，不用打開頁面再在背景算）。
// 用法（在 repo 根目錄）：
//   node tools/sim_matrix.js [排名前幾名 100]   單打排名前幾名（含超級進化）照 OP.GG 最常見的配招互打，重寫 sim-matrix.js（28 執行緒約幾分鐘）
//   node tools/sim_matrix.js check [組數 200]   從 sim-matrix.js 隨機挑幾組，用現在的引擎重算比對（同一組的亂數種子固定，引擎沒改應該完全一樣）
// mons-data.js 更新（MONS_DATE 變了）就要重跑：日期不一樣網頁不用這份，全部改在背景算。模擬引擎改過也要重跑（check 會抓到不一樣的）。
// 算法和網頁一樣：直接呼叫 roles.js 的 duelVs，它要的勝率（duelP 排進 SIM_P_WANT 的）交給 worker_threads 跑 simDuelP（同網頁的背景計算）。
// 第一輪先算正面對打（這輪把不帶亂數模擬一場的 simDuel 換成直接回傳輸，免得每組白打一場），算好後第二輪 duelVs 才知道哪些要算換上來那場，
// 第三輪確認沒有漏的。對手常帶超級石的，duelVs 會連超級進化型態一起要，不在前幾名的也照收（keys 排在後面，只有用到的格子有值）。
const fs = require('fs'), vm = require('vm'), path = require('path'), os = require('os');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sim-matrix.js');

// 載入網頁的計算引擎（不碰 DOM 的部分）
function load() {
  const g = { console };
  vm.createContext(g);
  vm.runInContext(['base-stats.js', 'mons-data.js', 'js/engine/core.js', 'js/engine/roles.js', 'js/engine/damage.js', 'js/engine/sim.js']
    .map(f => fs.readFileSync(path.join(R, f), 'utf8')).join('\n;\n') + `
;const realDuel = simDuel;
globalThis.E = { MONS, MON, MONS_DATE, SIM_DUEL_N, duelVs, simDuelP, simPDone, MATCH_MEMO, MATCH_P, SIM_P_WANT,
  fakeDuel: on => { simDuel = on ? () => ({ win: false }) : realDuel; } };`, g);
  return g.E;
}

if (!isMainThread) {
  const E = load();
  parentPort.on('message', ({ k, args }) => parentPort.postMessage({ k, p: E.simDuelP(...args) }));
} else main();

// 把 want（key → simDuelP 的參數）分給 worker 算，算好的 simPDone 存進 MATCH_P
function compute(E, want, what) {
  const ks = [...want.keys()], n = Math.max(1, Math.min(os.cpus().length - 1, ks.length));
  if (!ks.length) return Promise.resolve();
  let next = 0, done = 0, shown = 0;
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const wks = Array.from({ length: n }, () => {
      const w = new Worker(__filename);
      const give = () => { if (next < ks.length) { const k = ks[next++]; w.postMessage({ k, args: want.get(k) }); } };
      w.on('message', ({ k, p }) => {
        E.simPDone(k, p);
        done++;
        if (Date.now() - shown > 5000) { shown = Date.now(); process.stdout.write(`  ${what}：${done}／${ks.length}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）\n`); }
        if (done === ks.length) { wks.forEach(x => x.terminate()); resolve(); } else give();
      });
      w.on('error', reject);
      give();
      return w;
    });
  });
}

// pairs＝[[我方 key, 對手 key]...]：duelVs 跑一遍，回傳這輪要算的勝率（清掉對位快取，照目前 MATCH_P 重算）
function sweep(E, pairs) {
  E.MATCH_MEMO.clear();
  for (const [xk, yk] of pairs) E.duelVs(xk, undefined, 's', E.MON[yk]);
  const want = new Map(E.SIM_P_WANT);
  E.SIM_P_WANT.clear();
  return want;
}

// 三輪（正面 → 換上來 → 確認沒漏），回傳 MATCH_P
async function run(E, pairs) {
  E.fakeDuel(true);
  await compute(E, sweep(E, pairs), '正面對打');
  await compute(E, sweep(E, pairs), '換上來');
  const left = sweep(E, pairs);
  E.fakeDuel(false);
  if (left.size) throw new Error(`第三輪還有 ${left.size} 組沒算`);
  return E.MATCH_P;
}

// MATCH_P 的 key（roles.js duelPKey：[fmt, 我方 key, 配招, 道具, 對手 key, 換上來剩下的 HP]）拆開
const parse = k => { const [fmt, xk, set, item, yk, left] = JSON.parse(k); return { fmt, xk, set, item, yk, left }; };
const enc = p => { const v = Math.round(p * 60); if (Math.abs(v - p * 60) > 1e-9) throw new Error(`勝率 ${p} 不是 1/60 的倍數`); return String.fromCharCode(48 + v); };

async function main() {
  const E = load();
  if (process.argv[2] === 'check') return check(E, +process.argv[3] || 200);
  const TOP = +process.argv[2] || 100, t0 = Date.now();
  const pool = E.MONS.filter(m => m.rank.s > 0 && m.rank.s <= TOP).map(m => m.key);
  console.log(`單打前 ${TOP} 名（含超級進化）${pool.length} 隻互打，每組 ${E.SIM_DUEL_N} 場，${os.cpus().length - 1} 個執行緒`);
  const P = await run(E, pool.flatMap(xk => pool.map(yk => [xk, yk])));
  // keys：前幾名照排名，duelVs 另外要到的（超級進化型態）排在後面
  const extra = new Set();
  for (const k of P.keys()) { const { xk, yk } = parse(k); [xk, yk].forEach(x => pool.includes(x) || extra.add(x)); }
  const keys = [...pool, ...[...extra].sort()], at = Object.fromEntries(keys.map((k, i) => [k, i])), N = keys.length;
  const head = Array(N * N).fill('~'), sw = Array(N * N).fill('~'), seen = new Map();
  for (const [k, p] of P) {
    const { fmt, xk, set, item, yk, left } = parse(k);
    if (fmt !== 's' || set !== null || item !== null) throw new Error(`不是單打預設配招的勝率：${k}`);
    const c = at[xk] * N + at[yk];
    if (left != null) {
      // 換上來剩下的 HP 只跟兩隻有關（matchup），同一組只會有一個
      if (seen.has(c) && seen.get(c) !== left) throw new Error(`${xk} 對 ${yk} 換上來的 HP 有兩種：${seen.get(c)}、${left}`);
      seen.set(c, left);
    }
    (left == null ? head : sw)[c] = enc(p);
  }
  const body = { date: E.MONS_DATE, n: E.SIM_DUEL_N, top: TOP, keys, head: head.join(''), sw: sw.join('') };
  fs.writeFileSync(OUT, '// 自動產生（node tools/sim_matrix.js），不要手改。單打排名前 ' + TOP + ' 名（含超級進化）照 OP.GG 最常見的配招互打的勝率'
    + '（roles.js 的 duelVs 要的 simDuelP，每組 n 場）。\n'
    + '// 第 i 隻（我方）對第 j 隻（對手）在 head（正面對打）／sw（換上來）的第 i × keys.length + j 個字：\'0\' 起算 0～60（勝率 × 60），\'~\' 是沒算；'
    + 'date＝用的 mons-data.js 的 MONS_DATE（不一樣網頁就不用）\n'
    + 'const SIM_MATRIX = ' + JSON.stringify(body) + ';\n');
  const cnt = s => [...s].filter(c => c !== '~').length;
  console.log(`寫好 ${path.relative(R, OUT)}：${N} 隻（前 ${TOP} 名 ${pool.length}＋超級進化型態 ${extra.size}），正面 ${cnt(body.head)} 組、換上來 ${cnt(body.sw)} 組，`
    + `${(fs.statSync(OUT).size / 1024).toFixed(0)} KB，${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
}

// 隨機挑 n 組（我方、對手都在 keys 裡、正面有算的），用現在的引擎重算正面與換上來，和檔案比
async function check(E, n) {
  if (!fs.existsSync(OUT)) { console.error('還沒有 sim-matrix.js，先跑 node tools/sim_matrix.js'); process.exit(1); }
  const g = {};
  vm.createContext(g);
  vm.runInContext(fs.readFileSync(OUT, 'utf8') + '\n;globalThis.M = SIM_MATRIX;', g);
  const M = g.M, N = M.keys.length;
  if (M.date !== E.MONS_DATE || M.n !== E.SIM_DUEL_N) console.log(`⚠ 檔案是 ${M.date}、每組 ${M.n} 場，現在的資料是 ${E.MONS_DATE}、${E.SIM_DUEL_N} 場：網頁不會用這份，要重跑`);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const cells = [...M.head].map((c, i) => c === '~' ? -1 : i).filter(i => i >= 0), pick = new Set();
  while (pick.size < Math.min(n, cells.length)) pick.add(cells[Math.floor(rnd() * cells.length)]);
  const pairs = [...pick].map(c => [M.keys[Math.floor(c / N)], M.keys[c % N]]);
  console.log(`重算 ${pairs.length} 組（連同 duelVs 要的超級進化型態與換上來那場）`);
  const P = await run(E, pairs), at = Object.fromEntries(M.keys.map((k, i) => [k, i]));
  let same = 0, diff = 0, out = 0;
  for (const [k, p] of P) {
    const { xk, yk, left } = parse(k), i = at[xk], j = at[yk];
    if (i == null || j == null) { out++; continue; }
    const c = M[left == null ? 'head' : 'sw'][i * N + j];
    if (c !== '~' && (c.charCodeAt(0) - 48) / 60 === p) same++;
    else { diff++; if (diff <= 20) console.log(`  不一樣：${E.MON[xk].zh} 對 ${E.MON[yk].zh}${left == null ? '（正面）' : '（換上來）'} 檔案 ${c === '~' ? '沒算' : ((c.charCodeAt(0) - 48) / 60 * 100).toFixed(0) + '%'}、重算 ${(p * 100).toFixed(0)}%`); }
  }
  console.log(`一樣 ${same} 組、不一樣 ${diff} 組${out ? `、檔案沒收的 ${out} 組` : ''}`);
  if (diff) process.exitCode = 1;
}

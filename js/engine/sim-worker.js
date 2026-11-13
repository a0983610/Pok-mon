// 模擬對戰的背景計算（Web Worker）：只載入資料與模擬引擎（不碰 DOM）。兩種工作：
// ① 打一場（js/ui/sim.js 的 runSim 開）：收到 { i 對手第幾種帶法, sides [我方, 對手]（每方 { mons }）, opt simPlay 的 opt, log 要不要逐回合紀錄 }，
//   回傳 { i, res, turns, log, mons [我方, 對手] 每隻的 { key, out, kos, hp } }（simTally 用到的）；
// ② 一個局面每個選擇的勝率（js/ui/battle.js 的推薦出招開）：收到 { view: { id, st 局面, iters } }，回傳 { id, view: simView 的結果 }；
// ③ 單打一對一的勝率（js/ui/simbg.js 開）：收到 { duel: { k 對位的 key, args simDuelP 的參數 [fmt, x, yk, left] } }，回傳 { duel: k, p }。
// 一個背景計算裡的場次共用計算快取（同 runSim 在畫面這邊打時共用一個 simCtx）
importScripts('../../base-stats.js', '../../mons-data.js', 'core.js', 'roles.js', 'damage.js', 'sim.js');
const simWkCtx = simCtx('s');
onmessage = e => {
  if (e.data.view) {
    const { id, st, iters } = e.data.view;
    postMessage({ id, view: simView(simWkCtx, st, iters) });
    return;
  }
  if (e.data.duel) {
    const { k, args } = e.data.duel;
    postMessage({ duel: k, p: simDuelP(...args) });
    return;
  }
  const { i, sides, opt, log } = e.data, o = simPlay(simWkCtx, sides, Math.random, log, opt);
  postMessage({ i, res: o.res, turns: o.turns, log: o.log, mons: o.mons.map(ms => ms.map(m => ({ key: m.key, out: m.out, kos: m.kos, hp: m.hp }))) });
};

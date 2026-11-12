// 模擬對戰的背景計算（Web Worker，js/ui/sim.js 的 runSim 開）：只載入資料與模擬引擎（不碰 DOM），一次打一場。
// 收到 { i 對手第幾種帶法, sides [我方, 對手]（每方 { mons }）, opt simPlay 的 opt, log 要不要逐回合紀錄 }，
// 回傳 { i, res, turns, log, mons [我方, 對手] 每隻的 { key, out, kos, hp } }（simTally 用到的）。
// 一個背景計算只跑同一次模擬（我方配招固定），場次之間共用計算快取，同 runSim 在畫面這邊打時共用一個 simCtx
importScripts('../../base-stats.js', '../../mons-data.js', 'core.js', 'roles.js', 'damage.js', 'sim.js');
const simWkCtx = simCtx('s');
onmessage = e => {
  const { i, sides, opt, log } = e.data, o = simPlay(simWkCtx, sides, Math.random, log, opt);
  postMessage({ i, res: o.res, turns: o.turns, log: o.log, mons: o.mons.map(ms => ms.map(m => ({ key: m.key, out: m.out, kos: m.kos, hp: m.hp }))) });
};

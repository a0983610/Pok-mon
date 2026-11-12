// ---------- 對戰模擬 ----------
// 我方帶出場：sel 點選的隊伍格子（點的順序）、lead 先發的格子、evo 超級進化的格子；沒點過（sel 是 null）用出戰選角的建議（simMyPlan）。
// k 對手每種帶法打幾場、algo 決策方式（這兩個是收合的「賽前：對手每一種帶法的勝率」用）；run 模擬中（{ stop }）、res 上一次的結果、
// tree 一步一步推演（點對手先發開始，或賽前結果的「看怎麼打」；這三個不存網址）
const SIM_KS = [10, 30, 100];
// 決策方式（simPlay 的 opt）：快速＝往前算一回合、標準／精細＝樹搜尋每步 400／800 次；ms＝瀏覽器實測每場約幾毫秒（2026-11-11，估時間用）
const SIM_ALGOS = [
  { id: 'fast', zh: '快速', opt: { algo: 'ply1' }, ms: 50, hint: '每步把雙方各種出法都試算一回合' },
  { id: 'std', zh: '標準', opt: { algo: 'tree', iters: 400 }, ms: 640, hint: '每步往下打 400 次到分出勝負（樹搜尋）' },
  { id: 'fine', zh: '精細', opt: { algo: 'tree', iters: 800 }, ms: 1500, hint: '每步往下打 800 次到分出勝負（樹搜尋，最強）' },
];
// 樹狀圖每一層總共試幾次（每一格平均分到）
const SIM_TREE_ITERS = 3000;
const sim = { sel: null, lead: -1, evo: -1, k: 10, algo: 'std', run: null, res: null, tree: null };
const simAlgo = id => SIM_ALGOS.find(a => a.id === id) || SIM_ALGOS[1];
// 預估時間的文字：秒數不到 1 分鐘寫秒，不然寫分鐘
const simEta = ms => ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} 秒` : `${Math.round(ms / 60000)} 分鐘`;
// 我方：隊伍分析挑了寶可夢的隊員（只選屬性的沒有能力值，不算）；這場要帶幾隻（單打 3 隻，不到 3 隻就全帶）。
// 模擬只做單打：隊伍分析切在雙打、配招還是雙打的預填（沒改過）時改用單打的預填
const simSetOf = (k, s) => team.fmt === 'd' && s && JSON.stringify(s) === JSON.stringify(defaultSet(k, 'd')) ? defaultSet(k, 's') : s;
const simMine = () => team.mons.map((k, i) => k ? { key: k, set: simSetOf(k, team.sets[i]), slot: i } : null).filter(Boolean);
// 這隻在模擬裡不算的招式（simCanUse 以外，見規則的「不算」）與有沒有攻擊招式
function simSkipped(x) {
  const ks = (x.set?.moves.some(Boolean) ? x.set : defaultSet(x.key, 's'))?.moves.filter(Boolean) || [];
  // 變身（百變怪）會拿到對手的招式，算有攻擊招式
  return { skip: ks.filter(k => MOVES[k] && !simCanUse(k)), atk: ks.some(k => MOVES[k] && simCanUse(k) && !SIM_SUP[k]) || ks.includes('transform') };
}
const simNeedN = () => Math.min(BRING_N.s, simMine().length);
const simPctText = (x, n) => n ? `${Math.round(x / n * 1000) / 10}%` : '—';
// 這場我方帶誰：{ slots 帶的格子（先發排第一；點選中可能不到 3 隻）, evo, custom 是不是自己點的 }
function simMyPick() {
  if (sim.sel) {
    const sel = sim.sel.filter(i => team.mons[i]), lead = sel.includes(sim.lead) ? sim.lead : sel[0];
    return { slots: lead == null ? [] : [lead, ...sel.filter(i => i !== lead)], evo: sim.evo, custom: true };
  }
  const mine = simMine(), p = simMyPlan(mine, bring.opp, 's');
  return { ...(p || { slots: mine.slice(0, simNeedN()).map(x => x.slot), evo: -1 }), custom: false };
}
// 開始自己點：從目前的帶法（建議的）接著改
function simEditPick() {
  if (sim.sel) return;
  const pk = simMyPick();
  Object.assign(sim, { sel: pk.slots.slice(), lead: pk.slots[0] ?? -1, evo: pk.evo });
}
// 6 選 k 有幾種
const simChoose = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); };
const simTeamText = ms => ms.map((m, i) => `${MON[m.key].zh}${i ? '' : '（先發）'}`).join('、');
// 我方帶法改了：進行中的推演（用舊的帶法開始的）就收掉
const simDropLive = () => { if (sim.tree?.live) sim.tree = null; };
function renderSim() {
  const mine = simMine(), pk = simMyPick(), need = simNeedN(), nOpp = bring.opp.filter(Boolean).length;
  const seg = (id, list, cur) => document.querySelectorAll(`#${id} button`).forEach((b, i) => b.setAttribute('aria-pressed', list[i] === cur));
  const skipText = x => { const s = simSkipped(x); return !s.atk ? '<span class="meta">⚠ 模擬裡沒有攻擊招式</span>'
    : s.skip.length ? `<span class="meta">不算：${s.skip.map(k => MOVES[k][0]).join('、')}</span>` : ''; };
  $('#sMine').innerHTML = mine.length ? mine.map(x => `<button class="mini" data-slot="${x.slot}" aria-pressed="${pk.slots.includes(x.slot)}">`
    + `${x.slot + 1} ${MON[x.key].zh}${chips(MON[x.key].types)}${skipText(x)}</button>`).join('')
    + (team.fmt === 'd' ? '<span class="muted small">模擬只做單打：目前切在雙打，建議的帶法、對手帶法的排名、沒改過的預填配招都照單打算。</span>' : '')
    : '<span class="muted small">先到「隊伍分析」挑好我方寶可夢（只選屬性的不算）。</span>';
  $('#sLeadRow').hidden = !pk.slots.length;
  $('#sLead').innerHTML = pk.slots.map(i => `<button data-lead="${i}" aria-pressed="${i === pk.slots[0]}">${MON[team.mons[i]].zh}</button>`).join('');
  const megas = pk.slots.filter(i => MON[team.mons[i]].base), up = megas.includes(pk.evo) ? pk.evo : megas[0];
  $('#sEvoRow').hidden = megas.length < 2;
  $('#sEvo').innerHTML = megas.map(i => `<button data-evo="${i}" aria-pressed="${i === up}">${MON[team.mons[i]].zh}</button>`).join('');
  $('#sReset').hidden = !pk.custom;
  seg('sK', SIM_KS, sim.k);
  seg('sAlgo', SIM_ALGOS.map(a => a.id), sim.algo);
  const al = simAlgo(sim.algo), combos = nOpp ? simChoose(nOpp, Math.min(BRING_N.s, nOpp)) : 0, total = combos * sim.k, wk = simWkN();
  $('#sAlgoHint').textContent = al.hint + (combos ? `；對手 ${combos} 種帶法各 ${sim.k} 場共 ${total} 場，約 ${simEta(al.ms * total / Math.max(1, wk * SIM_WK_EFF))}`
    + (wk ? `（${wk} 個背景計算一起打）` : '') : '');
  const ready = mine.length && pk.slots.length === need && nOpp, live = sim.tree?.live ? sim.tree : null;
  $('#sOpp').innerHTML = !nOpp ? '<span class="muted small">先到「出戰選角」選好對手的寶可夢。</span>'
    : bring.opp.map((k, i) => MON[k] ? `<button class="mini" data-opp="${i}" aria-pressed="${!!live && live.lead === i && live.oppKeys[i] === k}"${ready ? '' : ' disabled'}>`
      + `${MON[k].zh}${chips(MON[k].types)}</button>` : '').join('')
      + (ready ? '' : `<span class="muted small">${mine.length ? `我方要點滿 ${need} 隻。` : '先到「隊伍分析」挑好我方寶可夢（只選屬性的不算）。'}</span>`);
  $('#sRun').disabled = !!sim.run || !ready;
  $('#sStop').hidden = !sim.run;
  const r = sim.res;
  if (!sim.run) $('#sMsg').textContent = !mine.length ? '先到「隊伍分析」挑好我方寶可夢（只選屬性的不算）。'
    : !nOpp ? '先到「出戰選角」選好對手的寶可夢。' : pk.slots.length !== need ? `我方要點滿 ${need} 隻。`
    : !r ? '' : r.n < r.total ? `已停止，只跑了 ${r.n} 場。` : `完成 ${r.n} 場。`;
  $('#sResult').innerHTML = r ? simResultHTML(r)
    : '<p class="empty">按「開始模擬」後，這裡會列出對手每一種帶法下我方的勝率（最難應付的在前），點「看怎麼打」看開局雙方各種出招的勝率。</p>';
  // 正在填「改成實戰的結果」時不重畫推演（賽前整批跑完會呼叫這裡，填到一半的會被洗掉；推演的內容和這裡無關）
  if (!sim.tree?.edit) renderSimTree();
  saveState();
}
// 背景計算（js/engine/sim-worker.js）開幾個：電腦的執行緒數減 1（留一個給畫面），最多 SIM_WK_MAX；
// 直接開檔案（file://）時瀏覽器不准開背景計算，是 0（在畫面這邊一場一場打）。
// 實測（2026-11-11，i7-14700 28 執行緒、Chromium，標準每場）：1 個 308 毫秒、4 個平均 105、6 個 67、8 個 67、12 個 61、16 個 60，
// 8 個以上幾乎不會再快，所以最多開 8 個；估時間時當成每個背景計算抵 SIM_WK_EFF 個（8 個約快 4.6 倍）
const SIM_WK_MAX = 8, SIM_WK_EFF = 0.6;
const simWkN = () => location.protocol === 'file:' || typeof Worker === 'undefined' ? 0 : Math.max(1, Math.min(SIM_WK_MAX, (navigator.hardwareConcurrency || 2) - 1));
// 跑模擬：場次照對手每種帶法輪流排（中途停止時各帶法的場數也平均）。能開背景計算就分給 simWkN() 個一起打，
// 開不了、或載入失敗退回來的在畫面這邊打（每跑超過 50 毫秒讓畫面喘口氣）；按「停止」就不再派新的場次，以已打完的出結果
async function runSim() {
  const mine = simMine(), fmt = 's', pk = simMyPick();
  if (sim.run || pk.slots.length !== simNeedN() || !bring.opp.some(Boolean)) return;
  const scs = simOppScenarios(bring.opp, mine.map(x => x.key), fmt), my = { mons: simMySide(mine, pk.slots, pk.evo, fmt) };
  const al = simAlgo(sim.algo), k = sim.k, ctx = simCtx(fmt), run = sim.run = { stop: false };
  const res = { algo: al.id, k, total: k * scs.length, n: 0, my, sc: scs.map(sc => ({ ...sc, n: 0, win: 0, lose: 0, draw: 0, turns: 0 })), mine: {}, opp: {}, logs: {} };
  renderSim();
  const start = performance.now(), back = [];
  let next = 0, tMsg = start;
  // 下一場打對手第幾種帶法（-1＝沒有了或已停止）；背景計算失敗退回來的先打
  const take = () => run.stop ? -1 : back.length ? back.pop() : next < res.total ? next++ % scs.length : -1;
  const wantLog = () => !res.logs.win || !res.logs.lose;
  // 記一場的結果，每隔 200 毫秒更新進度（剩下的時間照目前每場平均估）
  const tally = (i, out) => {
    simTally(res, i, out);
    if (performance.now() - tMsg < 200) return;
    $('#sMsg').textContent = `模擬中… ${res.n}／${res.total} 場，預估還要 ${simEta((performance.now() - start) / res.n * (res.total - res.n))}`;
    tMsg = performance.now();
  };
  await Promise.all(Array.from({ length: simWkN() }, () => new Promise(done => {
    let w, cur = -1;
    const send = () => {
      cur = take();
      if (cur < 0) { w.terminate(); done(); } else w.postMessage({ i: cur, sides: [my, { mons: res.sc[cur].mons }], opt: al.opt, log: wantLog() });
    };
    try { w = new Worker('js/engine/sim-worker.js'); } catch { done(); return; }
    w.onmessage = e => { tally(e.data.i, e.data); send(); };
    w.onerror = e => { e.preventDefault(); if (cur >= 0) back.push(cur); cur = -1; w.terminate(); done(); };
    send();
  })));
  let t0 = performance.now();
  for (let i = take(); i >= 0; i = take()) {
    tally(i, simPlay(ctx, [my, res.sc[i]], Math.random, wantLog(), al.opt));
    if (performance.now() - t0 > 50) { await new Promise(r => setTimeout(r)); t0 = performance.now(); }
  }
  sim.run = null;
  sim.res = res;
  renderSim();
}
// 一場的結果加進統計：這種帶法的勝敗與回合數；我方每隻（上場、打倒、倒下）；對手每隻（帶牠的場數、那幾場我方贏幾場、打倒我方幾隻）
function simTally(res, i, out) {
  const sc = res.sc[i], kind = out.res > 0 ? 'win' : out.res < 0 ? 'lose' : '';
  res.n++;
  sc.n++;
  sc.turns += out.turns;
  sc[kind || 'draw']++;
  if (kind && out.log && !res.logs[kind]) res.logs[kind] = { i, log: out.log };
  out.mons[0].forEach(m => { const t = res.mine[m.key] ||= { n: 0, out: 0, kos: 0, faint: 0 }; t.n++; if (m.out) t.out++; t.kos += m.kos; if (m.hp <= 0) t.faint++; });
  out.mons[1].forEach(m => { const t = res.opp[m.key] ||= { n: 0, win: 0, kos: 0 }; t.n++; if (kind === 'win') t.win++; t.kos += m.kos; });
}
function simResultHTML(res) {
  if (!res.n) return '<p class="empty">沒有跑完任何一場。</p>';
  const nm = k => MON[k].zh, rate = sc => sc.win / sc.n, done = res.sc.filter(sc => sc.n);
  const avg = done.reduce((t, sc) => t + rate(sc), 0) / done.length, top = res.sc[0];
  const head = `<div class="res-head">模擬結果<span class="muted small">（單打；我方帶 ${simTeamText(res.my.mons)}；`
    + `對手 ${res.sc.length} 種帶法各 ${res.k} 場；決策方式${simAlgo(res.algo).zh}；共 ${res.n} 場）</span></div>`
    + `<div class="c-sum ${avg >= 0.5 ? 'good' : 'bad'}"><b>平均勝率 ${Math.round(avg * 1000) / 10}%</b>（各種帶法平均）`
    + (top.n ? `　對手照建議帶法（第 1 名：${simTeamText(top.mons)}）時 ${simPctText(top.win, top.n)}` : '') + '</div>';
  const rows = done.slice().sort((x, y) => rate(x) - rate(y) || x.rank - y.rank).map(sc => `<div class="combo"><span class="rank">#${sc.rank}</span>`
    + `<b>${simTeamText(sc.mons)}</b><span class="meta">我方勝率 ${simPctText(sc.win, sc.n)}（${sc.n} 場）・平均 ${Math.round(sc.turns / sc.n * 10) / 10} 回合</span>`
    + `<button class="mini" data-tree="${res.sc.indexOf(sc)}">看怎麼打</button></div>`).join('');
  const myRows = res.my.mons.map(m => { const t = res.mine[m.key] || { n: 0 };
    return `<div class="x-line"><b>${nm(m.key)}</b><span class="meta">${t.n ? `有上場 ${simPctText(t.out, t.n)}・平均打倒 ${Math.round(t.kos / t.n * 100) / 100} 隻・被打倒 ${simPctText(t.faint, t.n)}` : '—'}</span></div>`; }).join('');
  const oppRows = Object.entries(res.opp).sort((x, y) => x[1].win / x[1].n - y[1].win / y[1].n).map(([k, t]) => `<div class="x-line"><b>${nm(k)}</b>`
    + `<span class="meta">對手帶牠時我方勝率 ${simPctText(t.win, t.n)}（${t.n} 場）・平均打倒我方 ${Math.round(t.kos / t.n * 100) / 100} 隻</span></div>`).join('');
  const logBox = (kind, zh) => {
    const x = res.logs[kind];
    if (!x) return '';
    return `<details class="b-more"><summary>看一場${zh}的（對手帶 ${simTeamText(res.sc[x.i].mons)}）</summary>`
      + `<div class="small">${x.log.map(line => `<div>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('')}</div></details>`;
  };
  return head + `<h3>對手每種帶法</h3><p class="muted small b-intro">依我方勝率由低到高（最難應付的在前）；# 後面是這種帶法在「出戰選角」的「對手可能帶的」排第幾`
    + '（對手用同一套方法看我方 6 隻選的，先發也照它的挑法）。點「看怎麼打」看這種帶法開局雙方各種出招的勝率。</p>' + rows
    + `<h3>我方每隻</h3>${myRows}<h3>對手每隻</h3>${oppRows}`
    + `<h3>逐回合紀錄</h3>${logBox('win', '贏') + logBox('lose', '輸') || '<p class="muted small">這次沒有分出勝負的場次。</p>'}`
    + '<p class="note">※ 怎麼模擬：我方照上面點選的 3 隻與先發（一場只能超級進化一隻）；對手照「出戰選角」的 6 隻，6 選 3 的每一種帶法都打，'
    + '先發照對手用「出戰選角」的方法對這種帶法的挑法（對手看不到我方的配招；選一般型態、但某顆超級石使用率過半的當成超級進化）。' + simRulesText() + '</p>';
}
// 模擬的規則（賽前結果的說明與推演的「規則細節」共用）
function simRulesText() {
  return '每回合雙方同時決定出哪一招或換誰，'
    + '先估「我方出 X、對手出 Y」各組合的分數：快速＝每種組合都試算這一回合（傷害取平均）；標準、精細＝樹搜尋，每步從目前局面往下打 400／800 次，'
    + '每次雙方挑「目前看起來好、或還沒試夠」的選擇，照亂數打（傷害、急所、麻痺每次重抽），一路往下展開到沒走過的局面，'
    + '累積每個組合最後的勝負（比快速多看了之後幾回合怎麼打、以及運氣好壞）。展開不到的部分都用簡單規則（出最痛的一招；不怕被打時強化、撒菱，'
    + '打不太動時上異常狀態，HP 一半以下回復；倒下時換上一對一打得贏的）打到分出勝負。'
    + '雙方再各自找「對手不管怎麼應對都最不吃虧」的出法（同時出招的賽局解：可能是幾種選擇按比例混著出，像 70% 換人、30% 留場打，'
    + '只固定出一種會被對手抓到），照比例抽一種；倒下後換上誰也用同樣方法決定。'
    + '實測讓雙方用不同方式對打，標準、精細對快速的勝率約 60%、69%。實際出招時傷害抽 16 段亂數、'
    + '急所機率 1/24（容易擊中要害的招式、超幸運、焦點鏡各提高一級：1/8、1/2、必定），同速各 50%（用簡單規則往下打時同速照回合輪流誰先，免得偏向一方）。'
    + '倒下補位換上來又被撒菱類打倒的，再補到有人站著才打下一回合。'
    + '我方照「隊伍分析」登錄的配招（沒登錄的照 OP.GG 常見），對手照 OP.GG 使用率前 4 招、最常見的特性、能力點數與性格，道具同一隊不重複（使用率高的先拿）。'
    + '攻擊招式算傷害，加上招式本身的效果：擊掌奇襲、迎頭一擊只有上場後第一回合能用；大爆炸、自爆、薄霧炸裂用了自己倒下；'
    + '破壞光線等下一回合不能動；日光束、日光刃、電光束、挖洞、潛靈奇襲要先蓄力一回合（沒有天氣；挖洞、潛靈奇襲蓄力時打不到）；預知未來兩回合後打中；'
    + '突襲在對手沒出攻擊招式時失敗、快手還擊只在對手出先制招式時有效；流星群、近身戰等自己的能力變化（換下場歸零）；'
    + '勇鳥猛攻等反作用力、吸取拳等吸血、生命寶珠扣 1/10、鐵蹄光線扣一半；急速折返等打完換人、龍尾吼叫等讓對手換人；講究圍巾鎖招（被拍落就解除）；'
    + '氣勢披帶、抗性樹果、寶石用掉，氣球被打中就破，拍落打掉道具。欺詐用對手的攻擊算；地球上投、黑夜魔影固定 50、憤怒門牙打掉一半、蠻幹打到和自己一樣、'
    + '搏命打掉自己的 HP 後倒下；雙倍奉還、鏡面反射、金屬爆炸把這回合被打的物理／特殊／全部傷害 ×2／×2／×1.5 還回去（沒被打到就失敗）。'
    + '一擊必殺（地裂、角鑽、絕對零度、斷頭鉗）照命中率 30%（絕對零度不是冰屬性的用 20%、打冰屬性沒有效果），結實不受影響（對手特性是破格就照樣打倒）、氣勢披帶撐得住；'
    + '往下推演照期望值時算打掉剩下 HP 的 30%（20%）。'
    + '輔助招：強化（劍舞、詭計、龍之舞、破殼、腹鼓…）、守住類（守住、看穿、王者盾牌、尖刺防守、碉堡、挺住；連續用成功率 1/3、1/9…）、'
    + '回復（自我再生、羽棲、祈願、分擔痛楚、睡覺、吸取力量、寄生種子、治癒之願）、異常狀態（鬼火、劇毒、電磁波、哈欠、催眠粉…）、'
    + '撒菱類（隱形岩、撒菱、毒菱、黏黏網；清除濃霧、高速旋轉清掉）、擾亂（再來一次、挑釁、替身、反射壁、光牆、極光幕、吼叫、吹飛、黑霧、撒嬌等降對手能力、拋下狠話、臨別禮物）。'
    + '異常狀態照冠軍版：燒傷每回合扣 1/16 且物攻減半、中毒 1/8、劇毒 1/16 起逐回合加重、麻痺速度減半且 1/8 不能動、睡眠 2～3 回合。'
    + '道具與特性：吃剩的東西、文柚果、木子果、零餘果、凸凸頭盔、光之黏土、大根莖、貝殼之鈴、白色香草、心靈香草、氣球；'
    + '再生力、自然回復、毒療、蛻皮、魔法防守、惡作劇之心、黃金之軀、魔法鏡、毅力、同步、唱反調、恆淨之軀、鏡甲、不服輸、好勝、粗糙皮膚、各種異常免疫特性；'
    + '威嚇：出場時（開局雙方先發、換上場、倒下補位）對手場上那隻攻擊 −1，算法同「出戰選角」的對位（精神力、恆淨之軀等不吃威嚇的不降，不服輸、好勝等反而上升）。'
    + '變身（招式變身、百變怪的特性變身者出場時）：變成對手場上那隻的樣子，屬性、HP 以外的能力（含能力點數與性格）、能力變化、特性、招式（每招 PP 5）都照對手的，'
    + 'HP、異常狀態、道具照自己的；對手有替身、或有一方已經變身過的不能變；換下場就變回來。'
    + '不算：攻擊招式的追加效果（畏縮、灼傷、降能力…，連擊掌奇襲必定畏縮、冰凍之風必定降速度這種一定會發生的也不算）、天氣場地（極光幕只有特性降雪的能用）、威嚇與變身者以外的出場特性（如降雨、日照）、命中率（當全中，一擊必殺除外）、'
    + '戲法空間、順風、同命、接棒、戲法、滅亡之歌等其他輔助招，逆鱗的連續攻擊與混亂、羽棲當回合失去飛行屬性（不算的招式不會出，我方帶的隻上面會標）；'
    + '連續攻擊招式照「傷害計算」以 3 下計，雜技、掃墓等威力會變的招式照資料的威力（噴火、噴水會隨 HP 變小；'
    + '打草結、踢倒、重磅衝撞、高溫重壓照雙方體重，體重取自 Pokémon Showdown 的資料）。'
    + 'PP 照 OP.GG 冠軍版的數值（如羽棲、守住 8、地震 12），用一次扣 1、對手特性壓迫感時扣 2；能用的招式都沒 PP 時只能換人或掙扎（威力 50、沒有屬性，自己扣 1/4）。'
    + '連續兩回合雙方都沒扣血也沒換人時，打不到對方的攻擊招式就不能選（不然會原地空轉）；雙方同時全倒時最後倒下的一方贏（第五世代起的規則，同 Showdown：打倒對手最後一隻後被反作用力打倒算贏、大爆炸同歸於盡算輸）；打滿 100 回合算平手。'
    + '只是參考：雙方用同一套判斷，實戰對手不一定這樣選。';
}
// ---------- 一步一步推演（樹狀圖） ----------
// tree：{ live 是不是點對手先發開始的（對手後排是猜的）, title 賽前結果「看怎麼打」的對手帶法, ctx, edit 正在改成實戰的結果,
// path [{ st 局面, view simView 的結果（算好前是 null）, log 走到這一步的紀錄, acts 這一步雙方的選擇, forced／pin 被迫換人（simStep）}] }；
// live 時另有 lead 對手先發的格子、oppKeys 開始時對手的 6 格、roster（simOppRoster）、gs 換過幾次猜的後排（先換掉較早猜的用）
const simPath0 = st => [{ st, view: null, log: [], acts: null }];
// 賽前結果的「看怎麼打」：對手第 i 種帶法從開局推演
function simOpenTree(i) {
  const res = sim.res, sc = res.sc[i];
  sim.tree = { live: false, title: simTeamText(sc.mons), edit: false, ctx: simCtx('s'), path: simPath0(simStart([res.my, sc])) };
  renderSim();
  simCalcTree();
}
// 看到對手先發（對手第 slot 格）：我方照上面點的帶法，對手後排先猜「對手可能帶的」帶法裡會派這隻先發、排名最高的那種（見 simOppRoster）。
// 同一隻先發已經推演了幾步時再點一次，先確認要不要重來
function simStartLive(slot) {
  const mine = simMine(), pk = simMyPick(), t = sim.tree;
  if (pk.slots.length !== simNeedN()) return;
  if (t?.live && t.lead === slot && t.path.length > 1 && !confirm(`重新從開局推演？目前已經推到第 ${t.path.length - 1} 步。`)) return;
  const roster = simOppRoster(bring.opp, mine.map(x => x.key), 's'), g = roster?.guess(slot);
  if (!g) return;
  const sides = [{ mons: simMySide(mine, pk.slots, pk.evo, 's') }, { mons: simOppSide(roster, g.slots, g.evo, 's') }];
  sim.tree = { live: true, lead: slot, oppKeys: bring.opp.slice(), roster, gs: 0, edit: false, ctx: simCtx('s'), path: simPath0(simStart(sides)) };
  renderSim();
  simCalcTree();
}
// 把一隻猜的對手後排換成第 slot 格：換掉最後一步還沒上場的裡面較早猜的那隻；推演每一步裡還沒上場的都照新的帶法重建
// （一場只能超級進化一隻：上過場的已經是超級進化型態就是牠，不然是還沒上場的第一隻能超級進化的），每一步都要重算
function simSetGuess(t, slot) {
  const mons = t.path[t.path.length - 1].st.sd[1].mons, free = mons.map((m, q) => m.out ? -1 : q).filter(q => q >= 0);
  if (!t.roster.mems[slot] || mons.some(m => m.slot === slot) || !free.length) return;
  const q0 = free.reduce((a, q) => (mons[q].gs || 0) < (mons[a].gs || 0) ? q : a), slots = mons.map((m, q) => q === q0 ? slot : m.slot);
  const mega = i => !!MON[t.roster.mems[i].key].base, shown = mons.find(m => m.out && MON[simBaseKey(m)].base);
  const up = shown ? shown.slot : slots.find((i, q) => !mons[q].out && mega(i));
  t.gs++;
  t.path.forEach(p => {
    p.st.sd[1].mons = p.st.sd[1].mons.map((m, q) => m.out ? m
      : Object.assign(simOppMon(t.roster, slots[q], mega(slots[q]) && slots[q] !== up, 's'), { gs: q === q0 ? t.gs : m.gs }));
    simFixGuessed(p.st);
    p.view = null;
  });
  t.edit = false;
  simCalcTree();
}
// 對手的一隻 M 換成型態 key（超級進化了、或其實沒進化）：配招照那個型態的預設、招式沿用 M 的；HP 照原本的比例，
// 能力變化、異常狀態、場上狀態、用過的 PP 都沿用；超級進化帶的是超級石（item 空白），變回原型的道具是 item
function simReform(M, key, item) {
  const N = simMon(key, { ...(defaultSet(key, 's') || emptySet()), moves: [...M.moves, '', '', '', ''].slice(0, 4) }, MON[key].base ? '' : item, 1, 's');
  return Object.assign(N, { hp: M.hp <= 0 ? 0 : Math.max(1, Math.round(N.max * M.hp / M.max)), status: M.status, tox: M.tox, slp: M.slp, st: { ...M.st }, v: { ...M.v },
    chg: M.chg, hide: M.hide, rech: M.rech, in: M.in, kos: M.kos, out: M.out, last: M.last, ft: M.ft, slot: M.slot, gs: M.gs,
    pp: Object.fromEntries(N.moves.map(k => [k, M.pp[k] ?? N.pp[k]])) });
}
// 對手還沒上場（猜的）的幾隻跟著上過場的修正：一場只能超級進化一隻（有上過場的超級進化了，猜的超級進化改原型、沒道具）；
// 同一隊不帶重複的道具（撞到上過場的道具，改拿牠下一個常帶的，同 simItems）
function simFixGuessed(st) {
  const mons = st.sd[1].mons, up = mons.find(m => m.out && MON[simBaseKey(m)].base), taken = new Set(mons.filter(m => m.out && m.item).map(m => m.item));
  mons.forEach((m, q) => {
    if (m.out) return;
    if (up && MON[m.key].base) m = mons[q] = simReform(m, MON[m.key].base, '');
    if (!m.item || !taken.has(m.item)) { if (m.item) taken.add(m.item); return; }
    m.item = byUse(useOf(m.key, 's')?.items || []).map(([k]) => k).find(k => !isStone(k) && !taken.has(k)) || '';
    if (m.item) taken.add(m.item);
  });
}
// 改成實戰的結果：照輸入框改最後一步的 HP（填的 % 和原本顯示的一樣就不動）與異常狀態（新睡著的照期望值睡 3 次），
// 上過場的對手的型態、道具、招式（招式不填的那格就是少一招；一場只能超級進化一隻、道具不重複見 simFixGuessed），再重算
function simApplyEdit(t) {
  const cur = t.path[t.path.length - 1], st = simClone(cur.st);
  document.querySelectorAll('#sTree [data-ehp]').forEach(inp => {
    const [s, q] = inp.dataset.ehp.split('.').map(Number), M = st.sd[s].mons[q], v = Math.min(100, Math.max(0, Math.round(+inp.value)));
    if (inp.value === '' || Number.isNaN(v) || v === simPct(M.hp, M.max)) return;
    M.hp = v ? Math.max(1, Math.round(M.max * v / 100)) : 0;
    if (M.hp > 0) M.ft = 0; else simFaint(st, M);
  });
  document.querySelectorAll('#sTree [data-est]').forEach(sel => {
    const [s, q] = sel.dataset.est.split('.').map(Number), M = st.sd[s].mons[q];
    if (sel.value !== M.status) Object.assign(M, { status: sel.value, tox: 0, slp: sel.value === 'slp' ? 3 : 0 });
  });
  // 對手：型態（換了就照新型態重建）→ 道具（'-'＝沒有道具；超級進化固定超級石）→ 招式（講究圍巾鎖的那招沒了就解鎖）
  const opp = st.sd[1].mons, el = (a, v) => document.querySelector(`#sTree [${a}="${v}"]`);
  opp.forEach((M, q) => {
    if (!M.out) return;
    const f = el('data-eform', q)?.value, it = el('data-eitem', q);
    if (f && f !== M.key && MON[f]) M = opp[q] = simReform(M, f, '');
    if (it && !MON[M.key].base) M.item = it.value === '-' ? '' : it.value;
    const ms = [0, 1, 2, 3].map(n => el('data-emv', `${q}.${n}`)).filter(Boolean).map(s => s.value).filter((k, n, a) => k && MOVES[k] && a.indexOf(k) === n);
    if (ms.length && ms.join() !== M.moves.join()) {
      M.pp = Object.fromEntries(ms.map(k => [k, M.pp[k] ?? MOVES[k][5] ?? Infinity]));
      M.moves = ms;
    }
    if (M.lock && (!M.moves.includes(M.lock) || M.item !== 'choice-scarf')) M.lock = '';
  });
  simFixGuessed(st);
  Object.assign(cur, { st, view: null });
  t.edit = false;
  simCalcTree();
}
// 算目前這一步每一格的勝率（先畫「計算中」，讓畫面更新後再算）
function simCalcTree() {
  const t = sim.tree;
  renderSimTree();
  setTimeout(() => {
    const cur = t.path[t.path.length - 1];
    if (sim.tree !== t || cur.view) return;
    cur.view = simView(t.ctx, cur.st, SIM_TREE_ITERS);
    renderSimTree();
  });
}
// 一個選擇的中文：招式名、換上誰、休息、什麼都不做
function simOptZh(o, side) {
  if (o.t === 'mv') return simMoveZh(o.k);
  if (o.t === 'sw') return '換' + MON[side.mons[o.i].key].zh;
  return { rech: '休息', none: '什麼都不做', pass: '—' }[o.t] || o.t;
}
// 一方的場面：場上那隻（HP、異常、能力變化）、後排（HP；guess＝對手還沒上場的是猜的）、撒菱類與牆
function simSideHTML(side, s, guess) {
  const pctOf = m => m.hp <= 0 ? '倒下' : `${Math.round(m.hp / m.max * 100)}%`;
  const M = side.mons[side.act], st = Object.entries(M.st).filter(([, v]) => v).map(([k, v]) => `${SIM_STAT_ZH[k]}${v > 0 ? '+' : ''}${v}`);
  const name = M.tf ? `${MON[M.tf.key].zh}（變身成${MON[M.key].zh}）` : MON[M.key].zh;
  const bench = side.mons.filter((m, i) => i !== side.act).map(m => `${MON[m.key].zh}${guess && !m.out ? '（猜的）' : ''} ${pctOf(m)}${m.status && m.hp > 0 ? ' ' + SIM_STATUS_ZH[m.status] : ''}`);
  const haz = Object.entries(side.haz).filter(([, v]) => v).map(([h, v]) => SIM_HAZ_ZH[h] + (h === 'spikes' || h === 'tspikes' ? ` ${v} 層` : ''));
  const scr = Object.entries(side.scr).map(([w, n]) => `${MOVES[w][0]} ${n} 回合`);
  return `<div class="x-line"><b>${s ? '對手' : '我方'}</b><span><b>${name}</b> ${pctOf(M)}${M.status && M.hp > 0 ? ' ' + SIM_STATUS_ZH[M.status] : ''}`
    + `${st.length ? '（' + st.join('、') + '）' : ''}</span>${bench.length ? `<span class="meta">後排 ${bench.join('、')}</span>` : ''}`
    + `${haz.length || scr.length ? `<span class="meta">${[...haz.map(x => '場上' + x), ...scr].join('、')}</span>` : ''}</div>`;
}
// 對手後排（推演時）：對手 6 格，帶出場的按下去；還沒上場的是猜的，點別隻換掉較早猜的那隻
function simGuessHTML(t) {
  const mons = t.path[t.path.length - 1].st.sd[1].mons, nm = m => MON[simBaseKey(m)].zh, seen = mons.filter(m => m.out), guess = mons.filter(m => !m.out);
  return `<div class="b-label">對手帶出場<span class="muted small">上過場的：${seen.map(nm).join('、')}`
    + (guess.length ? `；猜的：${guess.map(nm).join('、')}（不對就點實際的，會換掉較早猜的那隻）` : '') + '</span></div>'
    + `<div class="t-row">${t.oppKeys.map((k, i) => MON[k] && t.roster.mems[i] ? `<button class="mini" data-guess="${i}" aria-pressed="${mons.some(m => m.slot === i)}"${guess.length ? '' : ' disabled'}>`
      + `${MON[k].zh}</button>` : '').join('')}</div>`;
}
// 被迫換人（打完換人、拋下狠話、被吹走）時換上誰：電腦照簡單規則挑的，可以點實際換上的
function simForcedHTML(cur) {
  const st = cur.st, rows = [0, 1].map(s => {
    const c = cur.forced?.[s];
    return c && c.length > 1 ? `<div class="t-row"><span class="c-l">${s ? '對手' : '我方'}換上</span><div class="seg">`
      + c.map(i => `<button data-force="${s}.${i}" aria-pressed="${st.sd[s].act === i}">${MON[st.sd[s].mons[i].key].zh}</button>`).join('') + '</div></div>' : '';
  }).join('');
  return rows && `<p class="muted small b-intro">這一步有人被迫換人，換上誰是電腦照簡單規則挑的；實戰換上的不一樣就點實際的（這一步會重算，改過的實戰結果要重填）。</p>${rows}`;
}
// 改成實戰的結果：雙方每隻（對手只列上過場的）剩下幾 % HP 與異常狀態；上過場的對手另外可以改型態、道具、招式（看到的跟猜的不一樣時）。
// 都用選單，按「用這個局面重算」才一起套用（選單改了不重畫，免得其他欄位填到一半被洗掉）
function simEditHTML(st) {
  const opts = m => [['', '沒有異常'], ...Object.entries(SIM_STATUS_ZH)].map(([k, zh]) => `<option value="${k}"${m.status === k ? ' selected' : ''}>${zh}</option>`).join('');
  const opt = (v, zh, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${zh}</option>`;
  const byZh = list => list.sort((x, y) => x[1].localeCompare(y[1], 'zh-Hant'));
  const opp = st.sd[1].mons, megaOut = opp.find(m => m.out && MON[simBaseKey(m)].base);
  // 對手 m（第 q 隻）的型態、道具、4 招：型態列原型和超級進化（別隻已經超級進化過就不列超級進化）；道具先列這隻常帶的，
  // 其他上過場的對手拿著的不列（同一隊不重複）、不列超級石；招式只列模擬算得了的（simCanUse），這隻常用的排前面
  const more = (m, q) => {
    const fam = MON[family(MON[m.key])], forms = [fam, ...megasOf(fam)].filter(f => !f.base || !megaOut || megaOut === m), use = useOf(m.key, 's');
    const form = forms.length > 1 ? `<span class="c-l">型態</span><select class="sel" data-eform="${q}" aria-label="${MON[m.key].zh}的型態">`
      + forms.map(f => opt(f.key, f.base ? f.zh : '沒進化', m.key)).join('') + '</select>' : '';
    const taken = new Set(opp.filter(o => o !== m && o.out && o.item).map(o => o.item)), common = (useOf(fam.key, 's')?.items || []).map(([k]) => k);
    const ok = k => ITEMS[k] && !isStone(k) && (!taken.has(k) || k === m.item);
    // 超級進化型態的道具固定是超級石（選單第一項）；同時把型態改回原型時，照這裡選的道具
    const item = `<span class="c-l">道具</span><select class="sel" data-eitem="${q}" aria-label="${MON[m.key].zh}的道具">`
        + (MON[m.key].base ? opt('', '超級石（超級進化固定；改回原型時照下面選的）', '') : '') + opt('-', '沒有道具', MON[m.key].base ? '' : m.item || '-')
        + `<optgroup label="這隻常帶">${common.filter(ok).map(k => opt(k, ITEMS[k][0], m.item)).join('')}</optgroup>`
        + `<optgroup label="其他">${byZh(Object.keys(ITEMS).filter(k => ok(k) && !common.includes(k)).map(k => [k, ITEMS[k][0]])).map(([k, zh]) => opt(k, zh, m.item)).join('')}</optgroup></select>`;
    const top = byUse(use?.moves || []).map(([k]) => k).filter(k => MOVES[k] && simCanUse(k));
    const rest = byZh(Object.keys(MOVES).filter(k => simCanUse(k) && !top.includes(k)).map(k => [k, MOVES[k][0]]));
    const mvSel = n => `<select class="sel" data-emv="${q}.${n}" aria-label="${MON[m.key].zh}的招式 ${n + 1}">${opt('', '（不填）', m.moves[n] || '')}`
      + `<optgroup label="這隻常用">${top.map(k => opt(k, MOVES[k][0], m.moves[n])).join('')}</optgroup>`
      + `<optgroup label="其他">${rest.map(([k, zh]) => opt(k, zh, m.moves[n])).join('')}</optgroup></select>`;
    return `<div class="c-f">${form}${item}</div><div class="c-f"><span class="c-l">招式</span>${[0, 1, 2, 3].map(mvSel).join('')}</div>`;
  };
  // 變身中的只改 HP 與異常狀態（型態、道具、招式是變身來的）
  const zh = m => MON[simBaseKey(m)].zh;
  const rows = [0, 1].map(s => st.sd[s].mons.map((m, q) => s && !m.out ? '' : `<div class="c-f"><span class="c-l">${s ? '對手' : '我方'}${zh(m)}</span>`
    + `HP<input type="number" class="sel c-num" inputmode="numeric" min="0" max="100" value="${simPct(m.hp, m.max)}" data-ehp="${s}.${q}" aria-label="${zh(m)}剩下的 HP %">%`
    + `<select class="sel" data-est="${s}.${q}" aria-label="${zh(m)}的異常狀態">${opts(m)}</select></div>` + (s && !m.tf ? more(m, q) : '')).join('')).join('');
  return `<div class="b-label">改成實戰的結果<span class="muted small">HP 填剩下幾 %（0＝倒下）；上過場的對手看到的型態（超級進化了沒）、道具、招式和猜的不一樣就改，`
    + `招式只列模擬算得了的；改好按「用這個局面重算」，從這一步往後照新的算</span></div>${rows}`
    + '<div class="c-f"><button class="btn primary" data-eapply>用這個局面重算</button><button class="btn" data-ecancel>取消</button></div>';
}
function renderSimTree() {
  const box = $('#sTree'), t = sim.tree;
  box.hidden = !t;
  if (!t) return;
  const cur = t.path[t.path.length - 1], st = cur.st, v = cur.view, pct = x => `${Math.round(x * 100)}%`;
  const steps = t.path.map((p, n) => !n ? '開局' : `第 ${n} 步：我方${simOptZh(p.acts[0], t.path[n - 1].st.sd[0])}／對手${simOptZh(p.acts[1], t.path[n - 1].st.sd[1])}`);
  let body;
  if (!v) body = '<p class="muted small">計算中…（每一格往下打到分出勝負，約幾秒）</p>';
  else if (v.phase === 'over') { const w = simWinner(st); body = `<div class="c-sum ${w === 0 ? 'good' : 'bad'}"><b>${w === 0 ? '我方贏' : w === 1 ? '我方輸' : '打滿 100 回合，平手'}</b></div>`; }
  else {
    const cls = x => x == null ? '' : x >= 0.6 ? 'm2' : x <= 0.4 ? 'mh' : 'm1';
    body = `<p class="muted small b-intro">${v.phase === 'replace' ? '有人倒下，選換上誰。' : '這一回合雙方各自出什麼。'}格子是「我方出左邊、對手出上面」之後雙方都照樹搜尋打下去的我方勝率，`
      + '名字後面的 % 是雙方建議的出法比例（同時出招，混著出才不會被猜中）。點雙方實際出的那一格往下一步（傷害照平均算，實戰不一樣就按「改成實戰的結果」）。</p>'
      + `<div class="mwrap cover"><table class="matrix vs"><thead><tr><th class="corner">我方 ↓<br>對手 →</th>`
      + v.opts[1].map((o, j) => `<th>${simOptZh(o, st.sd[1])}<br><span class="meta">${pct(v.p[1][j])}</span></th>`).join('') + '</tr></thead><tbody>'
      + v.opts[0].map((o, i) => `<tr><th>${simOptZh(o, st.sd[0])} <span class="meta">${pct(v.p[0][i])}</span></th>`
        + v.opts[1].map((_, j) => { const x = v.win[i][j]; return `<td class="${cls(x)}"><button class="vs-go" data-cell="${i}.${j}" title="試了 ${v.n[i][j]} 次">${x == null ? '—' : pct(x)}</button></td>`; }).join('')
        + '</tr>').join('') + '</tbody></table></div>';
  }
  const head = t.live ? `一步一步推演<span class="muted small">（我方帶 ${simTeamText(t.path[0].st.sd[0].mons)}；對手先發 ${MON[t.oppKeys[t.lead]].zh}）</span>`
    : `看怎麼打<span class="muted small">（對手帶 ${t.title}）</span>`;
  box.innerHTML = `<div class="res-head">${head}<button class="mini" data-tclose>關閉</button></div>`
    + (t.live ? simGuessHTML(t) : '')
    + `<div class="t-row">${steps.map((s, n) => n < steps.length - 1 ? `<button class="mini" data-back="${n}" title="回到這一步">${s}</button>` : `<b class="small">${s}</b>`).join('<span class="muted">→</span>')}</div>`
    + (cur.log.length ? `<div class="small">${cur.log.map(l => `<div>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('')}</div>` : '')
    + simForcedHTML(cur)
    + simSideHTML(st.sd[0], 0) + simSideHTML(st.sd[1], 1, t.live)
    + (t.edit ? simEditHTML(st) : v ? '<div class="c-f"><button class="mini" data-edit>改成實戰的結果</button><span class="muted small">傷害、急所、異常狀態有沒有中跟上面不一樣，或看到對手的型態、道具、招式和猜的不一樣時</span></div>' : '')
    + body
    + '<p class="note">※ 每一層總共往下打約 3000 次、平均分給每一格（格子上停著看次數），樹搜尋與規則見最下面的「規則細節」。'
    + '往下一步是照期望值打（傷害取平均、不會急所、麻痺不會不能動、同速我方先、打完換人照簡單規則挑），實戰會有運氣差，可以改成實戰的結果再往下算。'
    + (t.live ? '對手還沒上場的後排是猜的（「出戰選角」的「對手可能帶的」帶法裡會派這隻先發、排名最高的那種；沒有一種會派牠先發就取有帶牠的），對手每一隻的配招、道具照 OP.GG 常見（上過場的看到不一樣，在「改成實戰的結果」改型態、道具、招式）。' : '') + '</p>'
    + `<details class="b-more note"><summary>規則細節</summary>${simRulesText()}</details>`;
}
$('#sMine').addEventListener('click', e => {
  const b = e.target.closest('[data-slot]');
  if (!b || sim.run) return;
  simEditPick();
  const i = +b.dataset.slot;
  // 點滿了再點：換掉最早點的（先發不換，免得先發默默跳到別隻）
  if (sim.sel.includes(i)) sim.sel = sim.sel.filter(x => x !== i);
  else { sim.sel.push(i); if (sim.sel.length > simNeedN()) sim.sel.splice(Math.max(0, sim.sel.findIndex(x => x !== sim.lead)), 1); }
  simDropLive();
  renderSim();
});
$('#sLead').addEventListener('click', e => { const b = e.target.closest('[data-lead]'); if (b && !sim.run) { simEditPick(); sim.lead = +b.dataset.lead; simDropLive(); renderSim(); } });
$('#sEvo').addEventListener('click', e => { const b = e.target.closest('[data-evo]'); if (b && !sim.run) { simEditPick(); sim.evo = +b.dataset.evo; simDropLive(); renderSim(); } });
$('#sReset').addEventListener('click', () => { if (!sim.run) { Object.assign(sim, { sel: null, lead: -1, evo: -1 }); simDropLive(); renderSim(); } });
$('#sOpp').addEventListener('click', e => {
  const b = e.target.closest('[data-opp]');
  if (!b) return;
  simStartLive(+b.dataset.opp);
  $('#sTree').scrollIntoView({ block: 'start' });
});
$('#sK').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !sim.run) { sim.k = SIM_KS[[...b.parentNode.children].indexOf(b)]; renderSim(); } });
$('#sAlgo').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !sim.run) { sim.algo = SIM_ALGOS[[...b.parentNode.children].indexOf(b)].id; renderSim(); } });
$('#sRun').addEventListener('click', runSim);
$('#sStop').addEventListener('click', () => { if (sim.run) sim.run.stop = true; });
$('#sResult').addEventListener('click', e => {
  const b = e.target.closest('[data-tree]');
  if (!b || sim.run) return;
  simOpenTree(+b.dataset.tree);
  $('#sTree').scrollIntoView({ block: 'start' });
});
$('#sTree').addEventListener('click', e => {
  const t = sim.tree;
  if (!t) return;
  const at = q => e.target.closest(q), n = t.path.length - 1, cur = t.path[n];
  if (at('[data-tclose]')) { sim.tree = null; renderSim(); return; }
  if (at('[data-edit]') || at('[data-ecancel]')) { t.edit = !!at('[data-edit]'); renderSimTree(); return; }
  if (at('[data-eapply]')) { simApplyEdit(t); return; }
  const g = at('[data-guess]');
  if (g) { simSetGuess(t, +g.dataset.guess); return; }
  // 被迫換人換上的改成實際的：從上一步照同樣的選擇重打這一步
  const f = at('[data-force]');
  if (f && n) {
    const [s, i] = f.dataset.force.split('.').map(Number), pin = (cur.pin || [-1, -1]).slice();
    pin[s] = i;
    const next = simStep(t.ctx, t.path[n - 1].st, cur.acts, pin);
    t.path[n] = { st: next.st, view: null, log: next.log, acts: cur.acts, forced: next.forced, pin };
    t.edit = false;
    simCalcTree();
    return;
  }
  const back = at('[data-back]');
  if (back) { t.path.length = +back.dataset.back + 1; t.edit = false; simCalcTree(); return; }
  const c = at('[data-cell]');
  if (!c || !cur.view?.opts) return;
  const [i, j] = c.dataset.cell.split('.').map(Number), acts = [cur.view.opts[0][i], cur.view.opts[1][j]], next = simStep(t.ctx, cur.st, acts);
  t.path.push({ st: next.st, view: null, log: next.log, acts, forced: next.forced, pin: null });
  t.edit = false;
  simCalcTree();
});

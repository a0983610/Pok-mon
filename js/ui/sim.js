// ---------- 對戰模擬 ----------
// 我方帶出場：sel 點選的隊伍格子（點的順序）、lead 先發的格子、evo 超級進化的格子；沒點過（sel 是 null）用出戰選角的建議（simMyPlan）。
// k 對手每種帶法打幾場、algo 決策方式；run 模擬中（{ stop }）、res 上一次的結果、tree 樹狀圖（這三個不存網址）
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
// 我方：隊伍分析挑了寶可夢的隊員（只選屬性的沒有能力值，不算）；這場要帶幾隻（單打 3 隻，不到 3 隻就全帶）
const simMine = () => team.mons.map((k, i) => k ? { key: k, set: team.sets[i], slot: i } : null).filter(Boolean);
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
function renderSim() {
  const mine = simMine(), pk = simMyPick(), need = simNeedN(), nOpp = bring.opp.filter(Boolean).length;
  const seg = (id, list, cur) => document.querySelectorAll(`#${id} button`).forEach((b, i) => b.setAttribute('aria-pressed', list[i] === cur));
  $('#sMine').innerHTML = mine.length ? mine.map(x => `<button class="mini" data-slot="${x.slot}" aria-pressed="${pk.slots.includes(x.slot)}">`
    + `${x.slot + 1} ${MON[x.key].zh}${chips(MON[x.key].types)}</button>`).join('') : '<span class="muted small">先到「隊伍分析」挑好我方寶可夢（只選屬性的不算）。</span>';
  $('#sLeadRow').hidden = !pk.slots.length;
  $('#sLead').innerHTML = pk.slots.map(i => `<button data-lead="${i}" aria-pressed="${i === pk.slots[0]}">${MON[team.mons[i]].zh}</button>`).join('');
  const megas = pk.slots.filter(i => MON[team.mons[i]].base), up = megas.includes(pk.evo) ? pk.evo : megas[0];
  $('#sEvoRow').hidden = megas.length < 2;
  $('#sEvo').innerHTML = megas.map(i => `<button data-evo="${i}" aria-pressed="${i === up}">${MON[team.mons[i]].zh}</button>`).join('');
  $('#sReset').hidden = !pk.custom;
  seg('sK', SIM_KS, sim.k);
  seg('sAlgo', SIM_ALGOS.map(a => a.id), sim.algo);
  const al = simAlgo(sim.algo), combos = nOpp ? simChoose(nOpp, Math.min(BRING_N.s, nOpp)) : 0, total = combos * sim.k;
  $('#sAlgoHint').textContent = al.hint + (combos ? `；對手 ${combos} 種帶法各 ${sim.k} 場共 ${total} 場，約 ${simEta(al.ms * total)}` : '');
  const ready = mine.length && pk.slots.length === need && nOpp;
  $('#sRun').disabled = !!sim.run || !ready;
  $('#sStop').hidden = !sim.run;
  const r = sim.res;
  if (!sim.run) $('#sMsg').textContent = !mine.length ? '先到「隊伍分析」挑好我方寶可夢（只選屬性的不算）。'
    : !nOpp ? '先到「出戰選角」選好對手的寶可夢。' : pk.slots.length !== need ? `我方要點滿 ${need} 隻。`
    : !r ? '' : r.n < r.total ? `已停止，只跑了 ${r.n} 場。` : `完成 ${r.n} 場。`;
  $('#sResult').innerHTML = r ? simResultHTML(r)
    : '<p class="empty">按「開始模擬」後，這裡會列出對手每一種帶法下我方的勝率（最難應付的在前），點「看怎麼打」看開局雙方各種出招的勝率。</p>';
  renderSimTree();
  saveState();
}
// 跑模擬：對手每種帶法輪流打（中途停止時各帶法的場數也平均），每跑超過 50 毫秒就讓畫面喘口氣、更新進度；按「停止」就以已跑完的場數出結果
async function runSim() {
  const mine = simMine(), fmt = 's', pk = simMyPick();
  if (sim.run || pk.slots.length !== simNeedN() || !bring.opp.some(Boolean)) return;
  const scs = simOppScenarios(bring.opp, mine.map(x => x.key), fmt), my = { mons: simMySide(mine, pk.slots, pk.evo, fmt) };
  const al = simAlgo(sim.algo), k = sim.k, ctx = simCtx(fmt), run = sim.run = { stop: false };
  const res = { algo: al.id, k, total: k * scs.length, n: 0, my, sc: scs.map(sc => ({ ...sc, n: 0, win: 0, lose: 0, draw: 0, turns: 0 })), mine: {}, opp: {}, logs: {} };
  sim.tree = null;
  renderSim();
  const start = performance.now();
  let t0 = start;
  for (let g = 0; g < k && !run.stop; g++) {
    for (let i = 0; i < res.sc.length && !run.stop; i++) {
      const out = simPlay(ctx, [my, res.sc[i]], Math.random, !res.logs.win || !res.logs.lose, al.opt);
      simTally(res, i, out);
      if (performance.now() - t0 > 50) {
        // 剩下的時間照目前每場平均估
        $('#sMsg').textContent = `模擬中… ${res.n}／${res.total} 場，預估還要 ${simEta((performance.now() - start) / res.n * (res.total - res.n))}`;
        await new Promise(r => setTimeout(r));
        t0 = performance.now();
      }
    }
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
    + '先發照對手用「出戰選角」的方法對這種帶法的挑法（對手看不到我方的配招；選一般型態、但某顆超級石使用率過半的當成超級進化）。每回合雙方同時決定出哪一招或換誰，'
    + '先估「我方出 X、對手出 Y」各組合的分數：快速＝每種組合都試算這一回合（傷害取平均）；標準、精細＝樹搜尋，每步從目前局面往下打 400／800 次，'
    + '每次雙方挑「目前看起來好、或還沒試夠」的選擇，照亂數打（傷害、急所、麻痺每次重抽），一路往下展開到沒走過的局面，'
    + '累積每個組合最後的勝負（比快速多看了之後幾回合怎麼打、以及運氣好壞）。展開不到的部分都用簡單規則（出最痛的一招；不怕被打時強化、撒菱，'
    + '打不太動時上異常狀態，HP 一半以下回復；倒下時換上一對一打得贏的）打到分出勝負。'
    + '雙方再各自找「對手不管怎麼應對都最不吃虧」的出法（同時出招的賽局解：可能是幾種選擇按比例混著出，像 70% 換人、30% 留場打，'
    + '只固定出一種會被對手抓到），照比例抽一種；倒下後換上誰也用同樣方法決定。'
    + '實測讓雙方用不同方式對打，標準、精細對快速的勝率約 60%、69%。實際出招時傷害抽 16 段亂數、'
    + '急所機率 1/24（容易擊中要害的招式、超幸運、焦點鏡各提高一級：1/8、1/2、必定），同速各 50%。'
    + '我方照「隊伍分析」登錄的配招（沒登錄的照 OP.GG 常見），對手照 OP.GG 使用率前 4 招、最常見的特性、能力點數與性格，道具同一隊不重複（使用率高的先拿）。'
    + '攻擊招式算傷害，加上招式本身的效果：擊掌奇襲、迎頭一擊只有上場後第一回合能用；大爆炸、自爆、薄霧炸裂用了自己倒下；'
    + '破壞光線等下一回合不能動；日光束、日光刃、電光束、挖洞、潛靈奇襲要先蓄力一回合（沒有天氣；挖洞、潛靈奇襲蓄力時打不到）；預知未來兩回合後打中；'
    + '突襲在對手沒出攻擊招式時失敗、快手還擊只在對手出先制招式時有效；流星群、近身戰等自己的能力變化（換下場歸零）；'
    + '勇鳥猛攻等反作用力、吸取拳等吸血、生命寶珠扣 1/10、鐵蹄光線扣一半；急速折返等打完換人、龍尾吼叫等讓對手換人；講究圍巾鎖招；氣勢披帶、抗性樹果用掉、拍落打掉道具。'
    + '輔助招：強化（劍舞、詭計、龍之舞、破殼、腹鼓…）、守住類（守住、看穿、王者盾牌、尖刺防守、碉堡、挺住；連續用成功率 1/3、1/9…）、'
    + '回復（自我再生、羽棲、祈願、分擔痛楚、睡覺、吸取力量、寄生種子、治癒之願）、異常狀態（鬼火、劇毒、電磁波、哈欠、催眠粉…）、'
    + '撒菱類（隱形岩、撒菱、毒菱、黏黏網；清除濃霧、高速旋轉清掉）、擾亂（再來一次、挑釁、替身、反射壁、光牆、極光幕、吼叫、吹飛、黑霧、撒嬌等降對手能力、拋下狠話、臨別禮物）。'
    + '異常狀態照冠軍版：燒傷每回合扣 1/16 且物攻減半、中毒 1/8、劇毒 1/16 起逐回合加重、麻痺速度減半且 1/8 不能動、睡眠 2～3 回合。'
    + '道具與特性：吃剩的東西、文柚果、木子果、零餘果、凸凸頭盔、光之黏土、大根莖、貝殼之鈴、白色香草、心靈香草、氣球；'
    + '再生力、自然回復、毒療、蛻皮、魔法防守、惡作劇之心、黃金之軀、魔法鏡、毅力、同步、唱反調、恆淨之軀、鏡甲、不服輸、好勝、粗糙皮膚、各種異常免疫特性。'
    + '不算：攻擊招式的機率性追加效果（畏縮、灼傷、降能力…）、天氣場地（極光幕只有特性降雪的能用）、出場特性（如威嚇）、命中率（當全中）、'
    + '戲法空間、順風、同命、接棒、戲法、滅亡之歌等其他輔助招，逆鱗的連續攻擊與混亂、羽棲當回合失去飛行屬性；'
    + '連續攻擊招式照「傷害計算」以 3 下計，雜技、掃墓等威力會變的招式照資料的威力（噴火、噴水會隨 HP 變小）。'
    + 'PP 照 OP.GG 冠軍版的數值（如羽棲、守住 8、地震 12），用一次扣 1、對手特性壓迫感時扣 2；能用的招式都沒 PP 時只能換人或掙扎（威力 50、沒有屬性，自己扣 1/4）。'
    + '連續兩回合雙方都沒扣血也沒換人時，打不到對方的攻擊招式就不能選（不然會原地空轉）；雙方同時全倒時最後倒下的一方贏（第五世代起的規則，同 Showdown：打倒對手最後一隻後被反作用力打倒算贏、大爆炸同歸於盡算輸）；打滿 100 回合算平手。'
    + '只是參考：雙方用同一套判斷，實戰對手不一定這樣選。</p>';
}
// ---------- 樹狀圖（看怎麼打） ----------
// tree：{ i 對手第幾種帶法, ctx, path [{ st 局面, view simView 的結果（算好前是 null）, log 走到這一步的紀錄, acts 這一步雙方的選擇 }] }
function simOpenTree(i) {
  const res = sim.res, sc = res.sc[i];
  sim.tree = { i, ctx: simCtx('s'), path: [{ st: simStart([res.my, sc]), view: null, log: [], acts: null }] };
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
// 一方的場面：場上那隻（HP、異常、能力變化）、後排（HP）、撒菱類與牆
function simSideHTML(side, s) {
  const pctOf = m => m.hp <= 0 ? '倒下' : `${Math.round(m.hp / m.max * 100)}%`;
  const M = side.mons[side.act], st = Object.entries(M.st).filter(([, v]) => v).map(([k, v]) => `${SIM_STAT_ZH[k]}${v > 0 ? '+' : ''}${v}`);
  const bench = side.mons.filter((m, i) => i !== side.act).map(m => `${MON[m.key].zh} ${pctOf(m)}${m.status && m.hp > 0 ? ' ' + SIM_STATUS_ZH[m.status] : ''}`);
  const haz = Object.entries(side.haz).filter(([, v]) => v).map(([h, v]) => SIM_HAZ_ZH[h] + (h === 'spikes' || h === 'tspikes' ? ` ${v} 層` : ''));
  const scr = Object.entries(side.scr).map(([w, n]) => `${MOVES[w][0]} ${n} 回合`);
  return `<div class="x-line"><b>${s ? '對手' : '我方'}</b><span><b>${MON[M.key].zh}</b> ${pctOf(M)}${M.status && M.hp > 0 ? ' ' + SIM_STATUS_ZH[M.status] : ''}`
    + `${st.length ? '（' + st.join('、') + '）' : ''}</span>${bench.length ? `<span class="meta">後排 ${bench.join('、')}</span>` : ''}`
    + `${haz.length || scr.length ? `<span class="meta">${[...haz.map(x => '場上' + x), ...scr].join('、')}</span>` : ''}</div>`;
}
function renderSimTree() {
  const box = $('#sTree'), t = sim.tree;
  box.hidden = !t || !sim.res;
  if (box.hidden) return;
  const sc = sim.res.sc[t.i], cur = t.path[t.path.length - 1], st = cur.st, v = cur.view, pct = x => `${Math.round(x * 100)}%`;
  const steps = t.path.map((p, n) => !n ? '開局' : `第 ${n} 步：我方${simOptZh(p.acts[0], t.path[n - 1].st.sd[0])}／對手${simOptZh(p.acts[1], t.path[n - 1].st.sd[1])}`);
  let body;
  if (!v) body = '<p class="muted small">計算中…（每一格往下打到分出勝負，約幾秒）</p>';
  else if (v.phase === 'over') { const w = simWinner(st); body = `<div class="c-sum ${w === 0 ? 'good' : 'bad'}"><b>${w === 0 ? '我方贏' : w === 1 ? '我方輸' : '打滿 100 回合，平手'}</b></div>`; }
  else {
    const cls = x => x == null ? '' : x >= 0.6 ? 'm2' : x <= 0.4 ? 'mh' : 'm1';
    body = `<p class="muted small b-intro">${v.phase === 'replace' ? '有人倒下，選換上誰。' : '這一回合雙方各自出什麼。'}格子是「我方出左邊、對手出上面」之後雙方都照樹搜尋打下去的我方勝率，`
      + '名字後面的 % 是雙方建議的出法比例（同時出招，混著出才不會被猜中）；點格子照期望值打這一回合，看下一步。</p>'
      + `<div class="mwrap cover"><table class="matrix vs"><thead><tr><th class="corner">我方 ↓<br>對手 →</th>`
      + v.opts[1].map((o, j) => `<th>${simOptZh(o, st.sd[1])}<br><span class="meta">${pct(v.p[1][j])}</span></th>`).join('') + '</tr></thead><tbody>'
      + v.opts[0].map((o, i) => `<tr><th>${simOptZh(o, st.sd[0])} <span class="meta">${pct(v.p[0][i])}</span></th>`
        + v.opts[1].map((_, j) => { const x = v.win[i][j]; return `<td class="${cls(x)}"><button class="vs-go" data-cell="${i}.${j}" title="試了 ${v.n[i][j]} 次">${x == null ? '—' : pct(x)}</button></td>`; }).join('')
        + '</tr>').join('') + '</tbody></table></div>';
  }
  box.innerHTML = `<div class="res-head">看怎麼打<span class="muted small">（對手帶 ${simTeamText(sc.mons)}）</span><button class="mini" data-tclose>關閉</button></div>`
    + `<div class="t-row">${steps.map((s, n) => n < steps.length - 1 ? `<button class="mini" data-back="${n}" title="回到這一步">${s}</button>` : `<b class="small">${s}</b>`).join('<span class="muted">→</span>')}</div>`
    + (cur.log.length ? `<div class="small">${cur.log.map(l => `<div>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('')}</div>` : '')
    + simSideHTML(st.sd[0], 0) + simSideHTML(st.sd[1], 1) + body
    + '<p class="note">※ 每一層總共往下打約 3000 次、平均分給每一格（格子上停著看次數）；樹搜尋與規則同上方的說明。'
    + '往下一步是照期望值打（傷害取平均、不會急所、麻痺不會不能動、同速我方先），實戰會有運氣差。</p>';
}
$('#sMine').addEventListener('click', e => {
  const b = e.target.closest('[data-slot]');
  if (!b || sim.run) return;
  simEditPick();
  const i = +b.dataset.slot;
  if (sim.sel.includes(i)) sim.sel = sim.sel.filter(x => x !== i);
  else { sim.sel.push(i); if (sim.sel.length > simNeedN()) sim.sel.shift(); }
  renderSim();
});
$('#sLead').addEventListener('click', e => { const b = e.target.closest('[data-lead]'); if (b && !sim.run) { simEditPick(); sim.lead = +b.dataset.lead; renderSim(); } });
$('#sEvo').addEventListener('click', e => { const b = e.target.closest('[data-evo]'); if (b && !sim.run) { simEditPick(); sim.evo = +b.dataset.evo; renderSim(); } });
$('#sReset').addEventListener('click', () => { if (!sim.run) { Object.assign(sim, { sel: null, lead: -1, evo: -1 }); renderSim(); } });
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
  if (e.target.closest('[data-tclose]')) { sim.tree = null; renderSimTree(); return; }
  const back = e.target.closest('[data-back]');
  if (back) { t.path.length = +back.dataset.back + 1; renderSimTree(); return; }
  const c = e.target.closest('[data-cell]'), cur = t.path[t.path.length - 1];
  if (!c || !cur.view?.opts) return;
  const [i, j] = c.dataset.cell.split('.').map(Number), acts = [cur.view.opts[0][i], cur.view.opts[1][j]], next = simStep(t.ctx, cur.st, acts);
  t.path.push({ st: next.st, view: null, log: next.log, acts });
  simCalcTree();
});

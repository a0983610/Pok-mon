// ---------- 對戰中 ----------
// 對戰時看場上雙方：我方每一招的傷害、能不能打倒、誰先動，對手先動又打得倒我方時警告（不預測對手出招、換人）。
// 我方沿用隊伍分析（含登錄的配招），對手沿用出戰選角的 6 隻。
// me／opp：場上位置放的隊伍格子／對手格子索引（-1＝空；單打只用第 1 個位置）；sel：點下方寶可夢時要放進哪個位置；
// st：場上位置的能力變化 [攻擊, 防禦, 特攻, 特防, 速度]（換下場就清掉，同遊戲）；hp：我方各格剩下的 HP（null＝全滿）；ohp：對手各格剩下的 HP %；
// item：對手各格標的道具（空＝用預設 btOppItems、'-'＝沒有道具）；ab：對手各格選的特性（空＝用 defAbOf 的預設）；
// form：各格選的型態（空＝隊伍分析／出戰選角裡的那個，用來切換超級進化前後）；weather、terrain、tr 戲法空間、tw 有順風的一方（'me'／'opp'）；
// keys：記錄時各格的寶可夢 key（隊伍或對手換了寶可夢，那格的紀錄就清掉）
const BT_SIDES = ['me', 'opp'];
const BT_STATS = [['atk', '攻擊'], ['def', '防禦'], ['spa', '特攻'], ['spd', '特防'], ['spe', '速度']];
const btSt0 = () => [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
const battle0 = () => ({ me: [-1, -1], opp: [-1, -1], sel: { me: 0, opp: 0 }, st: { me: btSt0(), opp: btSt0() },
  hp: Array(6).fill(null), ohp: Array(6).fill(100), item: Array(6).fill(''), ab: Array(6).fill(''), form: { me: Array(6).fill(''), opp: Array(6).fill('') },
  weather: '', terrain: '', tr: false, tw: [], keys: { me: team.mons.slice(), opp: bring.opp.slice() } });
const battle = battle0();
// 特性選單上算「影響這裡的計算」的（傷害、速度都看）
const BT_REL = new Set([...ATK_REL, ...DEF_REL]);
// 場上幾隻：單打 1、雙打 2（同先發的數量）
const btN = () => LEAD_N[team.fmt];
const btList = side => side === 'me' ? team.mons : bring.opp;
const btKey = (side, i) => battle.form[side][i] || btList(side)[i];
// 格子 i 可以切換的型態（原型＋超級進化）；我方只有隊伍裡選了超級進化型態的能切回原型（一般型態登錄不了超級石）；不能切換回傳 []
function btForms(side, i) {
  const m0 = MON[btList(side)[i]];
  if (!m0) return [];
  const fam = MON[family(m0)], forms = side === 'me' ? (m0.base ? [fam, m0] : []) : [fam, ...megasOf(fam)];
  return forms.length > 1 ? forms : [];
}
// 隊伍或對手換了寶可夢：那格的紀錄清掉，在場上就下場
function syncBattle() {
  BT_SIDES.forEach(side => btList(side).forEach((k, i) => {
    if (battle.keys[side][i] === k) return;
    battle.keys[side][i] = k;
    battle.form[side][i] = '';
    if (side === 'me') battle.hp[i] = null;
    else { battle.ohp[i] = 100; battle.item[i] = ''; battle.ab[i] = ''; }
    battle[side].forEach((j, p) => { if (j === i) { battle[side][p] = -1; battle.st[side][p] = [0, 0, 0, 0, 0]; } });
  }));
}
// 對手各格實際算的道具：標了的照標的（'-'＝沒有道具），沒標的預設牠 OP.GG 最常帶的。同一隊不能帶重複的道具：
// 標了的先佔，其餘依使用率由高到低分配（同一顆給使用率高的那隻，另一隻改拿牠下一個常帶的）；超級進化帶自己的超級石（回傳 ''，不影響計算）。
// unset＝把這一格當成沒標（選單上顯示「預設是什麼」用）
function btOppItems(unset = -1) {
  const out = Array(6).fill(''), taken = new Set(), done = new Set();
  const free = i => bring.opp[i] && !MON[btKey('opp', i)].base, mark = i => i === unset ? '' : battle.item[i];
  bring.opp.forEach((k, i) => { const it = mark(i); if (free(i) && it && it !== '-') { out[i] = it; taken.add(it); } });
  bring.opp.flatMap((k, i) => free(i) && !mark(i) ? (useOf(btKey('opp', i), team.fmt)?.items || []).filter(([it]) => !isStone(it)).map(([it, p]) => ({ i, it, p })) : [])
    .sort((x, y) => y.p - x.p || x.i - y.i)
    .forEach(({ i, it }) => { if (!done.has(i) && !taken.has(it)) { out[i] = it; taken.add(it); done.add(i); } });
  return out;
}
// 場上位置 p 的寶可夢：duel 用的 battler（我方照登錄的配招；對手套選的特性與 btOppItems 的道具），加上能力變化 st、目前 HP cur、順風 tw，
// 另外帶 i 格子索引、H 最大 HP、pct 剩下的 HP %；空的位置回傳 null
function btMon(side, p) {
  const i = battle[side][p];
  if (i < 0) return null;
  const key = btKey(side, i), fmt = team.fmt;
  // 我方登錄成超級進化、這場切回原型的，帶的是自己的超級石（不影響計算）
  const b = side === 'me' ? { ...battler(key, fmt, team.sets[i]), ...(key !== team.mons[i] && { item: '' }) }
    : { ...battler(key, fmt), ab: defAbOf(key, fmt, battle.ab[i]), item: btOppItems()[i] };
  const H = hpOf(b), cur = side === 'me' ? Math.min(H, battle.hp[i] ?? H) : Math.ceil(H * battle.ohp[i] / 100);
  return { ...b, st: Object.fromEntries(BT_STATS.map(([k], n) => [k, battle.st[side][p][n]])), cur, tw: battle.tw.includes(side),
    i, H, pct: side === 'me' ? hpPct(cur, H) : battle.ohp[i] };
}
// ----- 上方：場上位置、HP、能力變化、型態、對手的特性與道具 -----
const btHpText = (side, v, max) => !v ? '倒下' : side === 'me' ? `／${max}（${hpPct(v, max)}%）` : '%';
function btStHTML(side, p) {
  const s = battle.st[side][p];
  return '<div class="bt-sts">' + BT_STATS.map(([, zh], n) => `<span class="bt-st">${zh}`
    + `<button class="mini" data-bst="${side}.${p}.${n}" data-d="-1" aria-label="${zh} −1">−</button>`
    + `<b class="${s[n] > 0 ? 'up' : s[n] < 0 ? 'dn' : ''}">${s[n] ? stgText(s[n]) : '0'}</b>`
    + `<button class="mini" data-bst="${side}.${p}.${n}" data-d="1" aria-label="${zh} +1">＋</button></span>`).join('')
    + (s.some(Boolean) ? `<button class="mini" data-bst0="${side}.${p}">全部歸 0</button>` : '') + '</div>';
}
function btFormHTML(side, i) {
  const forms = btForms(side, i), cur = btKey(side, i);
  if (!forms.length) return '';
  return `<div class="c-f"><span class="c-l">型態</span><div class="seg">${forms.map(m => `<button data-bform="${side}.${i}" data-k="${m.key}" aria-pressed="${m.key === cur}">`
    + `${m.base ? (forms.length > 2 ? m.zh : '超級進化') : '沒進化'}</button>`).join('')}</div></div>`;
}
// 對手道具選單：第一項是預設（btOppItems 分配到的），再來是「沒有道具」；其他對手標了的道具不列（同一隊不能帶重複的道具），
// 超級石不列（超級進化在「型態」切換）；這隻 OP.GG 常帶的排前面，影響傷害或速度的附效果說明，其他的排後面
function btItemOptions(i, key) {
  if (MON[key].base) { const st = stoneOf(MON[key]); return `<option value="">${st ? ITEMS[st][0] : '專屬的超級石'}（超級進化固定）</option>`; }
  const taken = new Set(battle.item.filter((k, j) => k && k !== '-' && j !== i)), use = Object.fromEntries(useOf(key, team.fmt)?.items || []);
  const note = k => { const n = [DMG_ITEMS[k] && itemNote(DMG_ITEMS[k]), use[k] && `這隻 ${use[k]}% 帶`].filter(Boolean); return n.length ? `（${n.join('・')}）` : ''; };
  const opt = k => `<option value="${k}"${k === battle.item[i] ? ' selected' : ''}>${ITEMS[k][0]}${note(k)}</option>`;
  const list = Object.keys(ITEMS).filter(k => !isStone(k) && !taken.has(k));
  const top = list.filter(k => use[k]).sort((x, y) => use[y] - use[x]), rest = list.filter(k => !use[k]).sort((x, y) => !!DMG_ITEMS[y] - !!DMG_ITEMS[x]);
  const auto = btOppItems(i)[i];
  return `<option value="">預設：${auto ? ITEMS[auto][0] + note(auto) : '沒有可分配的常帶道具'}</option>`
    + `<option value="-"${battle.item[i] === '-' ? ' selected' : ''}>沒有道具（用掉了、被拍落）</option>`
    + (top.length ? `<optgroup label="這隻常帶">${top.map(opt).join('')}</optgroup>` : '') + `<optgroup label="${top.length ? '其他' : '道具'}">${rest.map(opt).join('')}</optgroup>`;
}
function btPosHTML(side, p) {
  const i = battle[side][p], two = btN() > 1, me = side === 'me';
  const attr = `class="bt-pos${i < 0 ? ' empty' : ''}" data-side="${side}" data-p="${p}"${two ? ` aria-current="${battle.sel[side] === p}"` : ''}`;
  const tag = two ? `<span class="slot-n">位置 ${p + 1}</span>` : '';
  if (i < 0) return `<div ${attr}>${tag}<span>空的；點下方的寶可夢放上場</span></div>`;
  const b = btMon(side, p), m = MON[b.key], max = me ? b.H : 100, v = me ? b.cur : battle.ohp[i];
  const hp = `aria-label="剩下的 HP${me ? '' : ' %'}" min="0" max="${max}" step="1" value="${v}" data-bhp="${side}" data-i="${i}"`;
  const info = me ? `<div class="meta bt-info">${team.sets[i] ? '照登錄的配招' : '沒登錄配招，照預設'}・${abilZh(b.ab) || '沒有特性統計'}${b.item ? `・${ITEMS[b.item][0]}` : ''}</div>`
    : `<div class="c-f"><span class="c-l">特性</span><select class="sel" data-bab="${i}" aria-label="特性">${abilOptions(BT_REL, b.key, b.ab)}</select></div>`
      + `<div class="c-f"><span class="c-l">道具</span><select class="sel" data-bitem="${i}" aria-label="道具"${m.base ? ' disabled' : ''}>${btItemOptions(i, b.key)}</select></div>`;
  // 收起時的摘要：不是 0 的能力變化、特性、道具
  const s = battle.st[side][p], fold = `${side}.${p}`;
  const sum = [BT_STATS.map(([, zh], n) => s[n] ? `${zh} ${stgText(s[n])}` : '').filter(Boolean).join('・') || '能力變化都是 0', abilZh(b.ab),
    me ? b.item && ITEMS[b.item][0] : m.base ? '超級石' : b.item ? `${ITEMS[b.item][0]}${battle.item[i] ? '' : '（預設）'}` : '沒有道具'].filter(Boolean).join('・');
  return `<div ${attr}><div class="bt-h">${tag}<b>${m.zh}</b>${chips(m.types)}<button class="mini bt-off" data-bout="${fold}">下場</button></div>`
    + btFormHTML(side, i)
    + `<div class="bt-hp"><span class="c-l">HP</span><input type="range" ${hp}><input type="number" class="sel c-num" inputmode="numeric" ${hp}>`
    + `<span class="meta bt-hpt">${btHpText(side, v, max)}</span></div>`
    + `<details class="bt-more" data-fold="${fold}"${btIsOpen(fold) ? ' open' : ''}><summary>${sum}</summary>${btStHTML(side, p)}${info}</details></div>`;
}
// 位置卡的能力變化、特性、道具可以收起：寬螢幕（並排顯示結果時）預設打開、窄螢幕預設收起，點過就照點的（不存網址）
const btFold = {};
const btIsOpen = k => k in btFold ? btFold[k] : matchMedia('(min-width: 901px)').matches;
$('#p-battle').addEventListener('toggle', e => { const k = e.target.dataset?.fold; if (k) btFold[k] = e.target.open; }, true);
// 下方的寶可夢按鈕：場上的標起來，HP 不滿的標剩下多少、對手標了的道具
function btBenchHTML(side) {
  const on = battle[side].slice(0, btN());
  return btList(side).map((k, i) => {
    if (!k) return '';
    const key = btKey(side, i), v = side === 'me' ? battle.hp[i] : battle.ohp[i];
    const H = side === 'me' && v != null ? hpOf(battler(key, team.fmt, team.sets[i])) : 0;
    const hp = v === 0 ? '倒下' : side === 'me' ? (v == null || v >= H ? '' : `${hpPct(v, H)}%`) : v < 100 ? `${v}%` : '';
    const it = side === 'opp' && battle.item[i], sub = [hp, it && (it === '-' ? '沒道具' : ITEMS[it][0])].filter(Boolean).join('・');
    return `<button class="mini" data-bput="${side}" data-i="${i}" aria-pressed="${on.includes(i)}">${MON[key].zh}${sub ? `<span class="meta">${sub}</span>` : ''}</button>`;
  }).join('');
}
function btSideHTML(side) {
  const me = side === 'me', label = me ? '我方' : '對手';
  if (!btList(side).some(Boolean)) return `<div class="b-label">${label}</div><p class="muted small b-intro">`
    + `${me ? '先到「隊伍分析」挑好寶可夢（只選屬性的隊員沒有能力值，不能算）。' : '先到「出戰選角」填對手的 6 隻。'}</p>`;
  return `<div class="b-label">${label}<span class="muted small">${btN() > 1 ? '先點位置，再點下方的寶可夢換上場' : '點下方的寶可夢換上場'}</span></div>`
    + Array.from({ length: btN() }, (_, p) => btPosHTML(side, p)).join('')
    + `<div class="bt-bench" id="btBench-${side}">${btBenchHTML(side)}</div>`;
}
// ----- 下方：每一組對位（我方 × 對手）的結果 -----
// 一招一列：佔對方最大 HP 的 %、幾擊打倒（看剩下的 HP）
function btMoveRow(x) {
  const r = x.r;
  if (!r.eff) return `<div class="bt-mv"><b>${MOVES[x.k][0]}</b>${chip(r.type)}<span class="ko">沒有效果${r.immuneBy ? `（${abilZh(r.immuneBy)}）` : r.blockedBy ? `（${r.blockedBy}）` : ''}</span></div>`;
  const kt = koText(r.ko), tags = [FLAG.priority.has(x.k) && '先制', r.spread && '範圍 ×0.75',
    r.endured && `${ITEMS[r.endured]?.[0] || abilZh(r.endured)}撐住第一下`, r.berry && '樹果減半第一下'].filter(Boolean);
  return `<div class="bt-mv"><b>${MOVES[x.k][0]}</b>${chip(r.type)}${mtag(r.eff)}<span class="bt-pct">${hpPct(r.min, r.hp)}～${hpPct(r.max, r.hp)}%</span>`
    + `${tags.length ? `<span class="meta">${tags.join('・')}</span>` : ''}<span class="ko k${kt.n}">${kt.text}</span></div>`;
}
const btHit = x => `${mvName(x.k)} ${hpPct(x.r.min, x.r.hp)}～${hpPct(x.r.max, x.r.hp)}% ${koText(x.r.ko).text}`;
const btHits = xs => xs.slice(0, 2).map(btHit).join('、');
const btPri = xs => xs.filter(x => FLAG.priority.has(x.k));
function btPairHTML(M, O, f) {
  const mm = MON[M.key], om = MON[O.key];
  const head = tail => `<div class="bt-ph"><b>${mm.zh}</b><span class="meta">剩 ${M.pct}%</span><span>⇄</span><b>${om.zh}</b><span class="meta">剩 ${O.pct}%</span>${tail}</div>`;
  if (!M.cur || !O.cur) return `<div class="bt-pair">${head(`<span class="bt-ord">${!M.cur ? mm.zh : om.zh}倒下了</span>`)}</div>`;
  const d = duel(M, O, f), kill = d.yx.kos, mine = d.xy.kos;
  const order = d.first < 0 ? '同速（各 50%）' : `${d.first ? om.zh : mm.zh}先動`;
  const spd = (i, b) => `${d.spd[i].v}${[b.st.spe && `速度 ${stgText(b.st.spe)}`, ...d.spd[i].notes].filter(Boolean).map(s => '・' + s).join('')}`;
  // 警告：對手先動（或同速）又一擊打得倒我方；先制招式不看速度。我方先動打得倒的另外標出來
  const lines = [], was = d.first !== 0 && kill.length > 0;
  const tie = d.first < 0 ? '同速（各 50%），' : '';
  if (was) lines.push(['bad', `⚠ ${tie}${om.zh}先動就打得倒${mm.zh}：${btHits(kill)}`]);
  else if (btPri(kill).length) lines.push(['bad', `⚠ ${om.zh}的先制招式打得倒${mm.zh}：${btHits(btPri(kill))}`]);
  if (d.first !== 1 && mine.length) lines.push(['good', `✔ ${tie}${mm.zh}先動就打得倒${om.zh}：${btHits(mine)}`]);
  else if (btPri(mine).length) lines.push(['good', `✔ 先制招式打得倒${om.zh}：${btHits(btPri(mine))}`]);
  const rows = (x, n) => x.ok.length ? x.ok.slice(0, n).map(btMoveRow).join('') : `<div class="meta">${x.use.length ? '沒有能算傷害的攻擊招式' : '沒有招式資料'}</div>`;
  return `<div class="bt-pair">${head(`<span class="bt-ord">${order}</span>`)}`
    + `<div class="meta">速度：${mm.zh} ${spd(0, M)}／${om.zh} ${spd(1, O)}${f.tr ? '（戲法空間：慢的先動）' : ''}</div>`
    + lines.map(([c, t]) => c ? `<div class="c-sum ${c}">${t}</div>` : `<div class="x-line"><span class="x-msg">${t}</span></div>`).join('')
    + `<div class="bt-sub">${mm.zh}打${om.zh}</div>${rows(d.xy)}`
    + Object.entries(d.xy.why).map(([w, ns]) => `<div class="x-line"><span class="x-msg">不算（${w}）：</span>${ns.join('、')}</div>`).join('')
    + `<div class="bt-sub">${om.zh}打${mm.zh}<span class="meta">（最痛的 3 招）</span></div>${rows(d.yx, 3)}</div>`;
}
function btResultHTML() {
  const f = { fmt: team.fmt, weather: battle.weather, terrain: battle.terrain, tr: battle.tr };
  const on = side => Array.from({ length: btN() }, (_, p) => btMon(side, p)).filter(Boolean), mine = on('me'), opps = on('opp');
  if (!mine.length || !opps.length) return '<p class="empty">雙方都有寶可夢上場後，這裡會列出我方每一招打過去的傷害、能不能打倒、誰先動，對手先動又打得倒我方時會警告。</p>';
  return `<div class="res-head">場上對位<span class="muted small">（${[FMT_ZH[team.fmt], FIELD_ZH[battle.weather], FIELD_ZH[battle.terrain], battle.tr && '戲法空間',
    ...battle.tw.map(s => s === 'me' ? '我方順風' : '對手順風')].filter(Boolean).join('・')}）</span></div>`
    + mine.map(M => opps.map(O => btPairHTML(M, O, f)).join('')).join('')
    + '<p class="note">※ 我方照「隊伍分析」登錄的招式、特性、道具、能力點數與性格算，沒登錄的欄位和對手都照「傷害計算」的預設：'
    + '攻擊／特攻 32＋性格、速度 32＋性格、HP／防禦／特防 0、特性用 OP.GG 最常見的（對手的特性可在上方改；超級進化用固定特性）。'
    + '對手的道具預設 OP.GG 最常帶的，看到實際道具就在選單改（用掉或被拍落選「沒有道具」）。同一隊不能帶重複的道具：'
    + '標了的先算，沒標的依使用率由高到低分配，同一顆給使用率高的那隻、另一隻改拿牠下一個常帶的；其他對手標了的道具選單也不列。'
    + '% 是佔對方最大 HP 的比例；「一擊」「二擊」是連用同一招打掉對方剩下的 HP（對手剩下的 % 換算成 HP 時無條件進位），'
    + '不是全滿時氣勢披帶、結實、多重鱗片沒有作用。招式看登錄的或 OP.GG 常用招式裡的攻擊招式，依傷害由高到低排。'
    + '先動看實際速度（能力變化、順風 ×2、戲法空間、講究圍巾、天氣／場地加速特性）；同速各 50%，先制招式不看速度。能力變化換下場就清掉。'
    + '雙打的範圍招式一律以打到兩隻（×0.75）計；噴火／噴水以 HP 全滿計。不含灼傷、麻痺、牆、幫助、隊友與出場特性（如威嚇，請自己調能力變化）。</p>';
}
function renderBattle() {
  syncBattle();
  BT_SIDES.forEach(side => { $('#bt-' + side).innerHTML = btSideHTML(side); });
  document.querySelectorAll('#p-battle [data-bab]').forEach(s => { s.disabled = s.options.length < 2; });
  $('#btW').innerHTML = [['', '無天氣'], ...WEATHERS.map(w => [w, FIELD_ZH[w]])].map(([w, zh]) => `<button data-bw="${w}" aria-pressed="${battle.weather === w}">${zh}</button>`).join('');
  $('#btT').innerHTML = [['', '無場地'], ...TERRAINS.map(t => [t, FIELD_ZH[t]])].map(([t, zh]) => `<button data-bf="${t}" aria-pressed="${battle.terrain === t}">${zh}</button>`).join('');
  $('#btTR').checked = battle.tr;
  document.querySelectorAll('[data-btw]').forEach(c => { c.checked = battle.tw.includes(c.dataset.btw); });
  document.querySelectorAll('#btFmt button').forEach(b => b.setAttribute('aria-pressed', b.dataset.fmt === team.fmt));
  $('#btResult').innerHTML = btResultHTML();
  saveState();
}
// 放上場：放進選中的位置（原本在別的位置就移過來），那個位置的能力變化清掉，再跳到下一個空位置；已在場上就只選中牠的位置
function btPut(side, i) {
  const n = btN(), at = battle[side].indexOf(i);
  if (at >= 0 && at < n) { battle.sel[side] = at; return; }
  const p = Math.min(battle.sel[side], n - 1);
  battle[side] = battle[side].map(j => j === i ? -1 : j);
  battle[side][p] = i;
  battle.st[side][p] = [0, 0, 0, 0, 0];
  const next = battle[side].findIndex((j, q) => q < n && j < 0);
  if (next >= 0) battle.sel[side] = next;
}
// 點位置（雙打）選中它；按鈕照各自的動作改完重畫。點到選單、輸入欄時只換選中的框，不重畫（免得選單被關掉、輸入被打斷）
$('#p-battle').addEventListener('click', e => {
  const b = e.target.closest('button'), pos = e.target.closest('.bt-pos'), d = b?.dataset || {};
  if (pos) {
    battle.sel[pos.dataset.side] = +pos.dataset.p;
    document.querySelectorAll(`.bt-pos[data-side="${pos.dataset.side}"][aria-current]`).forEach(el => el.setAttribute('aria-current', el === pos));
  }
  if (d.bput) btPut(d.bput, +d.i);
  else if (d.bst) { const [side, p, n] = d.bst.split('.'), s = battle.st[side][+p]; s[+n] = Math.max(-6, Math.min(6, s[+n] + +d.d)); }
  else if (d.bst0) { const [side, p] = d.bst0.split('.'); battle.st[side][+p] = [0, 0, 0, 0, 0]; }
  else if (d.bout) { const [side, p] = d.bout.split('.'); battle[side][+p] = -1; battle.st[side][+p] = [0, 0, 0, 0, 0]; }
  else if (d.bform) {
    // 對手超級進化後道具固定是超級石，看到的道具清掉
    const [side, i] = d.bform.split('.');
    battle.form[side][+i] = d.k === btList(side)[+i] ? '' : d.k;
    if (side === 'opp' && MON[d.k].base) battle.item[+i] = '';
  }
  else if (d.bw != null) battle.weather = d.bw;
  else if (d.bf != null) battle.terrain = d.bf;
  else return;
  renderBattle();
});
// HP 那一列（拉桿 t 所在）的拉桿、數字欄、說明改成 v；all＝連 t 自己也改（邊打字時不改正在打的那格）
function btHpRow(t, v, all) {
  const row = t.closest('.bt-hp');
  row.querySelectorAll('input').forEach(x => { if (all || x !== t) x.value = v; });
  row.querySelector('.bt-hpt').textContent = btHpText(t.dataset.bhp, v, +t.max);
}
// HP：拉桿和數字欄邊拉邊算，只更新同一列、下方按鈕與結果（不重畫上方，免得拉桿被打斷）
$('#p-battle').addEventListener('input', e => {
  const t = e.target, side = t.dataset.bhp;
  if (!side || t.value === '') return;
  const i = +t.dataset.i, max = +t.max, v = Math.max(0, Math.min(max, Math.round(+t.value) || 0));
  if (side === 'me') battle.hp[i] = v >= max ? null : v; else battle.ohp[i] = v;
  btHpRow(t, v, false);
  $('#btBench-' + side).innerHTML = btBenchHTML(side);
  $('#btResult').innerHTML = btResultHTML();
  saveState();
});
// 離開 HP 欄位時只把那一列改回實際存的值（清空或超出範圍時），不整個重畫：打完字直接點按鈕時，按鈕才不會被換掉而沒按到
$('#p-battle').addEventListener('change', e => {
  const t = e.target, d = t.dataset;
  if (d.bhp) { btHpRow(t, d.bhp === 'me' ? battle.hp[+d.i] ?? +t.max : battle.ohp[+d.i], true); return; }
  if (d.bab != null) battle.ab[+d.bab] = t.value;
  else if (d.bitem != null) battle.item[+d.bitem] = t.value;
  else if (t.id === 'btTR') battle.tr = t.checked;
  else if (d.btw) battle.tw = BT_SIDES.filter(s => s === d.btw ? t.checked : battle.tw.includes(s));
  else return;
  renderBattle();
});
$('#btFmt').addEventListener('click', setFmt);
$('#btClear').addEventListener('click', () => { Object.assign(battle, battle0()); renderBattle(); });

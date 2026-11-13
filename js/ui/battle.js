// ---------- 對戰中 ----------
// 對戰時看場上雙方：我方每一招的傷害、能不能打倒、誰先動，對手先動又打得倒我方時警告；後排換上來打不打得贏（不預測對手出招）。
// 我方沿用隊伍分析（含登錄的配招），對手沿用出戰選角的 6 隻。
// me／opp：場上位置放的隊伍格子／對手格子索引（-1＝空；單打只用第 1 個位置）；sel：點下方寶可夢時要放進哪個位置；
// st：場上位置的能力變化 [攻擊, 防禦, 特攻, 特防, 速度]（換下場就清掉，同遊戲）；hp：我方各格剩下的 HP（null＝全滿）；ohp：對手各格剩下的 HP %；
// item：對手各格標的道具（空＝用預設 btOppItems、'-'＝沒有道具）；ab：對手各格選的特性（空＝用 defAbOf 的預設）；
// form：各格選的型態（空＝隊伍分析／出戰選角裡的那個，用來切換超級進化前後）；weather、terrain、tr 戲法空間、tw 有順風的一方（'me'／'opp'）；
// bring：我方這場帶的隊伍格子（null＝照出戰選角第 1 名組合，見 btBrought）；seen：對手各格出場過沒（放上場就標）；
// used：對手各格用過的招式 key（見 btOppSet）；osp：對手各格改過的能力點數／性格 { sp?, nat? }（沒改的那項照 OP.GG 最常見，null＝都沒改）；
// keys：記錄時各格的寶可夢 key（隊伍或對手換了寶可夢，那格的紀錄就清掉）；
// status：雙方各格的異常狀態（'par' 麻痺／'brn' 灼傷，換下場不會好）；walls：雙方的牆（BT_WALLS）；noItem：我方各格的道具用掉了、被拍落（對手看 item 的 '-'）；
// bust：雙方各格謎擬Ｑ的畫皮被揭穿了（換下場不會恢復）
const BT_SIDES = ['me', 'opp'];
const BT_STATS = [['atk', '攻擊'], ['def', '防禦'], ['spa', '特攻'], ['spd', '特防'], ['spe', '速度']];
const BT_STATUS = [['', '沒有'], ['par', '麻痺'], ['brn', '灼傷']], BT_WALLS = ['reflect', 'light-screen', 'aurora-veil'];
const btSt0 = () => [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
const battle0 = () => ({ me: [-1, -1], opp: [-1, -1], sel: { me: 0, opp: 0 }, st: { me: btSt0(), opp: btSt0() },
  hp: Array(6).fill(null), ohp: Array(6).fill(100), item: Array(6).fill(''), ab: Array(6).fill(''), form: { me: Array(6).fill(''), opp: Array(6).fill('') },
  weather: '', terrain: '', tr: false, tw: [], bring: null, seen: Array(6).fill(false), used: Array.from({ length: 6 }, () => []), osp: Array(6).fill(null),
  status: { me: Array(6).fill(''), opp: Array(6).fill('') }, walls: { me: [], opp: [] }, noItem: Array(6).fill(false),
  bust: { me: Array(6).fill(false), opp: Array(6).fill(false) },
  keys: { me: team.mons.slice(), opp: bring.opp.slice() } });
const battle = battle0();
// 特性選單上算「影響這裡的計算」的（傷害、速度都看；猛火類、大將、畫皮這種看場上狀況的對戰中也算，見 LIVE_ABILS）
const BT_REL = new Set([...ATK_REL, ...DEF_REL, ...LIVE_ABILS]);
// 場上幾隻：單打 1、雙打 2（同先發的數量）
const btN = () => LEAD_N[team.fmt];
const btList = side => side === 'me' ? team.mons : bring.opp;
// 格子 i 沒切換型態時的預設型態：我方照隊伍；對手照猜帶法的當法（likelyForm：某顆超級石使用率過半的當成超級進化）
const btKey0 = (side, i) => side === 'opp' && MON[bring.opp[i]] ? likelyForm(MON[bring.opp[i]], team.fmt).key : btList(side)[i];
const btKey = (side, i) => battle.form[side][i] || btKey0(side, i);
// 格子 i 可以切換的型態（原型＋超級進化）；我方只有隊伍裡選了超級進化型態的能切回原型（一般型態登錄不了超級石）；不能切換回傳 []
function btForms(side, i) {
  const m0 = MON[btList(side)[i]];
  if (!m0) return [];
  const fam = MON[family(m0)], forms = side === 'me' ? (m0.base ? [fam, m0] : []) : [fam, ...megasOf(fam)];
  return forms.length > 1 ? forms : [];
}
// 隊伍或對手換了寶可夢：那格的紀錄清掉，在場上就下場；我方換了寶可夢時「這場帶的」改回照出戰選角
function syncBattle() {
  BT_SIDES.forEach(side => btList(side).forEach((k, i) => {
    if (battle.keys[side][i] === k) return;
    battle.keys[side][i] = k;
    battle.form[side][i] = '';
    battle.status[side][i] = '';
    battle.bust[side][i] = false;
    if (side === 'me') { battle.hp[i] = null; battle.bring = null; battle.noItem[i] = false; }
    else { battle.ohp[i] = 100; battle.item[i] = ''; battle.ab[i] = ''; battle.seen[i] = false; battle.used[i] = []; battle.osp[i] = null; }
    battle[side].forEach((j, p) => { if (j === i) { battle[side][p] = -1; battle.st[side][p] = [0, 0, 0, 0, 0]; } });
  }));
}
// 我方這場帶的隊伍格子（只算挑了寶可夢的）：自己改過就照改的，不然照出戰選角第 1 名組合（bringPlan；還沒填對手就是全部）。
// 隊伍、配招、對手、單打／雙打沒變就不重算
const btPlan = { k: null, v: [] };
function btBrought() {
  const named = team.mons.map((k, i) => k ? i : -1).filter(i => i >= 0);
  if (battle.bring) return battle.bring.filter(i => team.mons[i]);
  const members = team.slots.map((s, i) => [s, i]).filter(([s]) => s.length), opps = bring.opp.filter(k => MON[k]).map(k => MON[k]);
  if (!opps.length) return named;
  const k = JSON.stringify([team.slots, team.mons, team.sets, bring.opp, team.fmt]);
  if (btPlan.k !== k) {
    const plan = bringPlan(members.map(([s, i]) => ({ defs: s, key: team.mons[i], set: team.sets[i] })), opps, team.fmt);
    Object.assign(btPlan, { k, v: plan.combos[0].idx.map(j => members[j][1]) });
  }
  return btPlan.v.filter(i => team.mons[i]);
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
// 對手格子 i（寶可夢 key）當成配招算的：招式＝用過的，沒滿 4 招的用 OP.GG 使用率高的補滿 4 招（沒標過＝使用率前 4 招，同對位 duel 的預設）；
// 能力點數、性格＝改過的（osp），沒改的照 OP.GG 最常見（topSpread）。都沒有回傳 undefined（照 battler 的預設）
function btOppSet(i, key) {
  const used = battle.used[i], o = battle.osp[i], fmt = team.fmt;
  if (!used.length && !o) return undefined;
  const top = topSpread(key, fmt) || { sp: [0, 0, 0, 0, 0, 0], nat: [0, 0] }, common = byUse(useOf(key, fmt)?.moves || []).map(([k]) => k);
  return { moves: used.length ? [...used, ...common.filter(k => !used.includes(k))].slice(0, 4) : [], item: '', ab: '',
    sp: o?.sp || top.sp, nat: o?.nat || top.nat };
}
// 場上位置 p 的寶可夢（btUnit，帶那個位置的能力變化）；空的位置回傳 null
function btMon(side, p) {
  const i = battle[side][p];
  return i < 0 ? null : btUnit(side, i, battle.st[side][p]);
}
// 對位上顯示的名字（{ zh }）：變身中的寫「百變怪（變身成 X）」
const btTfName = X => X.tfFrom ? { zh: `${MON[X.tfFrom].zh}（變身成${MON[X.key].zh}）` } : MON[X.key];
// 算對位用的場上位置 p 的寶可夢：特性變身者（百變怪）當成已經變身成正對面那隻（Showdown imposter：對面位置 n−1−p，單打就是對手場上那隻；
// 對面空著就沒變），能力變化照位置卡調的（imposterVs 的 keepSt）。位置卡、HP 等照原本的 btMon
function btFieldMon(side, p) {
  const X = btMon(side, p);
  return X && imposterVs(X, btMon(side === 'me' ? 'opp' : 'me', btN() - 1 - p), true);
}
// 格子 i 的寶可夢：duel 用的 battler（我方照登錄的配招；對手套選的特性與 btOppItems 的道具、btOppSet），加上能力變化 st
// （s＝[攻擊, 防禦, 特攻, 特防, 速度]；後排換上場是 0）、目前 HP cur、順風 tw、異常狀態 status、這一方的牆 walls、
// 確定沒有道具 noItem（我方標了道具沒了、對手標了「沒有道具」）、場上還站著幾隻 field（雙打範圍招式只打到 1 隻時不減傷；至少算 1），
// 看場上狀況的特性（duel 的 live）：fallen 這一方目前倒下幾隻（大將；HP 0 的格子）、bust 畫皮被揭穿了，
// 另外帶 i 格子索引、H 最大 HP、pct 剩下的 HP %
function btUnit(side, i, s) {
  const key = btKey(side, i), fmt = team.fmt, gone = side === 'me' ? battle.noItem[i] : battle.item[i] === '-';
  // 我方登錄成超級進化、這場切回原型的，帶的是自己的超級石（不影響計算）
  const b = side === 'me' ? { ...battler(key, fmt, team.sets[i]), ...((key !== team.mons[i] || gone) && { item: '' }) }
    : { ...battler(key, fmt, btOppSet(i, key)), ab: defAbOf(key, fmt, battle.ab[i]), item: btOppItems()[i] };
  const H = hpOf(b), cur = side === 'me' ? Math.min(H, battle.hp[i] ?? H) : Math.ceil(H * battle.ohp[i] / 100);
  const field = Math.max(1, battle[side].slice(0, btN()).filter(j => j >= 0 && (side === 'me' ? battle.hp[j] !== 0 : battle.ohp[j] > 0)).length);
  return { ...b, st: Object.fromEntries(BT_STATS.map(([k], n) => [k, s[n]])), cur, tw: battle.tw.includes(side), status: battle.status[side][i],
    walls: battle.walls[side], noItem: gone && !MON[key].base, field, i, H, pct: side === 'me' ? hpPct(cur, H) : battle.ohp[i],
    live: true, fallen: btList(side).filter((k, j) => k && (side === 'me' ? battle.hp[j] === 0 : battle.ohp[j] === 0)).length, bust: battle.bust[side][i] };
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
// 型態切換；對手的超級進化標 OP.GG 帶這顆超級石的比例（預設型態見 btKey0：過半的預設超級進化）
function btFormHTML(side, i) {
  const forms = btForms(side, i), cur = btKey(side, i);
  if (!forms.length) return '';
  const p = side === 'opp' ? Object.fromEntries(megaInfo(forms[0], team.fmt).map(x => [x.mon.key, x.p])) : {};
  return `<div class="c-f"><span class="c-l">型態</span><div class="seg">${forms.map(m => `<button data-bform="${side}.${i}" data-k="${m.key}" aria-pressed="${m.key === cur}">`
    + `${m.base ? (forms.length > 2 ? m.zh : '超級進化') : '沒進化'}${p[m.key] != null ? `<span class="meta">${p[m.key]}% 帶石</span>` : ''}</button>`).join('')}</div></div>`;
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
// 對手用過的招式：常用招式一招一個按鈕（點一下標用過／取消），不在清單裡的從「其他招式」選；標滿 4 招就只算這 4 招
function btUsedHTML(i, key) {
  const used = battle.used[i], common = (useOf(key, team.fmt)?.moves || []).map(([k]) => k), full = used.length >= 4;
  const rest = Object.keys(MOVES).filter(k => !common.includes(k) && !used.includes(k)).sort((x, y) => MOVES[x][0].localeCompare(MOVES[y][0], 'zh-Hant'));
  return `<div class="c-f"><span class="c-l">用過的招式</span><div class="bt-bench">`
    + [...new Set([...common, ...used])].map(k => `<button class="mini" data-bused="${i}" data-k="${k}" aria-pressed="${used.includes(k)}"`
      + `${full && !used.includes(k) ? ' disabled' : ''}>${MOVES[k][0]}</button>`).join('')
    + (full ? '' : `<select class="sel" data-bused-add="${i}" aria-label="其他招式"><option value="">其他招式…</option>${rest.map(k => `<option value="${k}">${MOVES[k][0]}</option>`).join('')}</select>`)
    + `</div><span class="meta">${used.length}／4${full ? '：只算這 4 招' : used.length ? '：沒標的用使用率高的補滿 4 招' : '：照使用率前 4 招算；牠用了哪招就點，「打中」「實際」也會自動標'}</span></div>`;
}
// 對手的能力點數、性格：預設照 OP.GG 最常見（topSpread），可以改成 OP.GG 其他常見的（或從誰先動、實際傷害反推後套用）
function btSpreadHTML(i, key) {
  const use = useOf(key, team.fmt), top = topSpread(key, team.fmt), o = battle.osp[i] || {};
  if (!top) return '';
  const opt = (v, zh, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${zh}</option>`, nats = use.natures.map(([n]) => n.join('+'));
  return `<div class="c-f"><span class="c-l">能力點數</span><select class="sel" data-bosp="${i}" aria-label="能力點數"><option value="">OP.GG 最常見：${spText(top.sp)}</option>`
    + use.spreads.map(([sp, p]) => opt(sp.join('+'), `${spText(sp)}（${p}%）`, o.sp?.join('+'))).join('') + '</select></div>'
    + `<div class="c-f"><span class="c-l">性格</span><select class="sel" data-bonat="${i}" aria-label="性格"><option value="">OP.GG 最常見：${natText(top.nat)}</option>`
    + use.natures.map(([n, p]) => opt(n.join('+'), `${natText(n)}（${p}%）`, o.nat?.join('+'))).join('')
    + [[0, 0], ...NATURES].filter(n => !nats.includes(n.join('+'))).map(n => opt(n.join('+'), natText(n), o.nat?.join('+'))).join('') + '</select></div>';
}
function btPosHTML(side, p) {
  const i = battle[side][p], two = btN() > 1, me = side === 'me';
  const attr = `class="bt-pos${i < 0 ? ' empty' : ''}" data-side="${side}" data-p="${p}"${two ? ` aria-current="${battle.sel[side] === p}"` : ''}`;
  const tag = two ? `<span class="slot-n">位置 ${p + 1}</span>` : '';
  if (i < 0) return `<div ${attr}>${tag}<span>空的；點下方的寶可夢放上場</span></div>`;
  const b = btMon(side, p), m = MON[b.key], max = me ? b.H : 100, v = me ? b.cur : battle.ohp[i];
  const hp = `aria-label="剩下的 HP${me ? '' : ' %'}" min="0" max="${max}" step="1" value="${v}" data-bhp="${side}" data-i="${i}"`;
  // 我方帶的道具（登錄的或預設；切回原型的超級進化沒有）：用掉了、被拍落就點「道具沒了」，之後照沒道具算（拍落不加成）
  const it0 = me && b.key === team.mons[i] ? battler(b.key, team.fmt, team.sets[i]).item : '';
  const info = me ? `<div class="meta bt-info">${team.sets[i] ? '照登錄的配招' : '沒登錄配招，照預設'}・${abilZh(b.ab) || '沒有特性統計'}`
      + `${it0 ? `・${ITEMS[it0][0]}${battle.noItem[i] ? '（沒了）' : ''}<button class="mini" data-bnoitem="${i}" aria-pressed="${battle.noItem[i]}">道具沒了</button>` : ''}</div>`
    : `<div class="c-f"><span class="c-l">特性</span><select class="sel" data-bab="${i}" aria-label="特性">${abilOptions(BT_REL, b.key, b.ab)}</select></div>`
      + `<div class="c-f"><span class="c-l">道具</span><select class="sel" data-bitem="${i}" aria-label="道具"${m.base ? ' disabled' : ''}>${btItemOptions(i, b.key)}</select></div>`
      + btSpreadHTML(i, b.key) + btUsedHTML(i, b.key);
  // 收起時的摘要：異常狀態、不是 0 的能力變化、特性、道具（對手另外標改過的點數、用過幾招）
  const s = battle.st[side][p], fold = `${side}.${p}`, sta = battle.status[side][i];
  const sum = [sta && BT_STATUS.find(([k]) => k === sta)[1], BT_STATS.map(([, zh], n) => s[n] ? `${zh} ${stgText(s[n])}` : '').filter(Boolean).join('・') || '能力變化都是 0', abilZh(b.ab),
    me ? b.item ? ITEMS[b.item][0] : it0 && '道具沒了' : m.base ? '超級石' : b.item ? `${ITEMS[b.item][0]}${battle.item[i] ? '' : '（預設）'}` : '沒有道具',
    !me && battle.osp[i] && '點數／性格改過', !me && battle.used[i].length && `用過 ${battle.used[i].length} 招`].filter(Boolean).join('・');
  const status = `<div class="c-f"><span class="c-l">異常狀態</span><div class="seg">${BT_STATUS.map(([k, zh]) =>
    `<button data-bstat="${side}.${i}" data-v="${k}" aria-pressed="${sta === k}">${zh}</button>`).join('')}</div></div>`;
  return `<div ${attr}><div class="bt-h">${tag}<b>${m.zh}</b>${chips(m.types)}<button class="mini bt-off" data-bout="${fold}">下場</button></div>`
    + btFormHTML(side, i)
    + `<div class="bt-hp"><span class="c-l">HP</span><input type="range" ${hp}><input type="number" class="sel c-num" inputmode="numeric" ${hp}>`
    + `<span class="meta bt-hpt">${btHpText(side, v, max)}</span></div>` + btEntryHTML(side, b) + btDisguiseHTML(side, i, b)
    + `<details class="bt-more" data-fold="${fold}"${btIsOpen(fold) ? ' open' : ''}><summary>${sum}</summary>${btStHTML(side, p)}${status}${info}</details></div>`;
}
// 出場特性一鍵套用（同傷害計算的提示）：威嚇＝對面場上每隻照 intimidateOn 改攻擊（不吃威嚇的不改、不服輸等反而上升），
// 開天氣／場地的特性＝改成那種天氣／場地（已經是就不列）
function btEntryHTML(side, b) {
  const f = FIELD_SET[b.ab], wx = ENTRY_WEATHER.includes(b.ab), tr = ENTRY_TERRAIN.includes(b.ab);
  const btns = [b.ab === 'intimidate' && `<button class="mini" data-bintim="${side}">${abilZh(b.ab)}：對面攻擊 −1</button>`,
    wx && battle.weather !== f && `<button class="mini" data-bw="${f}">${abilZh(b.ab)}：改成${FIELD_ZH[f]}</button>`,
    tr && battle.terrain !== f && `<button class="mini" data-bf="${f}">${abilZh(b.ab)}：改成${FIELD_ZH[f]}</button>`].filter(Boolean);
  return btns.length ? `<div class="c-f"><span class="c-l">出場特性</span>${btns.join('')}</div>` : '';
}
// 畫皮（謎擬Ｑ的特性是畫皮時）：還在＝這一下沒有傷害、改扣 1/8；點「破了」切換（按「打中」「實際」打到牠也會自動標成破了）
function btDisguiseHTML(side, i, b) {
  if (b.key !== 'mimikyu' || b.ab !== 'disguise') return '';
  const on = battle.bust[side][i];
  return `<div class="c-f"><span class="c-l">${abilZh('disguise')}</span><button class="mini" data-bbust="${side}.${i}" aria-pressed="${on}">破了</button>`
    + `<span class="meta">${on ? '已經破了，照一般傷害算' : '還在：第一下沒有傷害、改扣 1/8'}</span></div>`;
}
// 位置卡的能力變化、特性、道具可以收起：寬螢幕（並排顯示結果時）預設打開、窄螢幕預設收起，點過就照點的（不存網址）
const btFold = {};
const btIsOpen = k => k in btFold ? btFold[k] : matchMedia('(min-width: 901px)').matches;
$('#p-battle').addEventListener('toggle', e => { const k = e.target.dataset?.fold; if (k) btFold[k] = e.target.open; }, true);
// 下方的寶可夢按鈕（btShown）：場上的標起來，HP 不滿的標剩下多少、對手標了的道具
// 只列這場會出場的：我方列這場帶的（btBrought），對手出場過的滿了帶出場的隻數（單打 3、雙打 4）就不列其他的；在場上的一定列
function btShown(side) {
  const on = battle[side].slice(0, btN());
  if (side === 'me') { const b = btBrought(); return team.mons.map((k, i) => k && (b.includes(i) || on.includes(i))); }
  const all = battle.seen.filter((v, i) => v && bring.opp[i]).length >= BRING_N[team.fmt];
  return bring.opp.map((k, i) => !!k && (!all || battle.seen[i] || on.includes(i)));
}
// 猜對手帶誰（oppBringPlan，同出戰選角的「對手可能帶的」）；對手、我方隊伍、單打／雙打沒變就不重算
const btGuess = { k: null, v: null };
function btOppGuess() {
  const k = JSON.stringify([bring.opp, team.mons, team.fmt]);
  if (btGuess.k !== k) Object.assign(btGuess, { k, v: oppBringPlan(bring.opp, team.mons, team.fmt) });
  return btGuess.v;
}
// 對手還沒出場的猜誰：帶法依序找第一個包含所有出場過的；都還沒出場時連先發一起猜。出場過的滿了（或猜不了）回傳 ''
function btGuessText() {
  const g = btOppGuess();
  if (!g) return '';
  const seen = g.at.map((i, j) => battle.seen[i] ? j : -1).filter(j => j >= 0), nm = j => MON[btKey('opp', g.at[j])].zh;
  if (seen.length >= g.k) return '';
  if (!seen.length) return `猜會帶 ${g.combos[0].idx.map(nm).join('、')}，先發 ${g.pick.js.map(nm).join('、')}`;
  const c = g.combos.find(c => seen.every(j => c.idx.includes(j)));
  return c ? `猜還有 ${c.idx.filter(j => !seen.includes(j)).map(nm).join('、')}` : '';
}
// 「這場帶的」「對手出場過的」：收起時摘要列名字（對手另外列還沒出場的猜誰），點開可以改（點一下加入／拿掉）；我方自己改過的可以改回照出戰選角
function btPickHTML(side) {
  const me = side === 'me', list = btList(side), fold = 'pick.' + side;
  const has = me ? (b => i => b.includes(i))(btBrought()) : i => battle.seen[i];
  const names = list.map((k, i) => k && has(i) ? MON[btKey(side, i)].zh : '').filter(Boolean);
  const head = me ? `這場帶的（${battle.bring ? '自己選的' : bring.opp.some(Boolean) ? '照出戰選角第 1 名' : '還沒填對手，全部列出'}）`
    : `對手出場過的（${names.length}／${BRING_N[team.fmt]}，放上場就會標）`;
  const guess = me ? '' : btGuessText();
  return `<details class="bt-pick" data-fold="${fold}"${btFold[fold] ? ' open' : ''}><summary>${head}：${names.join('、') || '（還沒有）'}${guess ? `・${guess}` : ''}</summary><div class="bt-bench">`
    + list.map((k, i) => k ? `<button class="mini" data-bpick="${side}" data-i="${i}" aria-pressed="${has(i)}">${MON[btKey(side, i)].zh}</button>` : '').join('')
    + (me && battle.bring ? '<button class="mini" data-bpick0>改回照出戰選角</button>' : '') + '</div></details>';
}
function btBenchHTML(side) {
  const on = battle[side].slice(0, btN()), shown = btShown(side);
  return btList(side).map((k, i) => {
    if (!k || !shown[i]) return '';
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
    + `<div class="bt-bench" id="btBench-${side}">${btBenchHTML(side)}</div>` + btPickHTML(side);
}
// ----- 打了才知道：從實際傷害、誰先動反推對手的配置 -----
// 暫存（不存網址）：btEdit＝正在填「實際」的那一列（列的 id，見 btMoveRow）；btObs＝某組對位的比對結果 { pair, html }
let btEdit = null, btObs = null;
// 場上格子 i（side）現在的 btMon；不在場上回傳 null
const btAt = (side, i) => { const p = battle[side].slice(0, btN()).indexOf(i); return p < 0 ? null : btFieldMon(side, p); };
// duel 用的速度資料（同 duel 的 spe）
const btSpe = b => ({ key: b.key, inv: b.speInv, sp: b.sp, nat: b.nat, st: b.st?.spe || 0, item: b.item, ab: b.ab, tw: !!b.tw, par: b.status === 'par', status: !!b.status });
// 對手 O（btMon）換一種配置 c { item（'-'＝沒有道具）, sp, nat }：最大 HP 跟著點數變，剩下的 HP 照原本的 % 換算
function btVariant(O, c) {
  const v = { ...O, ...(c.item != null && { item: c.item === '-' ? '' : c.item, noItem: c.item === '-' }), ...(c.sp && { sp: c.sp, nat: c.nat }) };
  v.H = hpOf(v); v.cur = Math.ceil(v.H * battle.ohp[O.i] / 100);
  return v;
}
// 對手 O 可能的其他配置裡，對得上觀察的（ok(對手配置) 為真）：先試只改一項（道具 items、或 OP.GG 常見的點數＋性格，
// 性格不降有投點數的那項），都對不上才試道具和點數性格一起改。依 OP.GG 使用率由高到低取前 3 個，每個 { item?, sp?, nat?, w, label }
// 變身中的對手（百變怪）：道具照百變怪自己的使用率，能力點數性格是抄來的、不試
function btFix(O, items, ok) {
  const k0 = O.tfFrom || O.key, use = useOf(k0, team.fmt), top = O.tfFrom ? null : topSpread(O.key, team.fmt), itemUse = Object.fromEntries(use?.items || []);
  const taken = new Set(battle.item.filter((k, j) => k && k !== '-' && j !== O.i));
  const its = [...new Set(items)].filter(k => k === '-' ? !!O.item : ITEMS[k] && !taken.has(k) && k !== O.item && !MON[k0].base)
    .map(k => ({ item: k, w: itemUse[k] || 0.5, label: k === '-' ? '沒有道具' : `${ITEMS[k][0]}${itemUse[k] ? `（這隻 ${itemUse[k]}% 帶）` : ''}` }));
  const sps = top ? use.spreads.flatMap(([sp, p]) => [...use.natures, [[0, 0], 0]].filter(([n]) => !n[1] || !sp[n[1]])
    .filter(([n]) => sp.join() !== (O.sp || []).join() || n.join() !== (O.nat || []).join())
    .map(([n, q]) => ({ sp, nat: n, w: p * Math.max(q, 0.5), label: `點數 ${spText(sp)}・${natText(n)}（OP.GG ${p}%${q ? `／${q}%` : ''}）` }))) : [];
  const pick = list => list.filter(c => ok(btVariant(O, c))).sort((x, y) => y.w - x.w).filter((c, n, a) => a.findIndex(d => d.label === c.label) === n).slice(0, 3);
  const one = pick([...its, ...sps]);
  return one.length ? one : pick(its.flatMap(a => sps.map(b => ({ ...a, ...b, w: a.w * b.w, label: `${a.label}＋${b.label}` }))));
}
// 比對結果：不符合預測時列出可以套用的配置（按鈕帶對手格子與配置）；都對不上時說可能的原因 why
const btFixHTML = (i, fixes, why) => fixes.length
  ? '可能是：' + fixes.map(c => `<button class="mini" data-bfix="${i}"${c.item != null ? ` data-item="${c.item}"` : ''}`
    + `${c.sp ? ` data-sp="${c.sp.join('+')}" data-nat="${c.nat.join('+')}"` : ''}>套用 ${c.label}</button>`).join('')
  : `OP.GG 常見的道具、點數、性格都對不上（可能是${why}沒標）。`;
// 實際誰先動（oppFirst＝牠先動）：和預測對不上時，試對手帶／不帶講究圍巾、其他常見的點數性格。
// 戲法空間時慢的先動：牠先動＝牠比預測慢（試不帶講究圍巾），我先動＝牠比預測快（試講究圍巾）
function btSpeedObs(M, O, f, oppFirst) {
  const fld = { weather: f.weather, terrain: f.terrain, tr: !!f.tr }, sp = v => speedPair(btSpe(M), btSpe(v), fld);
  const fits = v => { const s = sp(v).first; return s < 0 || (s === 1) === oppFirst; };
  const now = sp(O), tag = `（速度：${btTfName(M).zh} ${now.spd[0].v}／${btTfName(O).zh} ${now.spd[1].v}${f.tr ? '，戲法空間：慢的先動' : ''}）`;
  if (fits(O)) return `<div class="c-sum good">✔ ${oppFirst ? '牠先動' : '我先動'}，和預測一樣${tag}</div>`;
  const faster = oppFirst !== !!f.tr;
  const items = faster ? ['choice-scarf'] : (useOf(O.tfFrom || O.key, team.fmt)?.items || []).map(([k]) => k).filter(k => k !== 'choice-scarf' && !isStone(k)).slice(0, 2).concat('-');
  const fixes = btFix(O, items, v => fits(v) && sp(v).spd[1].v !== now.spd[1].v);
  return `<div class="c-sum bad">⚠ 實際${oppFirst ? '牠先動' : '我先動'}，牠比預測${faster ? '快' : '慢'}${tag}；${btFixHTML(O.i, fixes, '能力變化、特性、場地、順風或麻痺')}</div>`;
}
// 實際傷害：dir＝xy（我打牠）／yx（牠打我），招式 k，打完剩下 after（我方是 HP、對手是 %）。和預測（招式的最低～最高）比，
// 對不上時試對手的其他道具（牠打我：會讓這招變痛的攻擊道具；我打牠：這招屬性的抗性樹果）和常見的點數性格；
// 比預測痛時先看急所（crit）對不對得上（遊戲會顯示是不是急所，是的話不用改配置）
function btDmgObs(M, O, f, dir, k, after) {
  const row = (v, crit) => { const d = duel(M, v, { ...f, crit }); return (dir === 'xy' ? d.xy : d.yx).ok.find(x => x.k === k)?.r; };
  const r = row(O);
  if (!r) return '';
  // 實際傷害的範圍（%）：我方 HP 是準的；對手的 % 前後各算 ±1（畫面上的 % 是四捨五入過的）；打倒了只知道至少打掉剩下的
  const before = dir === 'xy' ? battle.ohp[O.i] : M.cur * 100 / M.H, got = dir === 'xy' ? before - after : (M.cur - after) * 100 / M.H;
  const lo = dir === 'xy' ? got - 1 : got - 0.01, hi = after <= 0 ? Infinity : dir === 'xy' ? got + 1 : got + 0.01;
  const fits = x => x && x.max * 100 / x.hp >= lo && x.min * 100 / x.hp <= hi;
  const mzh = MOVES[k][0], pred = `${hpPct(r.min, r.hp)}～${hpPct(r.max, r.hp)}%`, gotText = `${after <= 0 ? '至少 ' : ''}${Math.round(got * 10) / 10}%`;
  if (fits(r)) return `<div class="c-sum good">✔ ${mzh}實際扣了 ${gotText}，在預測 ${pred} 內</div>`;
  const more = r.max * 100 / r.hp < lo, ty = r.type, use = useOf(O.tfFrom || O.key, team.fmt);
  const items = dir === 'yx'
    ? [...Object.entries(DMG_ITEMS).filter(([, v]) => v.side.includes('a') && !v.mon && (v.type === ty || v.cat === r.cat || v.final || v.se && r.eff > 1)).map(([key]) => key),
      ...(use?.items || []).map(([key]) => key).filter(key => !isStone(key)).slice(0, 3), '-']
    : [...Object.entries(DMG_ITEMS).filter(([, v]) => v.berry === ty).map(([key]) => key), ...(use?.items || []).map(([key]) => key).filter(key => !isStone(key)).slice(0, 3), '-'];
  const fixes = btFix(O, items, v => fits(row(v)));
  const how = dir === 'yx' ? (more ? '牠打得比預測痛' : '牠打得比預測輕') : (more ? '牠比預測不耐打' : '牠比預測耐打');
  const cr = more && row(O, true), crit = cr && fits(cr) ? `急所的話是 ${hpPct(cr.min, cr.hp)}～${hpPct(cr.max, cr.hp)}%，對得上：這下是急所就不用改配置；不是急所的話，` : '';
  return `<div class="c-sum bad">⚠ ${mzh}實際扣了 ${gotText}，預測 ${pred}：${how}；${crit}${btFixHTML(O.i, fixes, '能力變化、特性或場地')}</div>`;
}
// ----- 下方：每一組對位（我方 × 對手）的結果 -----
// 一招一列：佔對方最大 HP 的 %、幾擊打倒（看剩下的 HP）。ctx：{ side 挨打的一方, i 挨打的格子, pair 對位 id「我方格子.對手格子」, dir xy／yx, used 對手用過這招 }
// 「打中」＝照平均傷害（最低、最高的平均）扣挨打那一方剩下的 HP；「實際」＝填打完剩下多少，扣血並和預測比對（btDmgObs）。
// 對手的招式按「打中」「實際」也會標成用過
function btMoveRow(x, ctx) {
  const r = x.r, id = `${ctx.pair}|${ctx.dir}|${x.k}`, attr = `class="bt-mv" data-pair="${ctx.pair}" data-dir="${ctx.dir}" data-k="${x.k}"`;
  if (!r.eff) return `<div ${attr}><b>${MOVES[x.k][0]}</b>${chip(r.type)}<span class="ko">沒有效果${r.immuneBy ? `（${abilZh(r.immuneBy)}）` : r.blockedBy ? `（${r.blockedBy}）` : ''}</span></div>`;
  const kt = koText(r.ko), tags = [FLAG.priority.has(x.k) && '先制', r.spread && '範圍 ×0.75',
    r.endured && `${ITEMS[r.endured]?.[0] || abilZh(r.endured)}撐住第一下`, r.berry && '樹果減半第一下', ctx.used && '✓用過'].filter(Boolean);
  const avg = Math.round((r.min + r.max) / 2), me = ctx.side === 'me';
  const cur = me ? Math.min(r.hp, battle.hp[ctx.i] ?? r.hp) : battle.ohp[ctx.i];
  // 打中後挨打那一方的道具會不會沒了（data-eat，「打中」「實際」照這個標）：抗性樹果有減半、氣球被打中就破、拍落拍掉（黏著拍不掉）＝1；
  // 氣勢披帶撐住了才用掉＝sash（打倒時才算）；超級進化帶的是超級石，不算
  const t = ctx.tgt, eat = !t?.item || MON[t.key].base ? '' : r.berry || DMG_ITEMS[t.item]?.balloon || (x.k === 'knock-off' && t.ab !== 'sticky-hold') ? '1'
    : r.endured === t.item ? 'sash' : '';
  // 打到畫皮還在的謎擬Ｑ（data-bust）：「打中」「實際」後標成破了
  return `<div ${attr}${eat ? ` data-eat="${eat}"` : ''}${r.disguise ? ' data-bust' : ''}><b>${MOVES[x.k][0]}</b>${chip(r.type)}${mtag(r.eff)}<span class="bt-pct">${hpPct(r.min, r.hp)}～${hpPct(r.max, r.hp)}%</span>`
    + `${tags.length ? `<span class="meta">${tags.join('・')}</span>` : ''}<span class="ko k${kt.n}">${kt.text}</span>`
    + `<button class="mini bt-hit" data-bhit="${ctx.side}.${ctx.i}" data-dmg="${avg}"${r.endured ? ' data-end' : ''} title="照平均傷害扣掉約 ${hpPct(avg, r.hp)}%">打中</button>`
    + `<button class="mini bt-hit" data-bact="${id}" aria-pressed="${btEdit === id}" title="填打完剩下多少，和預測比對">實際</button>`
    + (btEdit === id ? `<div class="bt-act">打完剩下<input type="number" class="sel c-num" inputmode="numeric" min="0" max="${me ? r.hp : 100}" value="${cur}" data-bactv aria-label="打完剩下的 HP${me ? '' : ' %'}">`
      + `<span class="meta">${me ? `／${r.hp} HP` : '%'}</span><button class="mini" data-bactok="${id}">確定</button></div>` : '') + '</div>';
}
const btHit = x => `${mvName(x.k)} ${hpPct(x.r.min, x.r.hp)}～${hpPct(x.r.max, x.r.hp)}% ${koText(x.r.ko).text}`;
const btHits = xs => xs.slice(0, 2).map(btHit).join('、');
const btPri = xs => xs.filter(x => FLAG.priority.has(x.k));
function btPairHTML(M, O, f) {
  // 變身中的（百變怪，見 btFieldMon）寫「百變怪（變身成 X）」
  const mm = btTfName(M), om = btTfName(O);
  const head = tail => `<div class="bt-ph"><b>${mm.zh}</b><span class="meta">剩 ${M.pct}%</span><span>⇄</span><b>${om.zh}</b><span class="meta">剩 ${O.pct}%</span>${tail}</div>`;
  const pair = `${M.i}.${O.i}`, obsHTML = btObs?.pair === pair ? btObs.html : '';
  // 倒下了：「實際」打倒時的比對結果照樣顯示
  if (!M.cur || !O.cur) return `<div class="bt-pair">${head(`<span class="bt-ord">${!M.cur ? mm.zh : om.zh}倒下了</span>`)}${obsHTML}</div>`;
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
  // 牠有一擊打得倒我方的招：後排換上來吃同一招（btTakeHTML）。我方先動又確定一擊打倒牠、牠也沒有先制招式打得倒時不用換，不列
  const safe = d.first === 0 && !btPri(kill).length && mine.some(x => x.r.ko[0] > 1 - 1e-9);
  const take = kill.length && !safe ? btTakeHTML(M, O, f, kill.slice(0, 2), d.first === 0 && !btPri(kill).length) : '';
  const used = battle.used[O.i];
  // 牠打我那一區列最痛的 n 招，再加上用過的（才按得到「打中」「實際」）
  const rows = (x, n, ctx) => x.ok.length ? x.ok.filter((m, k) => n == null || k < n || ctx.dir === 'yx' && used.includes(m.k))
    .map(m => btMoveRow(m, { ...ctx, used: ctx.dir === 'yx' && used.includes(m.k) })).join('')
    : `<div class="meta">${x.use.length ? '沒有能算傷害的攻擊招式' : '沒有招式資料'}</div>`;
  // 實際誰先動：點了和預測比對（btSpeedObs），結果顯示在下面
  const obs = `<span class="bt-obs"><span class="meta">實際：</span><button class="mini" data-bobs="${pair}" data-who="me">我先動</button>`
    + `<button class="mini" data-bobs="${pair}" data-who="opp">牠先動</button></span>`;
  return `<div class="bt-pair">${head(`<span class="bt-ord">${order}</span>`)}`
    + `<div class="meta">速度：${mm.zh} ${spd(0, M)}／${om.zh} ${spd(1, O)}${f.tr ? '（戲法空間：慢的先動）' : ''}${obs}</div>`
    + obsHTML
    + lines.map(([c, t]) => c ? `<div class="c-sum ${c}">${t}</div>` : `<div class="x-line"><span class="x-msg">${t}</span></div>`).join('')
    + take
    + `<div class="bt-sub">${mm.zh}打${om.zh}</div>${rows(d.xy, undefined, { side: 'opp', i: O.i, pair, dir: 'xy', tgt: O })}`
    + Object.entries(d.xy.why).map(([w, ns]) => `<div class="x-line"><span class="x-msg">不算（${w}）：</span>${ns.join('、')}</div>`).join('')
    + `<div class="bt-sub">${om.zh}打${mm.zh}<span class="meta">（最痛的 3 招＋用過的${used.length >= 4 ? '，只算用過的 4 招' : used.length ? `，用過 ${used.length} 招、其他照使用率補滿 4 招` : '，照使用率前 4 招'}）</span></div>`
    + `${rows(d.yx, 3, { side: 'me', i: M.i, pair, dir: 'yx', tgt: M })}</div>`;
}
// ----- 換人：後排對上場上的對手 -----
// 後排＝這場帶的（btBrought）不在場上、還沒倒下的格子
const btBench = () => { const on = battle.me.slice(0, btN()); return btBrought().filter(i => !on.includes(i) && battle.hp[i] !== 0); };
// 場上的 M 會被 O 一擊打倒時：後排換上來吃同一招（threat：打得倒 M 的招，最痛的 2 招）各剩多少。換上來的算法同 btSwapHTML
// （能力變化歸 0、用目前剩下的 HP、有威嚇先打 O、特性變身者變成 O）。沒有效果＝無傷、吃得到一擊打倒的＝會倒、其他＝扛得住，
// 依這個順序、再依最痛那招的最高 % 由低到高排。meFirst＝我方先動（只是打不倒牠）、上面沒有警告，標題說明牠打回來就會倒
function btTakeHTML(M, O, f, threat, meFirst) {
  const mm = btTfName(M), names = threat.map(x => MOVES[x.k][0]).join('、');
  const rows = btBench().map(i => {
    const B = btUnit('me', i, [0, 0, 0, 0, 0]), Bt = imposterVs(B, O), d = duel(Bt, intimidated(O, Bt), f);
    const rs = threat.map(x => [x.k, d.yx.ok.find(y => y.k === x.k)?.r]).filter(([, r]) => r);
    if (!rs.length) return null;
    const worst = Math.max(...rs.map(([, r]) => r.eff ? r.max / r.hp : 0)), ko = rs.some(([, r]) => r.eff && r.ko[0] > 1e-9);
    const [rank, c, tag] = !worst ? [0, 'm2', '無傷'] : ko ? [2, 'mh', '會倒'] : [1, 'm1', '扛得住'];
    const txt = rs.map(([k, r]) => !r.eff ? `${mvName(k)} 沒有效果${r.immuneBy ? `（${abilZh(r.immuneBy)}）` : r.blockedBy ? `（${r.blockedBy}）` : ''}`
      : `${mvName(k)} ${hpPct(r.min, r.hp)}～${hpPct(r.max, r.hp)}%${r.ko[0] > 1e-9 ? ` ${koText(r.ko).text}`
        : `，吃完剩 ${hpPct(Math.max(1, B.cur - r.max), r.hp)}～${hpPct(B.cur - r.min, r.hp)}%`}`).join('・');
    return [rank, worst, `<div class="x-line"><span class="mtag ${c}">${tag}</span><b>${MON[B.key].zh}</b>`
      + `<span class="meta">剩 ${B.pct}%${Bt.tfFrom ? `・換上來變身成${MON[Bt.key].zh}` : ''}</span><span>${txt}</span></div>`];
  }).filter(Boolean).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  if (!rows.length) return '';
  return `<div class="bt-sub">換下${mm.zh}，後排吃${names}${meFirst ? `<span class="meta">（${mm.zh}先動也不一定打得倒牠，牠打回來就會倒）</span>` : ''}</div>`
    + rows.map(x => x[2]).join('');
}
// 每隻後排對上場上每隻對手看 matchup（同出戰選角的對位）：我方用目前剩下的 HP
// （換上場能力變化歸 0、我方順風照舊），對手用目前的 HP、能力變化和修正過的招式／道具／點數。
// ✔ 換上來先吃牠最痛的一招還打得贏、贏＝正面打得贏（場上的倒下後再補上，不用先吃一下）、⚠ 牠先動一下就打倒我、✘ 打不贏；依這個順序排
function btSwapHTML(opps, f) {
  const bench = btBench(), alive = opps.filter(O => O.cur);
  if (!bench.length || !alive.length) return '';
  const n = x => x < 9 ? `${x} 下` : '四下打不倒', fmt = team.fmt;
  return `<div class="res-head">換人<span class="muted small">（後排換上來對上場上的對手）</span></div>`
    + alive.map(O => {
      const om = btTfName(O);
      const rows = bench.map(i => {
        // 特性變身者（百變怪）換上來就變成這隻對手（連牠目前的能力變化；imposterVs）
        const M = btUnit('me', i, [0, 0, 0, 0, 0]), mm = MON[M.key], Mt = imposterVs(M, O);
        const who = `<b>${mm.zh}</b><span class="meta">剩 ${M.pct}%${Mt.tfFrom ? `・換上來變身成${MON[Mt.key].zh}` : ''}</span>`;
        if (!useOf(M.key, fmt, M.set)?.moves.length || !useOf(O.key, fmt, O.set)?.moves.length) return [4, `<div class="x-line">${who}<span class="x-msg">沒有招式資料，不能算</span></div>`];
        // 換上來的這隻有威嚇就打場上的對手（對手早就在場上，牠的威嚇不會再觸發）
        const r = matchup(Mt, O, { ...f, intim: 'me' }), big = r.big && MOVES[r.big][0], left = r.left > 0 ? `剩 ${hpPct(r.left, M.H)}%` : '會倒';
        const [rank, v, c, why] = r.sw ? [0, '✔', 'm2', big ? `換上來吃${big}${left}，還打得贏` : '換上來也打得贏（牠沒有打得痛的招式）']
          : r.head ? [1, '贏', 'm1', `正面打得贏，但換上來吃${big}${left}${r.left > 0 ? '就打不贏' : ''}：等場上的倒下再補上`]
          : r.ohko ? [3, '⚠', 'mh', `牠先動一下就打倒${mm.zh}`] : [2, '✘', 'mh', '打不贏'];
        return [rank, `<div class="x-line"><span class="mtag ${c}">${v}</span>${who}<span>${why}</span>`
          + `<span class="meta">${r.first < 0 ? '同速' : r.first ? '牠先動' : '我先動'}（速度 ${r.spd.join('／')}）・我 ${n(r.me)}、牠 ${n(r.opp)}</span></div>`];
      });
      return `<div class="bt-pair"><div class="bt-ph"><span>對上</span><b>${om.zh}</b><span class="meta">剩 ${O.pct}%</span></div>`
        + rows.map((x, k) => [...x, k]).sort((x, y) => x[0] - y[0] || x[2] - y[2]).map(x => x[1]).join('') + '</div>';
    }).join('');
}
// ----- 雙打集火：對手場上兩隻一起打我方同一隻 -----
// 每隻對手用打這隻最痛（最高傷害）的招，兩招所有下數的亂數（各 16 種等機率）相加，算打掉剩下 HP 的機率。
// 只擋第一下的（氣勢披帶、結實撐住，多重鱗片、畫皮）只算在先打到的那一下：後打的那下照「不是全滿、畫皮已揭穿」算；
// 兩種先後都算，取比較容易倒的（不看速度）。依倒的機率、再依合計最高傷害由高到低排
const btKoSum = (hits, need) => {
  let dist = new Map([[0, 1]]);
  hits.forEach(rs => { const nd = new Map(); dist.forEach((p, v) => rs.forEach(x => { const s = Math.min(need, v + x); nd.set(s, (nd.get(s) || 0) + p / rs.length); })); dist = nd; });
  return dist.get(need) || 0;
};
function btFocusHTML(mine, opps, f) {
  const alive = opps.filter(O => O.cur), on = mine.filter(M => M.cur);
  if (btN() < 2 || alive.length < 2 || !on.length) return '';
  const best = (M, O) => duel(M, O, f).yx.ok.find(x => x.r.eff);
  const rows = on.map(M => {
    const M2 = { ...M, cur: Math.min(M.cur, M.H - 1), bust: true };
    const cases = [[alive[0], alive[1]], [alive[1], alive[0]]].map(([A, B]) => {
      const a = best(M, A), b = best(M2, B);
      if (!a || !b) return null;
      // 先打到的那下被氣勢披帶／結實撐住：最多打到剩 1
      const ra = a.r.endured ? a.r.rolls.map((rs, h) => h ? rs : rs.map(x => Math.min(x, M.cur - 1))) : a.r.rolls, hits = [...ra, ...b.r.rolls];
      const sum = k => hits.reduce((s, rs) => s + rs[k], 0);
      return { A, B, a, b, p: btKoSum(hits, M.cur), lo: sum(0), hi: sum(15) };
    }).filter(Boolean).sort((x, y) => y.p - x.p || y.hi - x.hi);
    if (!cases.length) return null;
    const w = cases[0], mm = btTfName(M), [c, tag] = w.p > 1 - 1e-9 ? ['mh', '確定倒'] : w.p > 1e-9 ? ['mh', `亂數倒（${Math.min(99.9, Math.max(0.1, Math.round(w.p * 1000) / 10))}%）`] : ['m2', '扛得住'];
    const one = (O, x) => `${btTfName(O).zh}的${mvName(x.k)}`;
    return [w.p, w.hi / M.H, `<div class="x-line"><span class="mtag ${c}">${tag}</span><b>${mm.zh}</b><span class="meta">剩 ${M.pct}%</span>`
      + `<span>${one(w.A, w.a)}＋${one(w.B, w.b)}：合計 ${hpPct(w.lo, M.H)}～${hpPct(w.hi, M.H)}%</span></div>`];
  }).filter(Boolean).sort((x, y) => y[0] - x[0] || y[1] - x[1]);
  return rows.length ? `<div class="bt-pair"><div class="bt-ph"><b>集火</b><span class="meta">對手兩隻一起打同一隻</span></div>${rows.map(x => x[2]).join('')}</div>` : '';
}
// ----- 雙打對手組合：對手場上兩隻（P 發動、Q 是隊友）搭配的威脅 -----
// 對手的招式照對位算的那幾招：用過的＋使用率補滿 4 招（同 dmgRows 的 o.top），含變化招式
const btOppMoves = O => { const use = useOf(O.key, team.fmt, O.set)?.moves || []; return (O.set?.moves?.some(Boolean) ? use : byUse(use).slice(0, 4)).map(([k]) => k); };
// 招式名＋不是 0 的先制（MOVES[k][7]）
const btMvPri = k => `${MOVES[k][0]}${MOVES[k][7] ? `（${MOVES[k][7] > 0 ? '+' : ''}${MOVES[k][7]} 先制）` : ''}`;
// 重算數字的：順風（對手還沒有順風）、戲法空間（開或收）、天氣／場地招式（和現在不同）＝對手哪隻變成比我方哪隻先動（只列對手變快的，沒變就不列）；
// 幫助＝Q 的招式 ×1.5 後一擊打倒我方的機率變高的（每隻我方取機率最高的一招）。
// 文字提醒的：擊掌奇襲（只有上場後第一回合）、看我嘛／憤怒粉（把我方單一目標的招引走）。
// 每個 P 最後列「先處理」：我方場上這回合一下打得倒牠的（每隻取一擊機率最高的一招，附誰先動）
function btComboHTML(mine, opps, f) {
  const alive = opps.filter(O => O.cur), on = mine.filter(M => M.cur);
  if (btN() < 2 || alive.length < 2 || !on.length) return '';
  const name = X => btTfName(X).zh, fld0 = { weather: f.weather, terrain: f.terrain, tr: !!f.tr }, best = xs => xs.slice().sort((a, b) => b.r.ko[0] - a.r.ko[0])[0];
  const flips = (fld, tw) => on.flatMap(M => alive.filter(X => speedPair(btSpe(M), btSpe(X), fld0).first !== 1
    && speedPair(btSpe(M), btSpe(tw ? { ...X, tw: true } : X), fld).first === 1).map(X => `${name(X)}比${name(M)}先動`));
  const blocks = [[alive[0], alive[1]], [alive[1], alive[0]]].map(([P, Q]) => {
    const mv = btOppMoves(P), has = k => mv.includes(k), lines = [];
    const speed = (k, fld, tw, verb = '開了') => { const x = flips(fld, tw); if (x.length) lines.push(`${btMvPri(k)}：${verb}之後${x.join('、')}`); };
    if (has('tailwind') && !battle.tw.includes('opp')) speed('tailwind', fld0, true);
    if (has('trick-room')) speed('trick-room', { ...fld0, tr: !fld0.tr }, false, fld0.tr ? '收掉' : '開了');
    mv.filter(k => FIELD_SET[k]).forEach(k => {
      const fd = FIELD_SET[k], kind = WEATHERS.includes(fd) ? 'weather' : 'terrain';
      if (fld0[kind] !== fd) speed(k, { ...fld0, [kind]: fd }, false);
    });
    if (has('helping-hand')) on.forEach(M => {
      const ko0 = Math.max(0, ...duel(M, Q, f).yx.ok.map(x => x.r.ko?.[0] || 0)), x = best(duel(M, Q, { ...f, hh: true }).yx.kos);
      if (x && x.r.ko[0] > ko0 + 1e-9) lines.push(`${btMvPri('helping-hand')}：${name(Q)}的${mvName(x.k)}打${name(M)}變成 ${hpPct(x.r.min, x.r.hp)}～${hpPct(x.r.max, x.r.hp)}%，${koText(x.r.ko).text}`);
    });
    if (has('fake-out')) lines.push(`${btMvPri('fake-out')}：上場後第一回合讓我方一隻不能動，${name(Q)}可以放心出招`);
    ['follow-me', 'rage-powder'].filter(has).forEach(k => lines.push(`${btMvPri(k)}：我方打單一目標的招會被引到${name(P)}身上，打不到${name(Q)}${k === 'rage-powder' ? '（草屬性不受影響）' : ''}`));
    if (!lines.length) return '';
    const kos = on.map(M => { const d = duel(M, P, f), x = best(d.xy.kos);
      return x && `${name(M)}的${mvName(x.k)} ${koText(x.r.ko).text}・${d.first < 0 ? '同速' : d.first ? `${name(P)}先動` : `${name(M)}先動`}`; }).filter(Boolean);
    return `<div class="bt-sub">${name(P)}配${name(Q)}</div>` + lines.map(t => `<div class="c-sum bad">⚠ ${t}</div>`).join('')
      + `<div class="x-line"><span class="x-msg">先處理${name(P)}：</span><span>${kos.length ? `${kos.join('、')}一下打得倒` : '我方場上這回合一下打不倒牠'}</span></div>`;
  }).join('');
  return blocks ? `<div class="bt-pair"><div class="bt-ph"><b>對手組合</b><span class="meta">${name(alive[0])}＋${name(alive[1])}</span></div>${blocks}</div>` : '';
}
function btResultHTML() {
  const f = { fmt: team.fmt, weather: battle.weather, terrain: battle.terrain, tr: battle.tr };
  const on = side => Array.from({ length: btN() }, (_, p) => btFieldMon(side, p)).filter(Boolean), mine = on('me'), opps = on('opp');
  // 我方場上空著（倒下後換下場）也列換人
  const swap = opps.length ? btSwapHTML(opps, f) : '';
  if (!opps.length || !mine.length && !swap) return '<p class="empty">雙方都有寶可夢上場後，這裡會列出我方每一招打過去的傷害、能不能打倒、誰先動，對手先動又打得倒我方時會警告，後排換上來打不打得贏也會列出來。</p>';
  return `<div class="res-head">場上對位<span class="muted small">（${[FMT_ZH[team.fmt], FIELD_ZH[battle.weather], FIELD_ZH[battle.terrain], battle.tr && '戲法空間',
    ...battle.tw.map(s => s === 'me' ? '我方順風' : '對手順風')].filter(Boolean).join('・')}）</span></div>`
    + btFocusHTML(mine, opps, f) + btComboHTML(mine, opps, f)
    + mine.map(M => opps.map(O => btPairHTML(M, O, f)).join('')).join('') + swap
    + '<p class="note">※ 我方照「隊伍分析」登錄的招式、特性、道具、能力點數與性格算，沒登錄的欄位和對手都照「傷害計算」的預設：'
    + '能力點數與性格用 OP.GG 最常見的（沒有統計的攻擊／特攻 32＋性格、速度 32＋性格、HP／防禦／特防 0）、'
    + '特性用 OP.GG 最常見的（對手的特性可在上方改；超級進化用固定特性）。對手某顆超級石使用率過半的預設是超級進化型態（同「對手可能帶的」），可在「型態」切回。'
    + '對手的道具預設 OP.GG 最常帶的，看到實際道具就在選單改（用掉或被拍落選「沒有道具」）。同一隊不能帶重複的道具：'
    + '標了的先算，沒標的依使用率由高到低分配，同一顆給使用率高的那隻、另一隻改拿牠下一個常帶的；其他對手標了的道具選單也不列。'
    + '按「打中」「實際」時，抗性樹果減半了、氣球被打中、氣勢披帶撐住了、被拍落，挨打那一方就自動標成沒有道具（我方是位置卡的「道具沒了」，也可以自己點）。'
    + '% 是佔對方最大 HP 的比例；「一擊」「二擊」是連用同一招打掉對方剩下的 HP（對手剩下的 % 換算成 HP 時無條件進位），'
    + '不是全滿時氣勢披帶、結實、多重鱗片沒有作用。招式看登錄的，沒登錄的（含對手）看 OP.GG 使用率前 4 招（對手用過的先算，再照使用率補滿 4 招）裡的攻擊招式，依傷害由高到低排。'
    + '先動看實際速度（能力變化、順風 ×2、戲法空間、講究圍巾、天氣／場地加速特性、麻痺 ×½）；同速各 50%，先制招式不看速度。能力變化換下場就清掉，異常狀態不會。'
    + '雙打的範圍招式打到兩隻以上時 ×0.75，對面場上只剩一隻（地震這類連隊友一起打的，隊友也不在）時不減；噴火／噴水以 HP 全滿計。'
    + '灼傷、麻痺在位置卡的「異常狀態」標，牆在下方「我方／對手的牆」標；出場特性（威嚇、開天氣／場地）在位置卡按一下套用；不含幫助與其他隊友效果。'
    + '看場上狀況的特性（「傷害計算」分頁不算，這裡算）：猛火、激流、茂盛、蟲之預感在 HP 剩 1/3 以下時該屬性招式 ×1.5；'
    + '大將照這一方目前倒下幾隻（HP 0 的），每隻威力 +10%（最多 5 隻）；謎擬Ｑ的畫皮還在時第一下沒有傷害、改扣 1/8（位置卡可以標「破了」，'
    + '按「打中」「實際」打到牠也會自動標成破了，之後照一般傷害算）。加速、持久力這類回合中的能力變化請在位置卡自己調。'
    + '「打中」照那一招的平均傷害（最低、最高的平均）扣挨打那一方剩下的 HP（HP 全滿時氣勢披帶、結實撐住剩 1），實際扣多少看遊戲畫面再拉 HP 調整。'
    + '打了才知道：「實際」填遊戲裡打完剩下多少（我方 HP、對手 %），扣血並和預測比對；「實際：我先動／牠先動」和預測的速度比對。'
    + '對不上時會試對手的其他配置，列出對得上的（依 OP.GG 使用率排，最多 3 個），點「套用」就改成那樣算：'
    + '牠打得比預測痛／輕試會讓那招變痛的道具（屬性強化、力量頭帶／博識眼鏡、生命寶珠、達人帶、寶石）或其他常見點數性格，'
    + '牠比預測耐打／不耐打試那招屬性的抗性樹果或其他常見點數性格，牠比預測快／慢試講究圍巾或其他常見點數性格（同一隊不重複的道具照舊）。'
    + '對手的 % 前後各差 1% 內都算對得上；比預測痛時會先看急所（×1.5，不計攻擊方的能力下降、防守方的能力上升）對不對得上，'
    + '遊戲顯示這下是急所就不用改配置；能力變化、特性、場地沒標也會讓結果不同。'
    + '換人：後排（這場帶的、不在場上、還沒倒下）換上來對上場上每隻對手，算法同「出戰選角」的對位表：✔＝換上來先吃牠最痛的一招還打得贏、'
    + '贏＝正面打得贏（場上的倒下後再補上，不用先吃一下）、⚠＝打不贏又會被牠先動一下打倒、✘＝其他打不贏的；'
    + '我方用目前剩下的 HP（換上場能力變化歸 0），對手用目前的 HP、能力變化和修正過的招式、道具、點數；換上來的這隻有威嚇就算進對手的攻擊（對手早就在場上，牠的威嚇不再算）。'
    + '「換下…，後排吃…」：場上這隻吃得到牠一擊打倒的招（最痛的 2 招）時，在那組對位下面列後排換上來吃同一招的傷害（換人比出招早，牠按的還是原本那招），'
    + '無傷＝沒有效果、扛得住＝一下打不倒（後面是吃完剩下的 %）、會倒＝有機率一下打倒，依這個順序再依吃得少的排；我方先動又確定一擊打倒牠、牠也沒有先制招式打得倒時不列。'
    + '集火（雙打、對手場上兩隻都還在）：兩隻對手各用打這隻最痛的一招一起打我方同一隻，兩招的亂數相加算倒的機率，最危險的排最上面；'
    + '氣勢披帶、結實、多重鱗片、畫皮只擋先打到的那一下，兩種先後都算、取比較容易倒的（不看速度）。守住、看我嘛、我方先打倒其中一隻這些讓牠打不到的情況不算。'
    + '對手組合（雙打、對手場上兩隻都還在）：看對手對位算的那幾招（用過的＋使用率補滿 4 招）裡有沒有搭配隊友的招式。'
    + '順風、戲法空間、天氣／場地招式重算速度，列出用了之後對手哪隻變成比我方哪隻先動（沒有變的不列；天氣場地對傷害的影響按上方天氣、場地按鈕看）；'
    + '幫助重算傷害（×1.5），列出隊友一擊打倒我方的機率變高的招式；擊掌奇襲、看我嘛、憤怒粉只提醒。'
    + '「先處理」列我方場上這回合一下打得倒發動那隻的招式和誰先動；幫助、擊掌奇襲、看我嘛、憤怒粉的先制比一般招式高，這回合先打倒牠也擋不住這回合的效果，'
    + '戲法空間是 −7 先制，一般招式都比牠早。'
    + '特性是變身者的百變怪：在場上的當成已經變身成正對面那隻（雙打是對面另一側的位置；招式、能力照牠的，HP、道具、位置卡的能力變化照百變怪自己的），'
    + '換上來的照變成那隻對手算（連牠目前的能力變化）。'
    + '上方場上對位的「⚠ 先動就打得倒」只要有機率一擊就警告（後面寫機率），換人的 ⚠ 和幾下打倒照出戰選角取機率一半以上的，所以亂數一擊不到一半時只有上方會警告。'
    + '對手按「打中」「實際」的招式會標成用過，也可以在上方「用過的招式」自己點；標滿 4 招就只算這 4 招，沒滿的用使用率高的補滿 4 招。'
    + '下方只列這場會出場的：我方列「這場帶的」（預設照出戰選角第 1 名組合，可以點開改），對手出場過的到了帶出場的隻數（單打 3、雙打 4）就不列其他的。'
    + '「對手出場過的」後面的「猜」照「出戰選角」的「對手可能帶的」：還沒有出場的猜帶法和先發，有出場的就從包含出場過的帶法裡挑第一種，只是參考。</p>';
}
// ----- 推薦出招：照目前場上狀況跑對戰模擬的樹搜尋（同「模擬對戰」的推演，只做單打） -----
// 局面：我方＝這場帶的（btBrought，場上那隻排第一）照登錄的配招、剩下的 HP、異常狀態、道具沒了、畫皮破了；
// 對手＝場上那隻、出場過的照標的（特性、道具、用過的招式、點數性格，同 btUnit），還沒出場的照「猜」（btOppGuess）補滿帶出場的隻數
// （一場只能超級進化一隻、道具不重複照模擬的 simFixGuessed）；場上那隻的能力變化照位置卡；天氣、場地、牆照標的（剩幾回合不知道，當全新 5 回合）；
// 雙方都不是剛上場（擊掌奇襲類不能用）。回傳 { st, notes 不算的東西 } 或 { why 不能算的原因（'' 就是不顯示）}
const BT_REC_ITERS = 3000;
function btSimState() {
  if (team.fmt !== 's') return { why: '推薦出招目前只做單打（模擬對戰只有單打）。' };
  const i0 = battle.me[0], j0 = battle.opp[0];
  if (i0 < 0 || j0 < 0 || !team.mons[i0] || !bring.opp[j0]) return { why: '' };
  const N = BRING_N.s, mine = [i0, ...btBrought().filter(i => i !== i0)].slice(0, N);
  const have = [j0, ...bring.opp.map((k, i) => k && battle.seen[i] && i !== j0 ? i : -1).filter(i => i >= 0)].slice(0, N), g = btOppGuess();
  const c = g?.combos.find(c => have.every(i => c.idx.some(j => g.at[j] === i)));
  const opps = [...have, ...(c ? c.idx.map(j => g.at[j]).filter(i => !have.includes(i)) : [])].slice(0, N);
  const items = btOppItems(), stOf = a => Object.fromEntries(BT_STATS.map(([k], n) => [k, a[n]]));
  const mk = (side, i, s) => {
    const key = btKey(side, i), M = side === 'me'
      ? simMon(key, team.sets[i], battle.noItem[i] || key !== team.mons[i] ? '' : undefined, 0, 's')
      : simMon(key, btOppSet(i, key), items[i], 1, 's');
    if (side === 'opp') M.b = { ...M.b, ab: defAbOf(key, 's', battle.ab[i]) };
    M.hp = side === 'me' ? Math.min(M.max, battle.hp[i] ?? M.max) : Math.ceil(M.max * battle.ohp[i] / 100);
    return Object.assign(M, { status: battle.status[side][i], bust: battle.bust[side][i], slot: i, in: -1,
      out: side === 'me' ? i === i0 || M.hp < M.max : have.includes(i) });
  };
  const st = { sd: [simSide0(mine.map(i => mk('me', i))), simSide0(opps.map(i => mk('opp', i)))], turn: 1, fut: [], idle: 0, log: null,
    wx: battle.weather ? { t: battle.weather, n: 5 } : null, ter: battle.terrain ? { t: battle.terrain, n: 5 } : null };
  BT_SIDES.forEach((side, s) => { st.sd[s].scr = Object.fromEntries(battle.walls[side].map(w => [w, 5])); st.sd[s].mons[0].st = stOf(battle.st[side][0]); });
  simFixGuessed(st);
  st.sd.forEach(x => x.mons.forEach(M => { if (M.hp <= 0) { M.hp = 0; simFaint(st, M); } }));
  // 特性變身者在場上：當成已經變身成對面那隻（同對位的 btFieldMon）
  [0, 1].forEach(s => { const M = simAct(st, s), T = simAct(st, 1 - s); if (M.b.ab === 'imposter' && M.hp > 0 && T.hp > 0) simTransform(st, s, M, T); });
  const notes = [battle.tw.length && '順風', battle.tr && '戲法空間'].filter(Boolean);
  return { st, notes };
}
// 推薦出招的狀態：key＝算的那個局面（局面一樣就不重算）、view＝simView 的結果、busy 背景正在算、fail 背景計算不能用（改成按鈕）
const btRec = { key: null, st: null, why: '', notes: [], view: null, busy: false, fail: false, timer: 0, wk: null, id: 0 };
const btRecBg = () => !btRec.fail && location.protocol !== 'file:' && typeof Worker !== 'undefined';
// 場上狀況改了：在對戰中分頁時重建局面，變了就停一下（BT_REC_DELAY）再交給背景計算；不能用背景計算時等按「算推薦」
const BT_REC_DELAY = 400;
function btRecUpdate() {
  if (curTab !== 'battle') return;
  let r;
  try { r = btSimState(); } catch (err) { console.error(err); r = { why: '推薦出招這個局面算不出來。' }; }
  const key = r.st ? JSON.stringify([r.st, r.notes]) : 'why:' + r.why;
  if (key === btRec.key) return;
  clearTimeout(btRec.timer);
  // id 先加一：還在算的舊局面結果回來時對不上 id，不會蓋掉
  Object.assign(btRec, { key, st: r.st || null, why: r.why || '', notes: r.notes || [], view: null, id: btRec.id + 1 });
  if (r.st && btRecBg()) btRec.timer = setTimeout(btRecRun, BT_REC_DELAY);
  btRecRender();
}
// 交給背景計算：上一個還在算就整個停掉重開（結果用 id 對，舊的不收）
function btRecRun() {
  const id = ++btRec.id, st = btRec.st;
  if (btRec.busy && btRec.wk) { btRec.wk.terminate(); btRec.wk = null; }
  try { btRec.wk ||= new Worker('js/engine/sim-worker.js'); } catch { btRec.fail = true; btRecRender(); return; }
  btRec.wk.onmessage = e => { if (e.data.id !== btRec.id) return; Object.assign(btRec, { busy: false, view: e.data.view }); btRecRender(); };
  btRec.wk.onerror = () => { Object.assign(btRec, { busy: false, fail: true, wk: null }); btRecRender(); };
  btRec.busy = true;
  btRec.wk.postMessage({ view: { id, st, iters: BT_REC_ITERS } });
  btRecRender();
}
// 推薦出招的區塊：我方每個選擇（招式、換誰）照「對手照最穩的出法」時的平均勝率排，★ 是建議出法裡比例最高的（同時出招，比例接近的可以混著出）；
// 下面一行是對手的建議出法；完整的「我方 × 對手」勝率表收在展開裡
function btRecRender() {
  const box = $('#btRec'), r = btRec, v = r.view, pct = x => `${Math.round(x * 100)}%`;
  if (!r.st) { box.innerHTML = r.why ? `<p class="muted small">${r.why}</p>` : ''; return; }
  const head = '<div class="res-head">推薦出招<span class="muted small">（照目前場上狀況往下模擬，對手照最穩的出法）</span></div>';
  const note = '<p class="note">※ 用「模擬對戰」的樹搜尋（往下打約 3000 次）：我方照「隊伍分析」登錄的配招；對手照 OP.GG 常見的配招、上方標的特性道具與用過的招式，'
    + '還沒出場的照「猜」。勝率是對手照牠最穩的出法時我方的平均勝率（模擬次數有限，差 2～3% 內算差不多）；建議出的照比例排在前面，'
    + '同時出招，★ 以外比例也高的可以混著出，免得被猜中。'
    + `天氣、場地、牆當成剛開（5 回合）；撒菱類、對手的 PP 用量不算${r.notes.length ? `；${r.notes.join('、')}模擬不算` : ''}。只是參考。</p>`;
  if (!v) {
    box.innerHTML = head + (btRecBg() ? '<p class="muted small">計算中…（約 2～5 秒）</p>'
      : '<div class="c-f"><button class="btn" data-brec>算推薦</button><span class="muted small">算的時候畫面會停幾秒</span></div>') + note;
    return;
  }
  if (v.phase === 'over') { box.innerHTML = ''; return; }
  const st = r.st, val = (i, j) => v.win[i][j] ?? v.v[i][j];
  // 建議出的（比例 > 0）照比例排在前面，其他照勝率排（樹搜尋次數有限，差 2～3% 內的勝率差不多）
  const rows = v.opts[0].map((o, i) => ({ o, i, w: v.opts[1].reduce((t, _, j) => t + v.p[1][j] * val(i, j), 0), p: v.p[0][i] }))
    .sort((a, b) => b.p - a.p || b.w - a.w);
  const top = Math.max(...v.p[0]), opp = v.opts[1].map((o, j) => ({ o, p: v.p[1][j] })).filter(x => x.p > 0).sort((a, b) => b.p - a.p);
  const list = rows.map(x => `<div class="x-line"><b>${x.p === top ? '★ ' : ''}${simOptZh(x.o, st.sd[0])}</b><span>勝率 ${pct(x.w)}${x.p > 0 && x.p < 1 ? `<span class="meta">（建議比例 ${pct(x.p)}）</span>` : ''}</span></div>`).join('');
  const cls = x => x == null ? '' : x >= 0.6 ? 'm2' : x <= 0.4 ? 'mh' : 'm1';
  const table = `<div class="mwrap cover"><table class="matrix vs"><thead><tr><th class="corner">我方 ↓<br>對手 →</th>`
    + v.opts[1].map((o, j) => `<th>${simOptZh(o, st.sd[1])}<br><span class="meta">${pct(v.p[1][j])}</span></th>`).join('') + '</tr></thead><tbody>'
    + v.opts[0].map((o, i) => `<tr><th>${simOptZh(o, st.sd[0])} <span class="meta">${pct(v.p[0][i])}</span></th>`
      + v.opts[1].map((_, j) => `<td class="${cls(v.win[i][j])}">${v.win[i][j] == null ? '—' : pct(v.win[i][j])}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
  box.innerHTML = head + (v.phase === 'replace' ? '<p class="muted small">有人倒下，選換上誰。</p>' : '') + list
    + `<div class="x-line"><span class="meta">對手可能出</span><span>${opp.map(x => `${simOptZh(x.o, st.sd[1])} ${pct(x.p)}`).join('、') || '—'}</span></div>`
    + `<details class="b-more"><summary>完整表格（我方每個選擇 × 對手每個選擇的勝率）</summary>${table}</details>` + note;
}
$('#btRec').addEventListener('click', e => {
  if (!e.target.closest('[data-brec]') || !btRec.st) return;
  $('#btRec').querySelector('[data-brec]').disabled = true;
  setTimeout(() => { btRec.view = simView(simCtx('s'), btRec.st, BT_REC_ITERS); btRecRender(); });
});
function renderBattle() {
  syncBattle();
  BT_SIDES.forEach(side => { $('#bt-' + side).innerHTML = btSideHTML(side); });
  document.querySelectorAll('#p-battle [data-bab]').forEach(s => { s.disabled = s.options.length < 2; });
  $('#btW').innerHTML = [['', '無天氣'], ...WEATHERS.map(w => [w, FIELD_ZH[w]])].map(([w, zh]) => `<button data-bw="${w}" aria-pressed="${battle.weather === w}">${zh}</button>`).join('');
  $('#btT').innerHTML = [['', '無場地'], ...TERRAINS.map(t => [t, FIELD_ZH[t]])].map(([t, zh]) => `<button data-bf="${t}" aria-pressed="${battle.terrain === t}">${zh}</button>`).join('');
  BT_SIDES.forEach(side => { $(side === 'me' ? '#btWallMe' : '#btWallOpp').innerHTML = `<span class="meta seg-l">${side === 'me' ? '我方' : '對手'}的牆</span>`
    + BT_WALLS.map(w => `<button data-bwall="${side}" data-k="${w}" aria-pressed="${battle.walls[side].includes(w)}">${MOVES[w]?.[0] || w}</button>`).join(''); });
  $('#btTR').checked = battle.tr;
  document.querySelectorAll('[data-btw]').forEach(c => { c.checked = battle.tw.includes(c.dataset.btw); });
  document.querySelectorAll('#btFmt button').forEach(b => b.setAttribute('aria-pressed', b.dataset.fmt === team.fmt));
  $('#btResult').innerHTML = btResultHTML();
  btRecUpdate();
  saveState();
}
// 放上場：放進選中的位置（原本在別的位置就移過來），那個位置的能力變化清掉，再跳到下一個空位置；已在場上就只選中牠的位置。對手放上場就標出場過。
// 雙打時選中的位置上還站著、另一個位置空著或倒下了，就放進空著／倒下的那個（倒下後要先補位；選中的位置常停在剛放好的那格）
function btPut(side, i) {
  const n = btN(), at = battle[side].indexOf(i);
  if (side === 'opp') battle.seen[i] = true;
  if (at >= 0 && at < n) { battle.sel[side] = at; return; }
  const down = q => { const j = battle[side][q]; return j < 0 || (side === 'me' ? battle.hp[j] === 0 : battle.ohp[j] === 0); };
  let p = Math.min(battle.sel[side], n - 1);
  if (!down(p)) { const q = Array.from({ length: n }, (_, k) => k).find(down); if (q != null) p = q; }
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
    battle.form[side][+i] = d.k === btKey0(side, +i) ? '' : d.k;
    if (side === 'opp' && MON[d.k].base) battle.item[+i] = '';
  }
  // 異常狀態、我方道具沒了、畫皮破了、牆：點一下切換
  else if (d.bstat) { const [side, i] = d.bstat.split('.'); battle.status[side][+i] = d.v; }
  else if (d.bnoitem != null) battle.noItem[+d.bnoitem] = !battle.noItem[+d.bnoitem];
  else if (d.bbust) { const [side, i] = d.bbust.split('.'); battle.bust[side][+i] = !battle.bust[side][+i]; }
  else if (d.bwall) { const w = battle.walls[d.bwall]; battle.walls[d.bwall] = w.includes(d.k) ? w.filter(x => x !== d.k) : [...w, d.k]; }
  // 威嚇：對面場上每隻照特性改攻擊（intimidateOn；不吃威嚇的不改）
  else if (d.bintim) {
    const foe = d.bintim === 'me' ? 'opp' : 'me';
    for (let p = 0; p < btN(); p++) {
      const F = btMon(foe, p), e = F && intimidateOn(F.ab), s = battle.st[foe][p];
      if (e) [s[0], s[2]] = [Math.max(-6, Math.min(6, s[0] + e[0])), Math.max(-6, Math.min(6, s[2] + e[1]))];
    }
  }
  else if (d.bw != null) battle.weather = d.bw;
  else if (d.bf != null) battle.terrain = d.bf;
  // 這場帶的／對手出場過的：點一下加入或拿掉（我方第一次改時從目前照出戰選角的名單開始改）
  else if (d.bpick === 'me') { const i = +d.i, b = btBrought(); battle.bring = b.includes(i) ? b.filter(j => j !== i) : [...b, i].sort((x, y) => x - y); }
  else if (d.bpick === 'opp') battle.seen[+d.i] = !battle.seen[+d.i];
  else if (d.bpick0 != null) battle.bring = null;
  // 打中：照平均傷害扣挨打那一方剩下的 HP（data-end：HP 全滿時氣勢披帶、結實撐住剩 1）；對手的招式標成用過
  else if (d.bhit) {
    const [side, s] = d.bhit.split('.'), i = +s, key = btKey(side, i);
    const H = hpOf(side === 'me' ? battler(key, team.fmt, team.sets[i]) : battler(key, team.fmt, btOppSet(i, key)));
    const cur = side === 'me' ? Math.min(H, battle.hp[i] ?? H) : Math.ceil(H * battle.ohp[i] / 100);
    const v = Math.max(cur === H && d.end != null ? 1 : 0, cur - +d.dmg), eat = b.closest('.bt-mv')?.dataset.eat;
    if (side === 'me') battle.hp[i] = v >= H ? null : v;
    else battle.ohp[i] = v ? Math.max(1, Math.round(v * 100 / H)) : 0;
    if (eat === '1' || (eat === 'sash' && cur === H && cur - +d.dmg <= 0)) btItemGone(side, i);
    if (b.closest('.bt-mv')?.dataset.bust != null) battle.bust[side][i] = true;
    btMarkUsed(b.closest('.bt-mv'));
  }
  // 實際誰先動：和預測比對，結果顯示在那組對位
  else if (d.bobs) {
    const [mi, oi] = d.bobs.split('.').map(Number), M = btAt('me', mi), O = btAt('opp', oi);
    if (M && O) btObs = { pair: d.bobs, html: btSpeedObs(M, O, btField(), d.who === 'opp') };
  }
  // 實際傷害：點「實際」打開這一列的輸入欄（再點一次收起），填好按「確定」扣血、比對，對手的招式標成用過
  else if (d.bact) { btEdit = btEdit === d.bact ? null : d.bact; renderBattle(); document.querySelector('#btResult [data-bactv]')?.select(); return; }
  else if (d.bactok) {
    const [pair, dir, k] = d.bactok.split('|'), [mi, oi] = pair.split('.').map(Number), M = btAt('me', mi), O = btAt('opp', oi);
    const inp = b.closest('.bt-act')?.querySelector('[data-bactv]'), v = Math.round(Number(inp?.value));
    if (!M || !O || !inp || inp.value === '' || !Number.isFinite(v)) return;
    const after = Math.max(0, Math.min(dir === 'xy' ? 100 : M.H, v)), T = dir === 'xy' ? O : M, eat = b.closest('.bt-mv')?.dataset.eat;
    btObs = { pair, html: btDmgObs(M, O, btField(), dir, k, after) };
    if (dir === 'xy') battle.ohp[oi] = after; else battle.hp[mi] = after >= M.H ? null : after;
    // 道具沒了（同「打中」）：氣勢披帶要全滿時被打到剩 1（對手剩 1% 以下）才算撐住
    if (eat === '1' || (eat === 'sash' && T.cur >= T.H && after > 0 && after <= 1)) btItemGone(dir === 'xy' ? 'opp' : 'me', T.i);
    if (b.closest('.bt-mv')?.dataset.bust != null) battle.bust[dir === 'xy' ? 'opp' : 'me'][T.i] = true;
    btMarkUsed(b.closest('.bt-mv'));
    btEdit = null;
  }
  // 套用反推出來的配置：道具（'-'＝沒有道具）、能力點數與性格
  else if (d.bfix) {
    const i = +d.bfix;
    if (d.item != null) battle.item[i] = d.item;
    if (d.sp) battle.osp[i] = { sp: d.sp.split('+').map(Number), nat: d.nat.split('+').map(Number) };
    btObs = null;
  }
  // 對手用過的招式：點一下標用過／取消（最多 4 招）
  else if (d.bused != null) {
    const u = battle.used[+d.bused];
    battle.used[+d.bused] = u.includes(d.k) ? u.filter(k => k !== d.k) : u.length < 4 ? [...u, d.k] : u;
  }
  else return;
  renderBattle();
});
// 場地（duel 的 f）
const btField = () => ({ fmt: team.fmt, weather: battle.weather, terrain: battle.terrain, tr: battle.tr });
// 格子 i 的道具沒了（樹果、氣球、氣勢披帶用掉，或被拍落）：我方標 noItem、對手標「沒有道具」
const btItemGone = (side, i) => { if (side === 'me') battle.noItem[i] = true; else battle.item[i] = '-'; };
// 對手打我方的那一列（dir yx）：那一招標成對手用過（最多 4 招）
function btMarkUsed(row) {
  if (row?.dataset.dir !== 'yx') return;
  const i = +row.dataset.pair.split('.')[1], u = battle.used[i];
  if (!u.includes(row.dataset.k) && u.length < 4) battle.used[i] = [...u, row.dataset.k];
}
// 「實際」的輸入欄按 Enter 等於按「確定」
$('#p-battle').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.bactv != null) { e.preventDefault(); e.target.closest('.bt-act').querySelector('[data-bactok]').click(); }
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
  btRecUpdate();
  saveState();
});
// 離開 HP 欄位時只把那一列改回實際存的值（清空或超出範圍時），不整個重畫：打完字直接點按鈕時，按鈕才不會被換掉而沒按到
$('#p-battle').addEventListener('change', e => {
  const t = e.target, d = t.dataset;
  if (d.bhp) { btHpRow(t, d.bhp === 'me' ? battle.hp[+d.i] ?? +t.max : battle.ohp[+d.i], true); return; }
  if (d.bab != null) battle.ab[+d.bab] = t.value;
  else if (d.bitem != null) battle.item[+d.bitem] = t.value;
  // 對手用過的招式（從「其他招式」加）、改能力點數／性格（選回第一項＝照 OP.GG 最常見）
  else if (d.busedAdd != null) { const u = battle.used[+d.busedAdd]; if (t.value && u.length < 4 && !u.includes(t.value)) battle.used[+d.busedAdd] = [...u, t.value]; }
  else if (d.bosp != null || d.bonat != null) {
    const i = +(d.bosp ?? d.bonat), o = { ...battle.osp[i], [d.bosp != null ? 'sp' : 'nat']: t.value ? t.value.split('+').map(Number) : undefined };
    battle.osp[i] = o.sp || o.nat ? o : null;
  }
  else if (t.id === 'btTR') battle.tr = t.checked;
  else if (d.btw) battle.tw = BT_SIDES.filter(s => s === d.btw ? t.checked : battle.tw.includes(s));
  else return;
  renderBattle();
});
$('#btFmt').addEventListener('click', setFmt);
$('#btClear').addEventListener('click', () => { Object.assign(battle, battle0()); btObs = null; btEdit = null; renderBattle(); });

// ---------- 出戰選角 ----------
// opp：對手 6 隻的寶可夢 key
const bring = { opp: ['', '', '', '', '', ''], pick: [] };
// members：[[屬性, 格子索引]...]；opps：[[寶可夢, 格子索引]...]
function bringHTML(members, opps) {
  const { k, lead, alt, oppMegas, setupBy, setups, combos, pick, pairOf } =
    bringPlan(members.map(([s, i]) => ({ defs: s, key: team.mons[i], set: team.sets[i] })), opps.map(([m]) => m), team.fmt);
  const best = combos[0], monOf = j => MON[team.mons[members[j][1]]];
  const name = j => `${members[j][1] + 1} ${slotName(members[j][1])}`;
  const spe = j => monOf(j)?.spe || 0;
  const leads = pick.js;
  const setupText = o => `${opps[o][0].zh}（${setupBy[o].map(([zh, p]) => `${zh} ${p}%`).join('、')}）`;
  const leadInfo = [`${lead === 2 ? '兩隻合起來' : ''}正面打得贏 ${pick.cover}／${opps.length} 隻`,
    lead === 2 && (pick.weak.length ? `共同弱點 ${pick.weak.map(ty => T[ty].zh).join('、')}` : '沒有共同弱點'),
    pick.sup.length && `輔助 ${pick.sup.map(([j, by]) => `${slotName(members[j][1])}（${by.join('、')}）`).join('、')}`,
    setups.length && `強化手壓得住 ${setups.length - pick.loose.length}／${setups.length} 隻`].filter(Boolean);
  const pairText = leadInfo.length ? `（${leadInfo.join('・')}）` : '';
  const pairWarn = (pick.noAtk ? `<span class="who x-msg">⚠ 這組沒有打手，先發${lead === 2 ? '兩隻都是' : '是'}輔助手，對手強化後容易被打穿</span>` : '')
    + (pick.danger.length ? `<span class="who x-msg">⚠ 先發會被先手一擊：${pick.danger.map(o => opps[o][0].zh).join('、')}（對手這隻先發時先換人）</span>` : '')
    + (pick.loose.length ? `<span class="who x-msg">⚠ 先發壓不住的強化手：${pick.loose.map(setupText).join('、')}，留後排或換人處理</span>` : '');
  const evoText = c => c.evo == null ? '' : `<span class="who x-msg">⚠ 一場只能超級進化一隻：進化 ${name(c.evo)}，`
    + `${c.idx.filter(j => alt[j] && j !== c.evo).map(j => MON[monOf(j).base].zh).join('、')}以原型上場（帶超級石但不能進化，等於沒道具）</span>`;
  // 對位表的格子（pairOf，隊員照隊伍分析選的型態）：✔ 換上能扛、贏 正面打得贏、⚠ 會被先手一擊、✘ 打不贏；滑鼠停留看速度與幾下打倒
  const cell = r => r.sw ? ['✔', 'm2'] : r.head ? ['贏', 'm1'] : r.ohko ? ['⚠', 'mh'] : ['✘', 'mh'];
  const ORD = ['先動', '後動'];
  const tip = (r, me, o) => r.type ? `${me}對${opps[o][0].zh}：只看屬性（${r.sw ? '不怕牠又剋得到' : r.head ? '招式剋得到' : '剋不到'}）`
    : [opps[o][0], ...oppMegas[o]].map((m, n) => { const f = r.forms[n];
      return `${me}對${m.zh}：${f.first < 0 ? '同速' : ORD[f.first]}（速度 ${f.spd.join('／')}）・我 ${f.me < 9 ? f.me + ' 下' : '四下打不倒'}、牠 ${f.opp < 9 ? f.opp + ' 下' : '四下打不倒'}`
        + (f.sw ? '・換上來吃一下還打得贏' : f.head ? '・正面打得贏' : f.ohko ? '・牠先動一下打倒我' : ''); }).join('；');
  let t = '<thead><tr><th class="corner">我方 ↓<br>對手 →</th>'
    + opps.map(([m, i], o) => `<th title="${m.zh}${oppMegas[o].length ? `（可能超級進化成${oppMegas[o].map(x => x.zh).join('、')}）` : ''}">`
      + `<span class="tcol"><span class="slot-n">${i + 1}${oppMegas[o].length ? '・超' : ''}</span><span class="duo">`
      + `${m.types.map(id => `<span class="vchip" style="${style(id)}">${T[id].zh}</span>`).join('')}</span>`
      + `<span class="slot-n">${[m.spe, ...oppMegas[o].filter(x => x.spe !== m.spe).map(x => `超${x.spe}`)].join('<br>')}</span></span></th>`).join('')
    + '</tr></thead><tbody>';
  // 挑了寶可夢的隊員，格子可以點：帶到傷害計算算「我方打牠」（只選屬性的隊員沒有能力值，不能點）
  members.forEach((_, j) => {
    const me = team.mons[members[j][1]];
    t += `<tr><th>${best.idx.includes(j) ? '★ ' : ''}${name(j)}${spe(j) ? ` <span class="meta">${spe(j)}</span>` : ''}</th>`
      + opps.map(([op], o) => {
        const r = pairOf(j, o), [v, c] = cell(r), tt = tip(r, me ? MON[me].zh : slotName(members[j][1]), o);
        return `<td class="${c}">${me ? `<button class="vs-go" data-ca="${me}" data-cd="${op.key}" title="${tt}（點一下到傷害計算看細節）">${v}</button>` : `<span title="${tt}">${v}</span>`}</td>`;
      }).join('') + '</tr>';
  });
  return `<div class="res-head">建議出戰<span class="muted small">（${FMT_ZH[team.fmt]}帶 ${k} 隻，共 ${combos.length} 種帶法）</span></div>`
    + (members.length < BRING_N[team.fmt] ? `<p class="muted small b-intro">我方只有 ${members.length} 隻，全部帶上。</p>` : '')
    + '<p class="muted small b-intro">每隻對手看組合裡有沒有人應付得了：有人換上來先吃牠最痛的一招、還打得贏＝有解；'
    + '有人正面對打打得贏（照速度和幾下打倒，見下方對位表）＝半解；都打不贏＝沒解。'
    + '超級石最多帶 1 顆的組合排前面（一場只能超級進化一隻，多帶的那隻等於沒道具），'
    + '再依「沒解」的數量由少到多、「有解」的數量由多到少排序，最後比換上能扛的配對數。'
    + (lead === 2 ? '先發從第 1 名組合裡挑兩隻一起看搭配：至少要有一隻打手（隊伍角色是物攻或特攻輸出；兩隻都是輔助手的排最後），'
      + '再依序比「兩隻合起來正面打得贏的對手數 − 會被先手一擊的對手數」（同分時被一擊的少的優先）、壓不住的強化手少的、'
      + '共同弱點（對手常帶的攻擊屬性裡兩隻都怕的）少的、有沒有先發輔助（順風、戲法空間、擊掌奇襲、跟我來、幫助、威嚇、開天氣／場地等），最後比兩隻的速度種族值。'
      : '先發從第 1 名組合裡挑打手（隊伍角色是物攻或特攻輸出；輔助手排最後），再依序比「正面打得贏的對手數 − 會被先手一擊的對手數」'
      + '（同分時被一擊的少的優先）、壓不住的強化手少的，同數時速度種族值高的優先。')
    + `強化手＝常帶劍舞、詭計、龍之舞這類強化招式（使用率 ${ROLE_PCT}% 以上）的對手；先發有一隻正面打得贏牠，`
    + `或常帶挑釁、再來一次、黑霧、清除之煙、吼叫、吹飛、龍尾、巴投，或特性是純樸，就算壓得住。${lead === 2 ? '輔助後面的 % 是 OP.GG 使用率。' : ''}</p>`
    + combos.slice(0, 3).map((c, r) => `<div class="combo${r ? '' : ' top'}"><span class="rank">${r + 1}</span><b>${c.idx.map(name).join('、')}</b>`
      + `<span class="meta">沒解 ${c.none}・半解 ${opps.length - c.none - c.solved}・有解 ${c.solved}</span>`
      + (r ? '' : `<span class="who">先發：${leads.map(name).join('、')}${pairText}</span>${pairWarn}`) + evoText(c)
      + (c.none ? `<span class="who x-msg">沒解：${c.res.map((x, o) => x.level ? '' : opps[o][0].zh).filter(Boolean).join('、')}</span>` : '')
      + '</div>').join('')
    + `<h3>對位表</h3><div class="mwrap cover"><table class="matrix vs">${t}</tbody></table></div>`
    + '<p class="note">※ ✔＝換上來先吃牠最痛的一招（取最高傷害）、剩下的 HP 對打還打得贏；贏＝正面對打（雙方 HP 全滿）打得贏；'
    + '⚠＝打不贏，而且牠一下就打得倒我、又比我先出手（速度較快、同速或用先制招式），還沒出手就倒；✘＝其他打不贏的。'
    + '「打得贏」＝我連用同一招打倒牠的次數比牠打倒我的少；一樣多時，有先制招式能打倒的一方先出手，不然看實際速度（同速算打不贏），'
    + '四下都打不倒算打不贏。幾下打倒取打倒機率過半的次數（例如亂數一擊 60% 算一下、40% 算兩下）。'
    + '傷害、速度、配招、道具、能力點數的算法同下方「出招表」（我方照登錄的配招，對手照 OP.GG 最常見的）；換上來吃過一下後，氣勢披帶、多重鱗片就沒用了。'
    + '滑鼠停在格子上看誰先動與幾下打倒，點格子帶到「傷害計算」看每一招（按「⇄ 對調」看牠打我方；只選屬性的隊員不能點）。'
    + `只選屬性沒挑寶可夢、或沒有招式統計的，改看屬性：不怕牠${FMT_ZH[team.fmt]}常帶的攻擊又招式剋得到算 ✔、招式剋得到算「贏」（同「隊伍分析」的熱門威脅檢查）。`
    + `對手選一般型態、但 OP.GG 道具統計有 ${ROLE_PCT}% 以上帶超級石的（表頭標「超」，如噴火龍多半帶噴火龍進化石Ｙ），`
    + '要對進化前後每種型態都成立才算（⚠ 任一種成立就標）；各型態的超級石使用率見下方「對手情報」。'
    + '★＝第 1 名組合的成員；名字旁和表頭下方的數字是速度種族值（對手超級進化後速度不同的，下面多一行「超」和進化後的速度）。'
    + '帶幾隻依攻略網站整理的排位規則（單打 6 選 3、雙打 6 選 4），'
    + '一場只能超級進化一隻也是同一來源：有其他帶法時不會帶 2 顆以上超級石；隊上超級進化多到非帶不可時，逐一試只進化其中一隻、'
    + '其他以原型計（帶著超級石，等於沒道具），取結果最好的並標出進化哪隻（對位表的每一列仍是進化後的樣子）。'
    + '不含天氣、場地、能力變化、出場特性（如威嚇）與雙打的隊友配合；雙打的範圍招式以打到兩隻（×0.75）計。</p>'
    + moveTableHTML(members, opps, best, alt, oppMegas);
}
// 出招表：第 1 名組合 best 的每隻（一場只能超級進化一隻，不進化的用原型）對上每隻對手（常帶超級石的另列超級進化後），
// 用 duel 算誰先動、我方最痛的一招、對手打回來最痛的一招；我方有登錄配招的照登錄的算
function moveTableHTML(members, opps, best, alt, oppMegas) {
  const fmt = team.fmt;
  const keyIn = j => { const k = team.mons[members[j][1]]; return k && alt[j] && best.evo != null && j !== best.evo ? MON[k].base : k; };
  const hit = rows => rows.top ? `${mvName(rows.top.k)} ${hpPct(rows.top.r.min, rows.top.r.hp)}～${hpPct(rows.top.r.max, rows.top.r.hp)}%（${koText(rows.top.r.ko).text}）`
    : rows.ok.length ? '招式都沒有效果' : rows.use.length ? '沒有能算傷害的攻擊招式' : '沒有招式資料';
  const forms = opps.flatMap(([m, i], o) => [[m, i, false], ...oppMegas[o].map(x => [x, i, true])]);
  return `<h3>出招表</h3><p class="muted small b-intro">第 1 名組合的每隻對上每隻對手：誰先動、我方最痛的一招、對手打回來最痛的一招（% 是佔對方 HP 的比例）。</p>`
    + forms.map(([m, i, mega]) => {
      const opp = battler(m.key, fmt);
      return `<div class="mrole"><div class="mrole-h"><b>${i + 1} ${m.zh}</b>${chips(m.types)}${mega ? '<span class="meta">超級進化後</span>' : ''}</div>`
        + best.idx.map(j => {
          const k = keyIn(j), slot = members[j][1];
          if (!k) return `<div class="x-line"><b>${slot + 1} ${slotName(slot)}</b><span class="meta">只選屬性，沒有能力值可以算</span></div>`;
          // 不進化而以原型上場的，帶的是自己的超級石（不影響計算），不套最常帶的道具
          const d = duel({ ...battler(k, fmt, team.sets[slot]), ...(k !== team.mons[slot] && { item: '' }) }, opp, { fmt });
          const order = d.first < 0 ? '同速' : d.first ? '後動' : '先動';
          // 帶到傷害計算（不進化而以原型上場的不帶：傷害計算只會對隊上的型態套用登錄配招）
          return `<div class="x-line"><b>${slot + 1} ${MON[k].zh}</b><span class="meta">${order}（${d.spd[0].v}／${d.spd[1].v}）</span>`
            + `<span>我打：${hit(d.xy)}</span><span>牠打：${hit(d.yx)}</span>`
            + (k === team.mons[slot] ? `<button class="mini" data-ca="${k}" data-cd="${m.key}">傷害計算</button>` : '') + '</div>';
        }).join('') + '</div>';
    }).join('')
    + '<p class="note">※ 我方有在「隊伍分析」登錄配招的照登錄的招式、特性、道具、能力點數與性格算；沒登錄的欄位和對手都照「傷害計算」的預設：'
    + '能力點數與性格用 OP.GG 最常見的（沒有統計的攻擊／特攻 32＋性格、速度 32＋性格、HP／防禦／特防 0）、'
    + '道具帶 OP.GG 最常帶的（超級進化帶超級石）、特性用 OP.GG 最常見的（超級進化用固定特性）。'
    + '招式看登錄的或 OP.GG 常用招式裡的攻擊招式，列傷害最高的一招；幾擊＝連續用同一招幾次打倒。'
    + '先動看實際速度（括號是我方／對手的速度；同速各 50%，先制招式不看速度）。不含天氣、場地、能力變化與出場特性（如威嚇、日照）。'
    + '對手常帶超級石的另列「超級進化後」；一場只能超級進化一隻，第 1 名組合裡不進化的隊員以原型計。按「傷害計算」看每一招的細節。</p>';
}
// 對手情報：每隻對手的角色、種族值、帶講究圍巾的比例、常帶攻擊招式（對位表看的就是這些）、常用特性與道具，
// 以及 OP.GG 實戰勝敗裡有沒有我方隊員；點開看常用招式、特性、道具的效果。超級進化沿用原型的統計（同隊伍角色）
function oppInfoHTML(opps) {
  const fz = FMT_ZH[team.fmt], named = team.mons.map((k, i) => k ? i : -1).filter(i => i >= 0);
  const top = (list, dict, n) => list.filter(([k]) => dict[k]).slice(0, n).map(([k, p]) => `<b>${dict[k][0]}</b> ${p}%`).join('・');
  return `<div class="res-head">對手情報<span class="muted small">（依 OP.GG ${fz}統計）</span></div>`
    + opps.map(([m, i]) => {
      const r = roleOf(m.key, team.fmt), real = realHTML(m, named), mg = megaInfo(m, team.fmt);
      const mgOut = mg.filter(x => !x.counted);
      const head = `<div class="mrole"><div class="mrole-h"><b>${i + 1} ${m.zh}</b>${chips(m.types)}${r ? roleTags(r) : ''}`
        + `<span class="meta">${m.rank[team.fmt] ? `#${m.rank[team.fmt]}` : '無排名'}${scarf(m)}${m.base ? `・沿用${MON[m.base].zh}的統計` : ''}</span></div>`
        + statsHTML(m)
        + (mg.length ? `<div class="bst">${mg.length > mgOut.length ? `<span>可能超級進化：${megaText(mg.filter(x => x.counted))}</span>` : ''}`
          + `${mgOut.length ? `<span class="muted">超級石不到 ${ROLE_PCT}%、不算：${megaText(mgOut)}</span>` : ''}</div>` : '');
      const realLine = real ? `<div class="bst">${real}</div>` : '';
      if (!r) return `${head}<div class="bst"><span>${fz}沒有統計資料，對位表看本系</span></div>${realLine}</div>`;
      const abils = [top(r.use.abils.filter(([k]) => !r.mega.includes(k)), ABILS, 2), ...r.mega.map(k => `<b>${ABILS[k][0]}</b> 超級進化後固定`)].filter(Boolean).join('・');
      return head + `<div class="bst"><span>常帶攻擊 <b>${oppAtkText(monUnit(m, team.fmt))}</b></span></div>`
        + `<div class="bst">${abils ? `<span>特性 ${abils}</span>` : ''}${r.use.fixedItem ? megaItemHTML(r.use) : r.use.items.length ? `<span>道具 ${top(r.use.items, ITEMS, 3)}</span>` : ''}</div>`
        + realLine + useDetailsHTML(r) + '</div>';
    }).join('')
    + `<p class="note">※「常帶攻擊」＝同屬性招式使用率加總 ${ROLE_PCT}% 以上的攻擊招式（輔助用、固定傷害、反擊類不算），對位表的「不怕」就是看這些；`
    + '特性列前 2 名、道具列前 3 名（超級進化型態的道具固定是自己的超級石，不看統計），「實戰」同「隊伍分析」熱門威脅檢查的說明。'
    + `「可能超級進化」＝選的是一般型態、但 OP.GG 道具統計有 ${ROLE_PCT}% 以上帶這顆超級石（% 是超級石使用率；沒有道具統計的每種都算），`
    + '對位表會連進化後的屬性一起看；確定牠會進化就直接選超級進化型態。</p>';
}
function renderBring() {
  $('#pOpp').innerHTML = bring.opp.map((k, i) => `<button class="slot" data-i="${i}"${k ? ' title="點一下移除"' : ''}><span class="slot-n">第 ${i + 1} 隻</span>`
    + (k ? `<span class="slot-name">${MON[k].zh}</span>${chips(MON[k].types)}` : '<span class="muted small">空</span>') + '</button>').join('');
  document.querySelectorAll('#pFmt button').forEach(b => b.setAttribute('aria-pressed', b.dataset.fmt === team.fmt));
  renderOppList();
  const members = team.slots.map((s, i) => [s, i]).filter(([s]) => s.length);
  const opps = bring.opp.map((k, i) => [MON[k], i]).filter(([m]) => m);
  $('#pResult').innerHTML = !members.length ? '<p class="empty">先到「隊伍分析」選好我方隊伍。</p>'
    : !opps.length ? '<p class="empty">選好對手的寶可夢後，這裡會建議帶哪幾隻、誰先發，並列出每隻的對位。</p>'
    : bringHTML(members, opps);
  $('#pInfo').innerHTML = opps.length ? oppInfoHTML(opps)
    : '<p class="empty">選好對手的寶可夢後，這裡會列出每隻對手常帶的攻擊招式、特性、道具、種族值，以及實戰對上我方誰常輸／常贏。</p>';
  saveState();
}
// 快速選對手：沒選屬性時列目前排名前 QUICK_N（不含超級進化），有選屬性就全部列出屬性都符合的（monsOfTypes 的順序）；
// 已在對手格子裡的同家族（原型與超級進化）不列
const QUICK_N = 30;
function renderOppList() {
  renderPick($('#pPick'), bring.pick);
  if (!bring.opp.includes('')) { $('#pList').innerHTML = '<p class="muted small">已填滿 6 隻；點上方格子可移除。</p>'; return; }
  const sel = bring.pick, fams = bring.opp.filter(Boolean).map(k => family(MON[k]));
  const list = monsOfTypes(sel, team.fmt).filter(m => !fams.includes(family(m)) && (sel.length || !m.base && m.rank[team.fmt]));
  const shown = sel.length ? list : list.slice(0, QUICK_N);
  $('#pList').innerHTML = (sel.length
    ? `<div class="b-label">有${sel.map(id => T[id].zh).join('＋')}屬性的寶可夢<span class="muted small">共 ${list.length} 隻${list.length ? `，依${FMT_ZH[team.fmt]}排名；點一下加入` : ''}</span></div>`
    : `<div class="b-label">${FMT_ZH[team.fmt]}排名前 ${QUICK_N}<span class="muted small">點一下加入；不在這裡就點上方屬性篩選（選 1～2 個）</span></div>`)
    + (shown.length ? `<div class="qpick">${shown.map(m => `<button data-opp="${m.key}">${m.zh}${chips(m.types)}</button>`).join('')}</div>`
      : '<p class="muted small">名單裡沒有這種屬性組合的寶可夢（已在對手格子裡的同家族不列）。</p>');
}
// 對手依序填進第一個空格，並清掉屬性篩選回到排名清單
function addOpp(key) {
  const i = bring.opp.indexOf('');
  if (i < 0) return;
  bring.opp[i] = key;
  bring.pick = [];
  renderBring();
}
$('#pPick').addEventListener('click', e => {
  const b = e.target.closest('.tbtn');
  if (b) { toggleSel(bring.pick, b.dataset.id, 2); renderOppList(); }
});
$('#pList').addEventListener('click', e => {
  const b = e.target.closest('[data-opp]');
  if (b) addOpp(b.dataset.opp);
});
// 對位表的格子、出招表的「傷害計算」：攻擊方放我方、防守方放對手，切到傷害計算並捲到最上面
$('#pResult').addEventListener('click', e => {
  const b = e.target.closest('[data-ca]');
  if (!b) return;
  setCalcMon('atk', b.dataset.ca);
  setCalcMon('def', b.dataset.cd, true);
  showTab('calc');
  $('#p-calc').scrollIntoView({ block: 'start' });
});
$('#pOpp').addEventListener('click', e => {
  const b = e.target.closest('.slot');
  if (b) { bring.opp[+b.dataset.i] = ''; renderBring(); }
});
$('#pFmt').addEventListener('click', setFmt);
$('#pClear').addEventListener('click', () => { bring.opp = bring.opp.map(() => ''); renderBring(); });

// ---------- 出戰選角 ----------
// opp：對手 6 隻的寶可夢 key
const bring = { opp: ['', '', '', '', '', ''], pick: [] };
// members：[[屬性, 格子索引]...]；opps：[[寶可夢, 格子索引]...]
function bringHTML(members, opps) {
  const { k, lead, units, alt, oppUnits, oppMegas, setupBy, setups, combos, pick } =
    bringPlan(members.map(([s, i]) => ({ defs: s, key: team.mons[i] })), opps.map(([m]) => m), team.fmt);
  const best = combos[0], monOf = j => MON[team.mons[members[j][1]]];
  const name = j => `${members[j][1] + 1} ${slotName(members[j][1])}`;
  const spe = j => monOf(j)?.spe || 0;
  const leads = pick.js;
  const setupText = o => `${opps[o][0].zh}（${setupBy[o].map(([zh, p]) => `${zh} ${p}%`).join('、')}）`;
  const leadInfo = [lead === 2 && `兩隻合起來有解 ${pick.cover}／${opps.length} 隻`,
    lead === 2 && (pick.weak.length ? `共同弱點 ${pick.weak.map(ty => T[ty].zh).join('、')}` : '沒有共同弱點'),
    pick.sup.length && `輔助 ${pick.sup.map(([j, by]) => `${slotName(members[j][1])}（${by.join('、')}）`).join('、')}`,
    setups.length && `強化手壓得住 ${setups.length - pick.loose.length}／${setups.length} 隻`].filter(Boolean);
  const pairText = leadInfo.length ? `（${leadInfo.join('・')}）` : '';
  const pairWarn = (pick.noAtk ? `<span class="who x-msg">⚠ 這組沒有打手，先發${lead === 2 ? '兩隻都是' : '是'}輔助手，對手強化後容易被打穿</span>` : '')
    + (pick.loose.length ? `<span class="who x-msg">⚠ 先發壓不住的強化手：${pick.loose.map(setupText).join('、')}，留後排或換人處理</span>` : '');
  const evoText = c => c.evo == null ? '' : `<span class="who">一場只能超級進化一隻：進化 ${name(c.evo)}，`
    + `${c.idx.filter(j => alt[j] && j !== c.evo).map(j => MON[monOf(j).base].zh).join('、')}以原型上場</span>`;
  const cell = (safe, hit) => safe && hit ? ['✔', 'm2'] : hit ? ['剋', 'm1'] : safe ? ['擋', 'm1'] : ['✘', 'mh'];
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
      + oppUnits.map((u, o) => {
        const r = answerOf([units[j]], u), [v, c] = cell(r.safe.length > 0, r.hit.length > 0), op = opps[o][0];
        return `<td class="${c}">${me ? `<button class="vs-go" data-ca="${me}" data-cd="${op.key}" title="到傷害計算看${MON[me].zh}打${op.zh}">${v}</button>` : v}</td>`;
      }).join('') + '</tr>';
  });
  return `<div class="res-head">建議出戰<span class="muted small">（${FMT_ZH[team.fmt]}帶 ${k} 隻，共 ${combos.length} 種帶法）</span></div>`
    + (members.length < BRING_N[team.fmt] ? `<p class="muted small b-intro">我方只有 ${members.length} 隻，全部帶上。</p>` : '')
    + '<p class="muted small b-intro">依對手裡「沒解」的數量由少到多、「有解」的數量由多到少排序，再比同一隻兩者兼具的配對數。'
    + (lead === 2 ? '先發從第 1 名組合裡挑兩隻一起看搭配：至少要有一隻打手（隊伍角色是物攻或特攻輸出；兩隻都是輔助手的排最後），'
      + '再依序比兩隻合起來有解的對手數、壓不住的強化手少的、共同弱點（對手常帶的攻擊屬性裡兩隻都怕的）少的、'
      + '有沒有先發輔助（順風、戲法空間、擊掌奇襲、跟我來、幫助、威嚇、開天氣／場地等），最後比兩隻的速度種族值。'
      : '先發從第 1 名組合裡挑打手（隊伍角色是物攻或特攻輸出；輔助手排最後），再依序比兩者兼具的對手數、壓不住的強化手少的，'
      + '同數時速度種族值高的優先。')
    + `強化手＝常帶劍舞、詭計、龍之舞這類強化招式（使用率 ${ROLE_PCT}% 以上）的對手；先發有一隻招式剋得到牠，`
    + `或常帶挑釁、再來一次、黑霧、清除之煙、吼叫、吹飛、龍尾、巴投，或特性是純樸，就算壓得住。${lead === 2 ? '輔助後面的 % 是 OP.GG 使用率。' : ''}</p>`
    + combos.slice(0, 3).map((c, r) => `<div class="combo${r ? '' : ' top'}"><span class="rank">${r + 1}</span><b>${c.idx.map(name).join('、')}</b>`
      + `<span class="meta">沒解 ${c.none}・半解 ${opps.length - c.none - c.solved}・有解 ${c.solved}</span>`
      + (r ? '' : `<span class="who">先發：${leads.map(name).join('、')}${pairText}</span>${pairWarn}`) + evoText(c)
      + (c.none ? `<span class="who x-msg">沒解：${c.res.map((x, o) => x.level ? '' : opps[o][0].zh).filter(Boolean).join('、')}</span>` : '')
      + '</div>').join('')
    + `<h3>對位表</h3><div class="mwrap cover"><table class="matrix vs">${t}</tbody></table></div>`
    + '<p class="note">※ ✔＝不怕牠的攻擊、招式又剋得到；剋＝招式剋得到，但會被牠的攻擊剋；擋＝不怕牠的攻擊，但剋不到；✘＝兩者都沒有。'
    + `「剋得到」看我方、「不怕」看對手${FMT_ZH[team.fmt]}常帶的攻擊招式（同屬性招式使用率加總 ${ROLE_PCT}% 以上，判斷方式同「隊伍分析」的熱門威脅檢查；`
    + '對手帶哪些見下方「對手情報」），只選屬性或沒有統計的看本系。'
    + '點格子會帶到「傷害計算」算我方打牠的傷害（按「⇄ 對調」看牠打我方；只選屬性的隊員不能點）。'
    + `對手選一般型態、但 OP.GG 道具統計有 ${ROLE_PCT}% 以上帶超級石的（表頭標「超」，如噴火龍多半帶噴火龍進化石Ｙ），`
    + '「不怕」「剋得到」要對進化前後每種型態都成立才算；各型態的超級石使用率見下方「對手情報」。'
    + '★＝第 1 名組合的成員；名字旁和表頭下方的數字是速度種族值（對手超級進化後速度不同的，下面多一行「超」和進化後的速度）。'
    + '帶幾隻依攻略網站整理的排位規則（單打 6 選 3、雙打 6 選 4），'
    + '一場只能超級進化一隻也是同一來源：組合裡有 2 隻以上超級進化時，逐一試只進化其中一隻、其他以原型的屬性計，取結果最好的並標出進化哪隻'
    + '（對位表的每一列仍是進化後的樣子）。只看屬性、常用攻擊招式與速度種族值，不含特性、道具、能力投資。</p>';
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
        + `<div class="bst">${abils ? `<span>特性 ${abils}</span>` : ''}${r.use.items.length ? `<span>道具 ${top(r.use.items, ITEMS, 3)}</span>` : ''}</div>`
        + realLine + useDetailsHTML(r) + '</div>';
    }).join('')
    + `<p class="note">※「常帶攻擊」＝同屬性招式使用率加總 ${ROLE_PCT}% 以上的攻擊招式（輔助用、固定傷害、反擊類不算），對位表的「不怕」就是看這些；`
    + '特性列前 2 名、道具列前 3 名，「實戰」同「隊伍分析」熱門威脅檢查的說明。'
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
// 對位表的格子：攻擊方放我方、防守方放對手，切到傷害計算並捲到最上面
$('#pResult').addEventListener('click', e => {
  const b = e.target.closest('.vs-go');
  if (!b) return;
  setCalcMon('atk', b.dataset.ca);
  setCalcMon('def', b.dataset.cd);
  showTab('calc');
  $('#p-calc').scrollIntoView({ block: 'start' });
});
$('#pOpp').addEventListener('click', e => {
  const b = e.target.closest('.slot');
  if (b) { bring.opp[+b.dataset.i] = ''; renderBring(); }
});
$('#pFmt').addEventListener('click', setFmt);
$('#pClear').addEventListener('click', () => { bring.opp = bring.opp.map(() => ''); renderBring(); });

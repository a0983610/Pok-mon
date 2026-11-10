// ---------- 配招分析 ----------
const build = { moves: [], types: [], ab: '' };
const BEST_GROUPS = [4, 2, 1, 0.5, 0.25, 0];
// 點選切換；超過上限就換掉最早選的
function toggleSel(list, id, max) {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else { list.push(id); if (list.length > max) list.shift(); }
}
function renderPick(el, sel) {
  el.classList.toggle('has-sel', sel.length > 0);
  el.innerHTML = TYPES.map(t => `<button class="tbtn" data-id="${t.id}" aria-pressed="${sel.includes(t.id)}" style="${style(t.id)}"><b>${t.zh}</b></button>`).join('');
}
// 每招打 18 個單屬性的倍率小表，最後一列是每欄的最佳倍率（最佳那招是本系時乘上 ×1.5 顯示）
function coverTable(moves, types) {
  const sym = { 2: '2', 0.5: '½', 0: '0', 1: '' }, stabSym = { 2: '3', 1: '1.5', 0.5: '¾', 0: '0' };
  const td = (m, stab) => `<td class="${MCLS[m]}" title="${fmt(m)} ${MSG(m)}${stab && m ? '＋本系 ×1.5' : ''}">${(stab ? stabSym : sym)[m]}</td>`;
  let h = '<thead><tr><th class="corner">招式 ↓<br>對手 →</th>'
    + IDS.map(d => `<th><span class="vchip" style="${style(d)}">${T[d].zh}</span></th>`).join('') + '</tr></thead><tbody>';
  moves.forEach(a => {
    h += `<tr><th><span class="chip rchip" style="${style(a)}">${T[a].zh}${types.includes(a) ? '<small>本系</small>' : ''}</span></th>`
      + `${IDS.map(d => td(eff(a, [d]))).join('')}</tr>`;
  });
  h += `<tr class="best"><th>最佳</th>${IDS.map(d => {
    const m = bestEff(moves, [d]);
    return td(m, moves.some(a => types.includes(a) && eff(a, [d]) === m));
  }).join('')}</tr>`;
  return `<div class="mwrap cover"><table class="matrix">${h}</tbody></table></div>`;
}
// 下一招推薦前 5 名，點了直接加入
function recHTML(mv, base2, base1) {
  return `<h3>第 ${mv.length + 1} 招推薦</h3><p class="muted small b-intro">依加入後雙屬性能打出效果絕佳的組合數排序，點一下直接加入。</p><div class="b-rec">`
    + recommendMove(mv).slice(0, 5).map((r, i) => `<button data-add="${r.id}"><span class="rank">${i + 1}</span>${chip(r.id, build.types.includes(r.id) ? '本系' : '')}`
      + `<span>雙屬性 <b>+${r.dual - base2}</b> 種（→ ${Math.round(r.dual / DUALS.length * 100)}%）・單屬性 <b>+${r.single - base1}</b> 種</span></button>`).join('')
    + '</div>';
}
// 特性說明由 mod 組出來，例如「火、冰減半」
const abDesc = a => [[0, '無效'], [0.5, '減半']].map(([v, w]) => {
  const ts = Object.keys(a.mod).filter(t => a.mod[t] === v);
  return ts.length ? ts.map(t => T[t].zh).join('、') + w : '';
}).filter(Boolean).join('，');
$('#bAb').innerHTML = '<option value="">無（不影響屬性倍率）</option>'
  + ABILITIES.map(a => `<option value="${a.id}">${a.zh}（${abDesc(a)}）</option>`).join('');

function renderBuild() {
  renderPick($('#bMoves'), build.moves);
  renderPick($('#bTypes'), build.types);
  $('#bAb').value = build.ab;

  const mv = build.moves;
  if (!mv.length) {
    $('#bCover').innerHTML = '<p class="empty">點選上方「招式屬性」（1～4 個），看這組招式打得到哪些屬性。</p>';
  } else {
    const one = coverage(mv, IDS.map(d => [d])), two = coverage(mv, DUALS);
    const se2 = two[4].length + two[2].length;
    const used = BEST_GROUPS.filter(m => two[m].length);
    const bar = used.map(m => `<span class="${MCLS[m]}" style="flex:${two[m].length}" title="${fmt(m)} ${MSG(m)}：${two[m].length} 種"></span>`).join('');
    // 已能打出效果絕佳的預設收合，打不痛的（涵蓋缺口）預設展開
    const dualRow = m => {
      const list = two[m];
      const body = list.length
        ? `<details class="b-more"${m < 2 ? ' open' : ''}><summary>${list.length} 種</summary><div class="rg-c">`
          + list.map(p => `<span class="duo pair">${p.map(id => chip(id)).join('')}</span>`).join('') + '</div></details>'
        : '<span class="none">（無）</span>';
      return `<div class="rg"><div class="rg-l">${mtag(m)}<span>${MSG(m)}</span></div><div>${body}</div></div>`;
    };
    $('#bCover').innerHTML = `<div class="res-head">${chips(mv)}<span>招式組合的打點涵蓋</span></div>`
      + `<p class="b-sum">單屬性 18 種中 <b>${one[2].length}</b> 種打得出效果絕佳；雙屬性 ${DUALS.length} 種組合中 <b>${se2}</b> 種（${Math.round(se2 / DUALS.length * 100)}%）。</p>`
      + (mv.length < 4 ? recHTML(mv, se2, one[2].length) : '')
      + `<h3>單屬性對手</h3>${coverTable(mv, build.types)}`
      + ATK_GROUPS.map(([m, label]) => groupRow(m, label, one[m].map(([d]) => d))).join('')
      + `<h3>雙屬性對手（${DUALS.length} 種組合）</h3>`
      + `<div class="b-bar" role="img" aria-label="最佳倍率分布：${used.map(m => `${fmt(m)} ${two[m].length} 種`).join('、')}">${bar}</div>`
      + BEST_GROUPS.map(dualRow).join('')
      + '<p class="note">※ 每個對手取這組招式裡倍率最高的那招；「最佳」列遇到本系招式（與自己屬性相同）會顯示乘上 ×1.5 後的倍率。'
      + '雙屬性分布只看屬性倍率，且是理論上的全部組合，實際不一定都有對應寶可夢；不含特性、道具等影響。</p>';
  }

  const ty = build.types, ab = AB[build.ab];
  if (!ty.length) {
    $('#bDef').innerHTML = '<p class="empty">點選上方「我的屬性」（1～2 個），看自己怕被什麼屬性剋。</p>';
  } else {
    const p = defenseProfile(ty, build.ab);
    const std = ty.length === 2 ? DEF_GROUPS : DEF_GROUPS.filter(([m]) => m !== 4 && m !== 0.25);
    // 特性減半可能多出 ×¼、×⅛，有東西才顯示
    const groups = [...DEF_GROUPS, [0.125, '三重抵抗']].filter(g => std.includes(g) || p[g[0]].length).sort((x, y) => y[0] - x[0]);
    $('#bDef').innerHTML = `<div class="res-head">${chips(ty)}<span>我的寶可夢${ab ? `（特性：${ab.zh}）` : ''} 被各屬性招式攻擊時</span></div>`
      + groups.map(([m, label]) => groupRow(m, label, p[m], id => ab && id in ab.mod ? '特性' : '')).join('');
  }
  saveState();
}
$('#bMoves').addEventListener('click', e => {
  const b = e.target.closest('.tbtn');
  if (b) { toggleSel(build.moves, b.dataset.id, 4); renderBuild(); }
});
$('#bTypes').addEventListener('click', e => {
  const b = e.target.closest('.tbtn');
  if (b) { toggleSel(build.types, b.dataset.id, 2); renderBuild(); }
});
$('#bAb').addEventListener('change', e => { build.ab = e.target.value; renderBuild(); });
$('#bCover').addEventListener('click', e => {
  const b = e.target.closest('[data-add]');
  if (b) { toggleSel(build.moves, b.dataset.add, 4); renderBuild(); }
});
$('#bClear').addEventListener('click', () => { build.moves = []; build.types = []; build.ab = ''; renderBuild(); });

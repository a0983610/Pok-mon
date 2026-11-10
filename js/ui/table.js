// ---------- 克制表 ----------
const tbl = $('#matrix');
(function buildMatrix() {
  const sym = { 2: '2', 0.5: '½', 0: '0', 1: '' };
  let h = '<thead><tr><th class="corner">攻擊 ↓<br>防守 →</th>';
  TYPES.forEach((t, j) => { h += `<th class="colh" data-col="${j}" scope="col"><button class="vchip" style="${style(t.id)}" title="${t.zh}（防守）">${t.zh}</button></th>`; });
  h += '</tr></thead><tbody>';
  TYPES.forEach((a, i) => {
    h += `<tr><th class="rowh" data-row="${i}" scope="row"><button class="chip rchip" style="${style(a.id)}" title="${a.zh}（攻擊）">${a.zh}</button></th>`;
    TYPES.forEach((d, j) => { h += `<td class="${MCLS[M[i][j]]}" data-r="${i}" data-c="${j}">${sym[M[i][j]]}</td>`; });
    h += '</tr>';
  });
  tbl.innerHTML = h + '</tbody>';
})();

function clearHL() { tbl.querySelectorAll('.hl, .hl-cell').forEach(el => el.classList.remove('hl', 'hl-cell')); }
function setHL(r, c) {
  clearHL();
  const rows = tbl.tBodies[0].rows;
  if (r != null) for (const cell of rows[r].cells) cell.classList.add('hl');
  if (c != null) {
    for (const row of rows) row.cells[c + 1].classList.add('hl');
    tbl.tHead.rows[0].cells[c + 1].classList.add('hl');
  }
  if (r != null && c != null) rows[r].cells[c + 1].classList.add('hl-cell');
}
function matrixInfo(el) {
  if (el.matches('td')) {
    const r = +el.dataset.r, c = +el.dataset.c, a = IDS[r], d = IDS[c], m = M[r][c];
    setHL(r, c);
    $('#mInfo').innerHTML = `${chip(a)} 招式 → ${chip(d)} 寶可夢：${mtag(m)} <b>${MSG(m)}</b>`;
  } else if (el.matches('th.rowh')) {
    const r = +el.dataset.row, p = attackProfile(IDS[r]);
    setHL(r, null);
    $('#mInfo').innerHTML = `${chip(IDS[r])} 招式：效果絕佳 ${p[2].length} 種、效果不好 ${p[0.5].length} 種、沒有效果 ${p[0].length} 種（點擊看詳細）`;
  } else if (el.matches('th.colh')) {
    const c = +el.dataset.col, p = defenseProfile([IDS[c]]);
    setHL(null, c);
    $('#mInfo').innerHTML = `${chip(IDS[c])} 寶可夢：弱點 ${p[2].length} 種、抵抗 ${p[0.5].length} 種、免疫 ${p[0].length} 種（點擊看詳細）`;
  }
}
tbl.addEventListener('mouseover', e => { const el = e.target.closest('td, th.rowh, th.colh'); if (el) matrixInfo(el); });
tbl.addEventListener('mouseleave', clearHL);
tbl.addEventListener('click', e => {
  const el = e.target.closest('td, th.rowh, th.colh');
  if (!el) return;
  if (el.matches('td')) return matrixInfo(el);
  if (el.matches('th.rowh')) { look.mode = 'atk'; look.atk = IDS[+el.dataset.row]; }
  else { look.mode = 'def'; look.def = [IDS[+el.dataset.col]]; }
  renderLookup();
  showTab('lookup');
});

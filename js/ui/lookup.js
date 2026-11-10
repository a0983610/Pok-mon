// ---------- 快速查詢 ----------
const look = { mode: 'def', def: [], atk: null };
const DEF_GROUPS = [[4, '雙重弱點'], [2, '弱點'], [1, '普通'], [0.5, '抵抗'], [0.25, '雙重抵抗'], [0, '免疫']];
const ATK_GROUPS = [[2, '效果絕佳'], [1, '普通'], [0.5, '效果不好'], [0, '沒有效果']];
const groupRow = (m, label, ids, sub = () => '') => `<div class="rg"><div class="rg-l">${mtag(m)}<span>${label}</span></div>`
  + `<div class="rg-c">${ids.length ? ids.map(id => chip(id, sub(id))).join('') : '<span class="none">（無）</span>'}</div></div>`;

function renderLookup() {
  const def = look.mode === 'def';
  document.querySelectorAll('#lookMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === look.mode));
  $('#lookHint').textContent = def
    ? '選 1～2 個屬性（雙屬性寶可夢選兩個；選第 3 個會換掉最早選的），看什麼屬性的招式打牠最痛。'
    : '選 1 個招式屬性，看它打各屬性寶可夢的效果。';
  const sel = def ? look.def : (look.atk ? [look.atk] : []);
  $('#pick').classList.toggle('has-sel', sel.length > 0);
  $('#pick').innerHTML = TYPES.map(t => `<button class="tbtn" data-id="${t.id}" aria-pressed="${sel.includes(t.id)}" style="${style(t.id)}"><b>${t.zh}</b><small>${t.en}</small></button>`).join('');

  const box = $('#result');
  if (!sel.length) {
    box.innerHTML = `<p class="empty">${def ? '點選上方屬性，看對手怕什麼、不怕什麼。' : '點選上方屬性，看這個招式剋誰、被誰擋。'}</p>`;
  } else if (def) {
    const p = defenseProfile(look.def);
    const groups = look.def.length === 2 ? DEF_GROUPS : DEF_GROUPS.filter(([m]) => m !== 4 && m !== 0.25);
    box.innerHTML = `<div class="res-head">${chips(look.def)}<span>寶可夢 被各屬性招式攻擊時</span></div>`
      + groups.map(([m, label]) => groupRow(m, label, p[m])).join('');
  } else {
    const p = attackProfile(look.atk);
    box.innerHTML = `<div class="res-head">${chip(look.atk)}<span>招式 攻擊各屬性寶可夢時</span></div>`
      + ATK_GROUPS.map(([m, label]) => groupRow(m, label, p[m])).join('');
  }
}
$('#pick').addEventListener('click', e => {
  const b = e.target.closest('.tbtn');
  if (!b) return;
  const id = b.dataset.id;
  if (look.mode === 'def') {
    const i = look.def.indexOf(id);
    if (i >= 0) look.def.splice(i, 1);
    else { look.def.push(id); if (look.def.length > 2) look.def.shift(); }
  } else {
    look.atk = look.atk === id ? null : id;
  }
  renderLookup();
});
$('#lookMode').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (b) { look.mode = b.dataset.mode; renderLookup(); }
});
$('#lookClear').addEventListener('click', () => { look.def = []; look.atk = null; renderLookup(); });

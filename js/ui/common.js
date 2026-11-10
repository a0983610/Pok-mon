// ---------- 畫面共用：選取元素、屬性色塊 ----------
const $ = s => document.querySelector(s);

// 依底色挑對比較高的字色
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
TYPES.forEach(t => {
  const L = lum(t.color);
  t.fg = 1.05 / (L + 0.05) >= (L + 0.05) / 0.06 ? '#ffffff' : '#1a1a1a';
});

const style = id => `--c:${T[id].color};--fg:${T[id].fg}`;
const chip = (id, sub = '') => `<span class="chip" style="${style(id)}">${T[id].zh}${sub ? `<small>${sub}</small>` : ''}</span>`;
const chips = ids => `<span class="duo">${ids.map(id => chip(id)).join('')}</span>`;
const MCLS = { 4: 'm4', 2: 'm2', 1: 'm1', 0.5: 'mh', 0.25: 'mq', 0.125: 'mq', 0: 'm0' };
const mtag = m => `<span class="mtag ${MCLS[m]}">${fmt(m)}</span>`;

// ---------- 分頁 ----------
const TABS = ['table', 'lookup', 'build', 'team', 'bring', 'calc', 'quiz'];
let curTab = 'table';
function showTab(name) {
  curTab = name;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
  TABS.forEach(n => { $('#p-' + n).hidden = n !== name; });
  // 出戰選角沿用隊伍分析的隊伍、傷害計算的快選列出隊伍與對手，切過來時重畫
  if (name === 'bring') renderBring();
  if (name === 'calc') renderCalc();
  saveState();
}
$('.tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});

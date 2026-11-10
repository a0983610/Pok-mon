// ---------- 初始化 ----------
// 網址有帶狀態就用網址的，沒有就用本機上次的
const [startTab, startQ] = location.hash.slice(1).split('?');
let initQ = startQ;
if (initQ == null) { try { initQ = localStorage.getItem(STATE_KEY) || ''; } catch (e) { initQ = ''; } }
loadState(initQ);
renderBuild();
renderTeam();
showTab(TABS.includes(startTab) ? startTab : 'table');

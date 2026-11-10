// ---------- 考試 ----------
const COUNTS = [[10, '10 題'], [20, '20 題'], [30, '30 題'], [0, '無限']];
const SAVE_KEY = 'pkmn-champions-quiz';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { saved = {}; }
const savedKinds = Array.isArray(saved.kinds) ? saved.kinds : Object.keys(KINDS);
$('#qKinds').innerHTML = Object.entries(KINDS).map(([k, v]) =>
  `<label class="pill"><input type="checkbox" value="${k}" ${savedKinds.includes(k) ? 'checked' : ''}><span>${v.label}<small>${v.eg}</small></span></label>`).join('');
$('#qCounts').innerHTML = COUNTS.map(([n, label]) =>
  `<label class="pill"><input type="radio" name="qcount" value="${n}" ${n === (saved.count ?? 10) ? 'checked' : ''}><span>${label}</span></label>`).join('');
if (saved.auto === false) $('#qAuto').checked = false;

const quiz = {};
function showQuiz(view) { ['qSetup', 'qPlay', 'qResult'].forEach(id => { $('#' + id).hidden = id !== view; }); }

function startQuiz(list) {
  const kinds = [...document.querySelectorAll('#qKinds input:checked')].map(i => i.value);
  const count = +document.querySelector('input[name="qcount"]:checked').value;
  const auto = $('#qAuto').checked;
  if (!list && !kinds.length) { $('#qErr').hidden = false; return; }
  $('#qErr').hidden = true;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ kinds, count, auto })); } catch (e) { /* 無痕或封鎖儲存時略過 */ }
  Object.assign(quiz, {
    kinds, auto, list: list || null,
    total: list ? list.length : (count || Infinity),
    idx: 0, done: 0, score: 0, streak: 0, best: 0,
    wrong: [], recent: [], current: null, answered: false, timer: 0, t0: Date.now(),
  });
  showQuiz('qPlay');
  nextQ();
}

function nextQ() {
  clearTimeout(quiz.timer);
  if (quiz.idx >= quiz.total) return showResult();
  let q;
  if (quiz.list) {
    q = quiz.list[quiz.idx];
    if (!isNum(q)) q = { ...q, options: shuffle(q.options) };
  } else {
    q = nextQuestion(quiz.kinds, quiz.recent);
    quiz.recent.push(q.key);
    if (quiz.recent.length > 15) quiz.recent.shift();
  }
  quiz.current = q;
  quiz.answered = false;
  quiz.idx++;
  renderQ();
}
function advance() { if (quiz.answered) nextQ(); }

function promptHTML(q) {
  const kind = q.kind;
  if (kind === 'mult1' || kind === 'mult2') {
    return `<div class="q-flow">${chip(q.atk)}<span>招式</span><span class="q-arrow">➜</span>${chips(q.defs)}<span>寶可夢</span></div>`
      + `<div class="q-ask">傷害倍率是？</div>`;
  }
  if (kind === 'weak') return `<div class="q-ask">下列哪個屬性的招式，對 ${chips(q.defs)} 寶可夢<em>效果絕佳</em>？</div>`;
  if (kind === 'resist') return `<div class="q-ask">下列哪個屬性的招式，對 ${chips(q.defs)} 寶可夢<em>效果不好或沒有效果</em>？</div>`;
  if (kind === 'cover') return `<div class="q-ask">招式組合 ${chips(q.moves)}，對下列哪個屬性的寶可夢<em>打不出效果絕佳</em>？</div>`;
  if (kind === 'count') return `<div class="q-ask">有<em>幾種</em>屬性的招式，對 ${chips(q.defs)} 寶可夢效果絕佳？</div>`;
  return `<div class="q-ask">${chip(q.atk)} 招式，對下列哪個屬性的寶可夢<em>效果絕佳</em>？</div>`;
}
const isMult = q => q.kind === 'mult1' || q.kind === 'mult2';
const isNum = q => isMult(q) || q.kind === 'count';
const ansLabel = (q, v) => isMult(q) ? mtag(v) : q.kind === 'count' ? `<b>${v} 種</b>` : chip(v);

function renderQ() {
  const q = quiz.current;
  $('#qCount').innerHTML = quiz.total === Infinity ? `第 <b>${quiz.idx}</b> 題` : `第 <b>${quiz.idx}</b> / ${quiz.total} 題`;
  $('#qScore').textContent = quiz.score;
  $('#qStreak').textContent = quiz.streak;
  $('#qBar').style.width = quiz.total === Infinity ? '100%' : `${(quiz.idx - 1) / quiz.total * 100}%`;
  $('#qKind').textContent = KINDS[q.kind].label;
  $('#qPrompt').innerHTML = promptHTML(q);
  const opts = $('#qOpts');
  opts.className = `opts n${q.options.length}`;
  opts.innerHTML = q.options.map((v, i) => `<button class="opt" data-i="${i}"><span class="k">${i + 1}</span>`
    + (isMult(q) ? `<span class="v">${fmt(v)}</span><span class="s">${MSG(v)}</span>`
      : q.kind === 'count' ? `<span class="v">${v}</span><span class="s">種</span>` : chip(v)) + '</button>').join('');
  $('#qFb').innerHTML = '';
  $('#qNext').hidden = true;
}

// 解說：列出算法或完整清單；答錯時補上「你選的那個實際是多少」
function explain(q, chosen) {
  let s;
  if (isMult(q)) {
    const parts = q.defs.map(d => `${chip(q.atk)}→${chip(d)} ${mtag(eff(q.atk, [d]))}`);
    s = parts.join('<span class="x-msg">，</span>');
    if (q.defs.length === 2) s += `<span class="x-msg">相乘 ＝</span>${mtag(q.answer)}`;
    s += `<span class="x-msg">${MSG(q.answer)}</span>`;
    return `<div class="x-line">${s}</div>`;
  }
  const sortBy = (ids, f, desc) => ids.slice().sort((x, y) => desc ? f(y) - f(x) : f(x) - f(y));
  if (q.kind === 'hit') {
    const list = IDS.filter(d => eff(q.atk, [d]) >= 2);
    s = `<div class="x-line">${chip(q.atk)}<span class="x-msg">效果絕佳：</span>${list.map(d => chip(d)).join('')}</div>`;
    if (chosen != null && chosen !== q.answer) s += `<div class="x-line"><span class="x-msg">你選的</span>${chip(q.atk)}→${chip(chosen)} ${mtag(eff(q.atk, [chosen]))}</div>`;
    return s;
  }
  if (q.kind === 'cover') {
    const f = d => bestEff(q.moves, [d]);
    s = `<div class="x-line">${chips(q.moves)}<span class="x-msg">打不出效果絕佳：</span>${IDS.filter(d => f(d) < 2).map(d => chip(d, fmt(f(d)))).join('')}</div>`;
    if (chosen != null && chosen !== q.answer) {
      const a = q.moves.find(m => eff(m, [chosen]) >= 2);
      s += `<div class="x-line"><span class="x-msg">你選的</span>${chip(chosen)}<span class="x-msg">可以用</span>${chip(a)}${mtag(eff(a, [chosen]))}</div>`;
    }
    return s;
  }
  if (q.kind === 'count') {
    const f = id => eff(id, q.defs), list = sortBy(IDS.filter(id => f(id) >= 2), f, true);
    return `<div class="x-line"><span class="x-msg">對</span>${chips(q.defs)}<span class="x-msg">效果絕佳 ${list.length} 種：</span>`
      + `${list.length ? list.map(id => chip(id, fmt(f(id)))).join('') : '<span class="x-msg">（無）</span>'}</div>`;
  }
  const f = id => eff(id, q.defs);
  const list = q.kind === 'weak' ? sortBy(IDS.filter(id => f(id) >= 2), f, true) : sortBy(IDS.filter(id => f(id) < 1), f, false);
  const label = q.kind === 'weak' ? '效果絕佳：' : '效果不好／沒有效果：';
  s = `<div class="x-line"><span class="x-msg">對</span>${chips(q.defs)}<span class="x-msg">${label}</span>${list.map(id => chip(id, fmt(f(id)))).join('')}</div>`;
  if (chosen != null && chosen !== q.answer) s += `<div class="x-line"><span class="x-msg">你選的</span>${chip(chosen)}→${chips(q.defs)} ${mtag(f(chosen))}</div>`;
  return s;
}

function answer(i) {
  if (quiz.answered) return;
  const q = quiz.current, chosen = q.options[i], ok = chosen === q.answer;
  quiz.answered = true;
  quiz.done++;
  if (ok) { quiz.score++; quiz.streak++; quiz.best = Math.max(quiz.best, quiz.streak); }
  else { quiz.streak = 0; quiz.wrong.push({ q, chosen }); }
  document.querySelectorAll('#qOpts .opt').forEach((b, j) => {
    b.disabled = true;
    if (q.options[j] === q.answer) b.classList.add('correct');
    else if (j === i) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  $('#qScore').textContent = quiz.score;
  $('#qStreak').textContent = quiz.streak;
  $('#qBar').style.width = quiz.total === Infinity ? '100%' : `${quiz.idx / quiz.total * 100}%`;
  $('#qFb').innerHTML = (ok ? `<div class="fb-title fb-ok">✔ 答對了！</div>` : `<div class="fb-title fb-ng">✘ 答錯了，正確答案是 ${ansLabel(q, q.answer)}</div>`)
    + explain(q, chosen);
  const next = $('#qNext');
  next.textContent = quiz.idx >= quiz.total ? '看結果 ⏎' : '下一題 ⏎';
  next.hidden = false;
  next.focus({ preventScroll: true });
  if (ok && quiz.auto) quiz.timer = setTimeout(advance, 1100);
}

function showResult() {
  clearTimeout(quiz.timer);
  const pct = quiz.done ? Math.round(quiz.score / quiz.done * 100) : 0;
  const sec = Math.round((Date.now() - quiz.t0) / 1000);
  const grade = !quiz.done ? '還沒作答喔' : pct === 100 ? '完美！屬性大師 🏆' : pct >= 80 ? '很強！差一點就滿分' : pct >= 60 ? '不錯，再練練錯題' : '多看幾次克制表再來挑戰';
  $('#rScore').textContent = `${quiz.score} / ${quiz.done}`;
  $('#rMeta').textContent = `正確率 ${pct}% ・ 最高連對 ${quiz.best} ・ 用時 ${Math.floor(sec / 60)} 分 ${sec % 60} 秒 ・ ${grade}`;
  $('#rWrong').hidden = !quiz.wrong.length;
  $('#rReview').innerHTML = quiz.wrong.length
    ? `<h3>錯題回顧（${quiz.wrong.length}）</h3><ol class="rlist">${quiz.wrong.map(({ q, chosen }) =>
        `<li><div class="rv-q"><span class="q-kind" style="margin:0">${KINDS[q.kind].label}</span>${promptHTML(q).replace(/<\/?div[^>]*>/g, ' ')}</div>`
        + `<div class="rv-a">你的答案 ${ansLabel(q, chosen)} ・ 正解 ${ansLabel(q, q.answer)}</div>${explain(q, null)}</li>`).join('')}</ol>`
    : (quiz.done ? '<p class="muted">全部答對，沒有錯題！</p>' : '');
  showQuiz('qResult');
}

$('#qStart').addEventListener('click', () => startQuiz());
$('#qOpts').addEventListener('click', e => { const b = e.target.closest('.opt'); if (b) answer(+b.dataset.i); });
$('#qNext').addEventListener('click', advance);
$('#qQuit').addEventListener('click', showResult);
$('#rAgain').addEventListener('click', () => quiz.list ? startQuiz(shuffle(quiz.list)) : startQuiz());
$('#rWrong').addEventListener('click', () => startQuiz(shuffle(quiz.wrong.map(w => w.q))));
$('#rSetup').addEventListener('click', () => showQuiz('qSetup'));
document.addEventListener('keydown', e => {
  if (curTab !== 'quiz' || $('#qPlay').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[1-6]$/.test(e.key)) {
    const i = +e.key - 1;
    if (!quiz.answered && i < quiz.current.options.length) { e.preventDefault(); answer(i); }
  } else if ((e.key === 'Enter' || e.key === ' ') && quiz.answered) {
    e.preventDefault();
    advance();
  }
});

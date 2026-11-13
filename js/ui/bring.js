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
    pick.syn.good.length && `搭配 ${pick.syn.good.join('、')}`,
    lead === 2 && (pick.weak.length ? `共同弱點 ${pick.weak.map(ty => T[ty].zh).join('、')}` : '沒有共同弱點'),
    pick.sup.length && `輔助 ${pick.sup.map(([j, by]) => `${slotName(members[j][1])}（${by.join('、')}）`).join('、')}`,
    setups.length && `強化手壓得住 ${setups.length - pick.loose.length}／${setups.length} 隻`].filter(Boolean);
  const pairText = leadInfo.length ? `（${leadInfo.join('・')}）` : '';
  const pairWarn = (pick.noAtk ? `<span class="who x-msg">⚠ 這組沒有打手，先發${lead === 2 ? '兩隻都是' : '是'}輔助手，對手強化後容易被打穿</span>` : '')
    + (pick.danger.length ? `<span class="who x-msg">⚠ 先發會被先手一擊：${pick.danger.map(o => opps[o][0].zh).join('、')}（對手這隻先發時先換人）</span>` : '')
    + (pick.syn.bad.length ? `<span class="who x-msg">⚠ 先發搭配：${pick.syn.bad.join('、')}</span>` : '')
    + (pick.loose.length ? `<span class="who x-msg">⚠ 先發壓不住的強化手：${pick.loose.map(setupText).join('、')}，留後排或換人處理</span>` : '');
  // 組合內的搭配（bringCombos 的 syn）：✔ 一起帶才成立的攻擊搭配（提供的 → 受惠的）、⚠ 搭配提醒
  const synText = c => {
    const s = c.syn, nm = n => MON[team.mons[members[s.js[n]][1]]].zh;
    const list = [...s.syn.map(([zh, by, js]) => `✔ ${zh}（${[...new Set(by.map(h => nm(h.j)))].join('、')} → ${js.map(nm).join('、')}）`),
      ...s.warns.map(w => `⚠ ${w.h ? nm(w.h.j) + ' ' : ''}${warnShort(w)}`)];
    return list.length ? `<span class="who">搭配：${list.join('・')}</span>` : '';
  };
  const evoText = c => c.evo == null ? '' : `<span class="who x-msg">⚠ 一場只能超級進化一隻：進化 ${name(c.evo)}，`
    + `${c.idx.filter(j => alt[j] && j !== c.evo).map(j => MON[monOf(j).base].zh).join('、')}以原型上場（帶超級石但不能進化，等於沒道具）</span>`;
  // 對位表的格子（pairOf，隊員照隊伍分析選的型態）：✔ 換上能扛、贏 正面打得贏、⚠ 會被先手一擊、✘ 打不贏；滑鼠停留看速度與幾下打倒。
  // 單打下面加勝率（duelVs 的 p，各型態裡最低的）：✔ 是換上來那場的、其他是正面對打的；還在背景算的不寫
  const cell = r => r.sw ? ['✔', 'm2'] : r.head ? ['贏', 'm1'] : r.ohko ? ['⚠', 'mh'] : ['✘', 'mh'];
  const pc = p => `${Math.round(p * 100)}%`;
  const cellP = r => { const p = r.p && (r.sw ? r.p.sw : r.p.head); return p == null ? '' : `<span class="vs-p">${pc(p)}</span>`; };
  const ORD = ['先動', '後動'];
  // 單打勝率還沒算好時的模擬一場（duelVs 的 sim，simDuel）：正面對打幾回合分出勝負
  const simText = h => h.win ? `第 ${h.turns} 回合打倒牠` : h.tieLose ? '同速，牠先動就輸' : h.res < 0 ? `第 ${h.turns} 回合被打倒` : `打滿 ${h.turns} 回合分不出勝負`;
  const simTip = f => {
    if (!f.p) return '';
    const h = f.p.head != null ? `正面 ${pc(f.p.head)}` : `正面還在算（先打一場：${simText(f.sim.head)}）`;
    const s = f.p.sw != null ? `、換上來 ${pc(f.p.sw)}` : f.sim.sw ? `、換上來還在算（先打一場：${f.sim.sw.win ? '贏' : '輸'}）` : '';
    return `（模擬 ${SIM_DUEL_N} 場的勝率：${h}${s}）`;
  };
  const tip = (r, me, o) => r.type ? `${me}對${opps[o][0].zh}：只看屬性（${r.sw ? '不怕牠又剋得到' : r.head ? '招式剋得到' : '剋不到'}）`
    : [opps[o][0], ...oppMegas[o]].map((m, n) => { const f = r.forms[n];
      return `${me}對${m.zh}：${f.first < 0 ? '同速' : ORD[f.first]}（速度 ${f.spd.join('／')}）・我 ${f.me < 9 ? f.me + ' 下' : '四下打不倒'}、牠 ${f.opp < 9 ? f.opp + ' 下' : '四下打不倒'}`
        + (f.sw ? '・換上來吃一下還打得贏' : f.head ? '・正面打得贏' : f.ohko ? '・牠先動一下打倒我' : '')
        + simTip(f); }).join('；');
  let t = '<thead><tr><th class="corner">我方 ↓<br>對手 →</th>'
    + opps.map(([m, i], o) => `<th title="${m.zh}${oppMegas[o].length ? `（可能超級進化成${oppMegas[o].map(x => x.zh).join('、')}）` : ''}">`
      + `<span class="tcol"><span class="slot-n">${i + 1}${oppMegas[o].length ? '・超' : ''}</span><span class="slot-n">${m.zh}</span><span class="duo">`
      + `${m.types.map(id => `<span class="vchip" style="${style(id)}">${T[id].zh}</span>`).join('')}</span>`
      + `<span class="slot-n">${[m.spe, ...oppMegas[o].filter(x => x.spe !== m.spe).map(x => `超${x.spe}`)].join('<br>')}</span></span></th>`).join('')
    + '</tr></thead><tbody>';
  // 挑了寶可夢的隊員，格子可以點：帶到傷害計算算「我方打牠」（只選屬性的隊員沒有能力值，不能點）
  members.forEach((_, j) => {
    const me = team.mons[members[j][1]];
    t += `<tr><th>${best.idx.includes(j) ? '★ ' : ''}${name(j)}${spe(j) ? ` <span class="meta">${spe(j)}</span>` : ''}</th>`
      + opps.map(([op], o) => {
        const r = pairOf(j, o), [v, c] = cell(r), tt = tip(r, me ? MON[me].zh : slotName(members[j][1]), o);
        return `<td class="${c}">${me ? `<button class="vs-go" data-ca="${me}" data-cd="${op.key}" data-tip="${tt}" title="${tt}（點一下到傷害計算看細節）">${v}${cellP(r)}</button>`
          : `<button class="vs-go" data-tip="${tt}" title="${tt}">${v}</button>`}</td>`;
      }).join('') + '</tr>';
  });
  return `<div class="res-head">建議出戰<span class="muted small">（${FMT_ZH[team.fmt]}帶 ${k} 隻，共 ${combos.length} 種帶法）</span></div>`
    + (members.length < BRING_N[team.fmt] ? `<p class="muted small b-intro">我方只有 ${members.length} 隻，全部帶上。</p>` : '')
    + '<p class="muted small b-intro">每隻對手看組合裡有沒有人應付得了：有人換上來先吃牠最痛的一招、還打得贏＝有解；'
    + `有人正面對打打得贏（單打用對戰模擬 1 對 1 打 ${SIM_DUEL_N} 場、勝率過半，雙打照速度和幾下打倒，見下方對位表）＝半解；都打不贏＝沒解。`
    + '超級石最多帶 1 顆的組合排前面（一場只能超級進化一隻，多帶的那隻等於沒道具），'
    + '再依「沒解」的數量由少到多、「有解」的數量由多到少排序，再比組合內的搭配（一起帶才成立的攻擊搭配，'
    + '如晴天＋靠晴天的、戲法空間＋慢速打手，每個加 1；帶進來的搭配提醒，如靠天氣卻沒帶開天氣的、兩種天氣，每個扣 1），最後比換上能扛的配對數。'
    + (lead === 2 ? '先發從第 1 名組合裡挑兩隻一起看搭配：至少要有一隻打手（隊伍角色是物攻或特攻輸出；兩隻都是輔助手的排最後），'
      + '再依序比「兩隻合起來正面打得贏的對手數 − 會被先手一擊的對手數 ＋ 兩隻一起上場的搭配」'
      + '（搭配：擊掌奇襲＋打手、引誘＋強化手、順風／戲法空間＋慢速打手、開天氣場地＋靠它的各加 1；'
      + '地震、衝浪這類會打到隊友的範圍招式而隊友不免疫、兩隻開不同天氣、順風＋戲法空間各扣 1；這些是對位表沒算進去的效果，'
      + '每個當一隻對手的分量；同分時被一擊的少的、搭配多的優先）、壓不住的強化手少的、'
      + '共同弱點（對手常帶的攻擊屬性裡兩隻都怕的）少的、有沒有先發輔助（順風、戲法空間、擊掌奇襲、跟我來、幫助、威嚇、開天氣／場地等），最後比兩隻的速度種族值。'
      : '先發從第 1 名組合裡挑打手（隊伍角色是物攻或特攻輸出；輔助手排最後），再依序比「正面打得贏的對手數 − 會被先手一擊的對手數」'
      + '（同分時被一擊的少的優先）、壓不住的強化手少的，同數時速度種族值高的優先。')
    + `強化手＝常帶劍舞、詭計、龍之舞這類強化招式（使用率 ${ROLE_PCT}% 以上）的對手；先發有一隻正面打得贏牠，`
    + `或常帶挑釁、再來一次、黑霧、清除之煙、吼叫、吹飛、龍尾、巴投，或特性是純樸，就算壓得住。${lead === 2 ? '輔助後面的 % 是 OP.GG 使用率。' : ''}</p>`
    + combos.slice(0, 3).map((c, r) => `<div class="combo${r ? '' : ' top'}"><span class="rank">${r + 1}</span><b>${c.idx.map(name).join('、')}</b>`
      + `<span class="meta">沒解 ${c.none}・半解 ${opps.length - c.none - c.solved}・有解 ${c.solved}</span>`
      + (r ? '' : `<span class="who">先發：${leads.map(name).join('、')}${pairText}</span>${pairWarn}`) + synText(c) + evoText(c)
      + (c.none ? `<span class="who x-msg">沒解：${c.res.map((x, o) => x.level ? '' : opps[o][0].zh).filter(Boolean).join('、')}</span>` : '')
      + '</div>').join('')
    + (team.fmt === 's' ? `<div id="bSim">${bSimHTML()}</div>` : '')
    + oppGuessHTML()
    + `<h3>對位表</h3>${pBgNote('對位表')}<div class="mwrap cover"><table class="matrix vs">${t}</tbody></table></div><div id="pCellTip"></div>`
    + '<p class="note">※ ✔＝換上來先吃牠最痛的一招（取最高傷害）、剩下的 HP 對打還打得贏；贏＝正面對打（雙方 HP 全滿）打得贏；'
    + '⚠＝打不贏，而且牠一下就打得倒我、又比我先出手（速度較快、同速或用先制招式），還沒出手就倒；✘＝其他打不贏的。'
    + `單打的「打得贏」＝用「模擬對戰」的引擎 1 對 1 打 ${SIM_DUEL_N} 場、勝率過半（剛好一半不算）：傷害亂數、急所、命中、追加效果照機率抽，`
    + '雙方每回合先把這回合各種出法都試算一遍（同「模擬對戰」的往前算一回合），再照算出來的比例抽一種出；變化招式、強化、反作用力、道具回復、換招補刀都算；'
    + '打滿回合分不出勝負的算半場。換上來的從吃過一下剩下的 HP 再打一樣多場（畫皮已揭穿、只有我方的威嚇、牠早就在場上不能用擊掌奇襲），正面打不贏、或吃一下就倒的不打換上來那場。'
    + '格子下面的 % 是勝率（✔ 是換上來那場的，其他是正面對打的；對手會超級進化的取進化前後裡最低的），格子說明有兩場各自的勝率。'
    + '單打排名前 100 的寶可夢照 OP.GG 最常見的配招互打的勝率已經事先算好，登錄了其他配招、或不在前 100 的，打開頁面後在背景算（算好前先照不靠亂數模擬一場的勝負，算好自動更新）。'
    + `亂數照對位決定，同一組每次算出一樣的勝率；${SIM_DUEL_N} 場的勝率大約有 ±${Math.round(50 / Math.sqrt(SIM_DUEL_N))}% 的誤差，接近一半的格子勝負可能跟實際不同。`
    + '雙打的「打得贏」＝我連用同一招打倒牠的次數比牠打倒我的少；一樣多時，有先制招式能打倒的一方先出手，不然看實際速度（同速算打不贏），'
    + '四下都打不倒算打不贏。格子說明的幾下打倒取打倒機率一半以上的次數（例如亂數一擊 60%、50% 算一下，40% 算兩下）；擊掌奇襲、迎頭一擊只有上場第一回合能用，只算一下打倒的。'
    + '傷害、速度、配招、道具、能力點數的算法同下方「出招表」（我方照登錄的配招，對手照 OP.GG 最常見的，招式用使用率前 4 招）；換上來吃過一下後，氣勢披帶、多重鱗片就沒用了。'
    + '滑鼠停在格子上看誰先動與幾下打倒，點格子帶到「傷害計算」看每一招（按「⇄ 對調」看牠打我方；只選屬性的隊員不能帶）；'
    + '手機（沒有滑鼠停留）點格子先在表的下方顯示誰先動與幾下打倒，再按「傷害計算」過去。'
    + `只選屬性沒挑寶可夢、或沒有招式統計的，改看屬性：不怕牠${FMT_ZH[team.fmt]}常帶的攻擊又招式剋得到算 ✔、招式剋得到算「贏」（同「隊伍分析」的熱門威脅檢查）。`
    + `對手選一般型態、但 OP.GG 道具統計有 ${ROLE_PCT}% 以上帶超級石的（表頭標「超」，如噴火龍多半帶噴火龍進化石Ｙ），`
    + '要對進化前後每種型態都成立才算（⚠ 任一種成立就標）；各型態的超級石使用率見下方「對手情報」。'
    + '★＝第 1 名組合的成員；名字旁和表頭下方的數字是速度種族值（對手超級進化後速度不同的，下面多一行「超」和進化後的速度）。'
    + '帶幾隻依攻略網站整理的排位規則（單打 6 選 3、雙打 6 選 4），'
    + '一場只能超級進化一隻也是同一來源：有其他帶法時不會帶 2 顆以上超級石；隊上超級進化多到非帶不可時，逐一試只進化其中一隻、'
    + '其他以原型計（帶著超級石，等於沒道具），取結果最好的並標出進化哪隻（對位表的每一列仍是進化後的樣子）。'
    + '出場特性只算威嚇和變身者：正面對打時雙方都剛出場，各自的威嚇都打對方；換上來吃一下時只有我方剛出場，只算我方的（不吃威嚇的特性如精神力、恆淨之軀不降，不服輸、好勝反而上升）；百變怪變身抄到的威嚇也會發動，變身前被降的會被抄來的能力變化蓋掉（照 Pokémon Showdown）。'
    + '特性是變身者的（百變怪）出場就變成對面那隻：屬性、HP 以外的能力、特性、招式照對面的，HP、道具照自己的（兩隻百變怪互相變身時，後變的失敗，兩邊都只有變身這招）。'
    + '謎擬Ｑ的畫皮有算：雙方剛出場畫皮還在，第一下沒有傷害、改扣 1/8（換上來吃的那一下也被畫皮擋下）。'
    + '出場特性開的天氣、場地有算（日照、降雨、揚沙、降雪、各種場地製造者）：正面對打雙方同時出場，速度快的先開、慢的蓋掉；換上來的那段是我方後出場、蓋掉牠的。'
    + '單打的模擬另外算天氣場地招式（大晴天、求雨、雪景、冷笑話、各種場地招式）與持續回合、沙暴扣血、青草場地回復等效果。'
    + '對位表不含其他出場特性與雙打的隊友配合（隊友配合另外看上方組合與先發的「搭配」）；雙打的範圍招式以打到兩隻（×0.75）計。'
    + `「搭配」的招式看${FMT_ZH[team.fmt]}常用（使用率 ${ROLE_PCT}% 以上，登錄的照登錄），慢速打手＝隊伍角色不是輔助、又不比熱門前 ${THREAT_N} 的一半快；`
    + `會打到隊友的範圍招式：${ALLY_HIT.filter(k => MOVES[k]).map(k => MOVES[k][0]).join('、')}，隊友是那個屬性免疫、或特性是`
    + Object.entries(ALLY_SAFE).map(([ty, ks]) => `${ks.filter(k => ABILS[k]).map(k => ABILS[k][0]).join('／')}（${T[ty].zh}）`).filter(s => !s.startsWith('（')).join('、')
    + `${ITEMS['air-balloon'] ? `，或帶${ITEMS['air-balloon'][0]}（${T.ground.zh}）` : ''}就不算。</p>`
    + moveTableHTML(members, opps, best, alt, oppMegas);
}
// ---------- 用模擬比較帶法（單打 3 對 3）----------
// 候補：出戰選角（只算挑了寶可夢的隊員，同模擬對戰的 simMyPlan）第 1 名組合換三種先發，加上第 2～BSIM_C 名組合（先發照它的挑法 leadOf）；
// 對手：「對手可能帶的」前 BSIM_SC 種帶法（simOppScenarios）。每個候補對每種帶法打 BSIM_K 場，雙方用模擬對戰的「快速」；
// 每場的亂數種子照「對手帶法、第幾場」（simHash），候補之間同一場用同一組亂數，和建議帶法的差值比較準（成對比較，同整隊模擬）。
// 按「開始比較」才算，結果只放記憶體；隊伍、配招、對手改過標「結果是改之前的」。
const BSIM_C = 4, BSIM_SC = 5, BSIM_K = 16, BSIM_OPT = { algo: 'ply1' };
const bSim = { run: null, res: null, draw: 0 };
const bSimSig = () => JSON.stringify([team.fmt, team.mons, team.sets, bring.opp]);
// 候補與對手帶法：{ mine, cands [{ slots 帶的格子（先發排第一）, evo 超級進化的格子, rank 組合排第幾, rec 是不是出戰選角的建議 }], scs }；條件不夠回傳 null
function bSimCands() {
  const mine = simMine(), opps = bring.opp.filter(k => MON[k]);
  if (team.fmt !== 's' || mine.length < BRING_N.s || opps.length < BRING_N.s) return null;
  const plan = bringPlan(mine.map(x => ({ defs: MON[x.key].types, key: x.key, set: x.set })), opps.map(k => MON[k]), 's');
  const slotsOf = (c, lead) => [lead, ...c.idx.filter(j => j !== lead)].map(j => mine[j].slot), evoOf = c => c.evo == null ? -1 : mine[c.evo].slot;
  const top = plan.combos[0], lead0 = plan.pick.js[0];
  const cands = [lead0, ...top.idx.filter(j => j !== lead0)].map((l, n) => ({ slots: slotsOf(top, l), evo: evoOf(top), rank: 1, rec: !n }));
  plan.combos.slice(1, BSIM_C).forEach((c, r) => cands.push({ slots: slotsOf(c, plan.leadOf(c).js[0]), evo: evoOf(c), rank: r + 2, rec: false }));
  return { mine, cands, scs: simOppScenarios(bring.opp, mine.map(x => x.key), 's').slice(0, BSIM_SC) };
}
// 開始：對位勝率（duelVs）還在背景算的先等算完（選角才和上面一樣），再排場次交給背景計算
async function bSimStart() {
  if (bSim.run) return;
  const run = bSim.run = { sig: bSimSig(), C: null, win: [], done: 0, total: 0, wait: true, t0: performance.now(), ctl: null, stop: false };
  bSim.res = null;
  bSimDraw();
  while (pBgLeft()) { if (run.stop) return; await new Promise(r => setTimeout(r, 300)); }
  const C = bSimCands();
  if (!C || run.stop) { bSim.run = null; bSimDraw(); return; }
  const jobs = [];
  C.cands.forEach((c, a) => {
    const my = simMySide(C.mine, c.slots, c.evo, 's');
    C.scs.forEach((sc, r) => { for (let i = 0; i < BSIM_K; i++) jobs.push({ a, k: r * BSIM_K + i, sides: [{ mons: my }, { mons: sc.mons }], seed: simHash(JSON.stringify(['bring', r, i])) }); });
  });
  Object.assign(run, { C, win: C.cands.map(() => ({})), total: jobs.length, wait: false, t0: performance.now() });
  run.ctl = simBatch(jobs, BSIM_OPT, (i, out) => { const j = jobs[i]; run.win[j.a][j.k] = out.res > 0 ? 1 : 0; run.done++; bSimTick(); },
    () => { if (bSim.run === run) { bSim.run = null; bSim.res = run; } bSimDraw(); });
  bSimDraw();
}
function bSimStop() {
  const run = bSim.run;
  if (!run) return;
  run.stop = true;
  if (run.ctl) run.ctl.stop(); else { bSim.run = null; bSim.res = run.C ? run : null; bSimDraw(); }
}
// 打的時候每秒最多重畫一次卡片
function bSimTick() { if (!bSim.draw) bSim.draw = setTimeout(() => { bSim.draw = 0; bSimDraw(); }, 1000); }
function bSimDraw() { const el = curTab === 'bring' && $('#bSim'); if (el) el.innerHTML = bSimHTML(); }
function bSimHTML() {
  const head = '<h3>用模擬比較帶法</h3>';
  if (team.fmt !== 's') return head + '<p class="muted small b-intro">只做單打（模擬對戰只有單打）。</p>';
  const mine = simMine(), nOpp = bring.opp.filter(k => MON[k]).length, n = (BRING_N.s + BSIM_C - 1) * BSIM_SC * BSIM_K, wk = simWkN();
  const ready = mine.length >= BRING_N.s && nOpp >= BRING_N.s, R = bSim.run || bSim.res;
  const btn = bSim.run ? '<button class="btn" data-bsim="stop">停止</button>'
    : `<button class="btn primary" data-bsim="run"${ready ? '' : ' disabled'}>${bSim.res ? '重新比較' : '開始比較'}</button>`;
  const intro = `<p class="muted small b-intro">上面的建議是照 1 對 1 的對位排的；這裡直接用「模擬對戰」打 3 對 3 驗證：第 1 名組合換三種先發，加上第 2～${BSIM_C} 名組合，`
    + `各對「對手可能帶的」前 ${BSIM_SC} 種帶法打 ${BSIM_K} 場（共 ${n} 場，約 ${simEta(TSIM_MS * n / Math.max(1, wk))}${wk ? `，${wk} 個背景計算一起打` : ''}）。</p>`;
  const bar = `<div class="c-f">${btn}${ready ? '' : `<span class="muted small">我方要挑好 ${BRING_N.s} 隻以上寶可夢、對手至少填 ${BRING_N.s} 隻。</span>`}</div>`;
  if (!R) return head + intro + bar;
  if (R.wait) return head + intro + bar + '<p class="muted small b-intro">⏳ 先等上面的對位勝率算好再排帶法…</p>';
  const stale = R.sig !== bSimSig() ? '<p class="x-msg">⚠ 隊伍或對手改過了，下面是改之前的結果，按「重新比較」重算。</p>' : '';
  const prog = bSim.run ? `<p class="muted small b-intro">⏳ 打了 ${R.done}／${R.total} 場${R.done ? `，預估還要 ${simEta((performance.now() - R.t0) / R.done * (R.total - R.done))}` : ''}。</p>`
    : R.stop ? `<p class="muted small b-intro">已停止，只打了 ${R.done} 場。</p>` : '';
  const C = R.C, rate = (a, ks) => (ks || Object.keys(R.win[a])).reduce((s, k) => R.win[a][k] == null ? s : { n: s.n + 1, w: s.w + R.win[a][k] }, { n: 0, w: 0 });
  const nm = slot => MON[team.mons[slot]]?.zh || '';
  const team3 = c => c.slots.map((s, i) => `${s + 1} ${nm(s)}${i ? '' : '（先發）'}`).join('、');
  // 和建議的帶法（第 0 個候補）成對比：兩邊都打完的同一場
  const diff = a => { const ks = Object.keys(R.win[a]).filter(k => R.win[0][k] != null), m = ks.length;
    if (!a || !m) return null;
    const ds = ks.map(k => R.win[a][k] - R.win[0][k]), d = ds.reduce((s, x) => s + x, 0) / m, sd = Math.sqrt(ds.reduce((s, x) => s + (x - d) ** 2, 0) / Math.max(1, m - 1));
    return { d, se: sd / Math.sqrt(m) }; };
  const rows = C.cands.map((c, a) => ({ c, a, ...rate(a), df: diff(a) })).filter(x => x.n).sort((x, y) => y.w / y.n - x.w / x.n);
  if (!rows.length) return head + intro + bar + stale + prog;
  const best = rows[0], sig = x => x.df && Math.abs(x.df.d) > 2 * x.df.se;
  const row = x => `<div class="combo${x === best ? ' top' : ''}"><b>${team3(x.c)}</b><span class="meta">勝率 ${simPctText(x.w, x.n)}（${x.n} 場）`
    + (x.df ? `・比建議 <span class="${sig(x) ? (x.df.d > 0 ? 'ts-up' : 'ts-dn') : ''}">${sig(x) ? (x.df.d > 0 ? '▲' : '▼') : ''}${x.df.d > 0 ? '+' : ''}${Math.round(x.df.d * 1000) / 10}</span>（±${Math.round(x.df.se * 1000) / 10}）` : '')
    + `</span><span class="who">${x.c.rec ? '出戰選角的建議（第 1 名組合與先發）' : `第 ${x.c.rank} 名組合${x.c.rank === 1 ? '、換先發' : ''}`}</span></div>`;
  const recR = rows.find(x => x.c.rec), sum = best.c.rec ? '<div class="c-sum good">模擬下也是出戰選角建議的帶法最好。</div>'
    : sig(best) && best.df.d > 0 ? `<div class="c-sum bad">模擬建議改帶 <b>${team3(best.c)}</b>：勝率比建議的高 ${Math.round(best.df.d * 1000) / 10} 個百分點（超過誤差 2 倍）。</div>`
    : `<div class="c-sum">模擬勝率最高的是 ${team3(best.c)}，但和建議的帶法差在誤差內（${recR ? simPctText(recR.w, recR.n) : '—'} vs ${simPctText(best.w, best.n)}），兩種都可以。</div>`;
  // 每種對手帶法的勝率（候補 × 對手帶法）
  const per = r => Array.from({ length: BSIM_K }, (_, i) => String(r * BSIM_K + i));
  const table = `<div class="mwrap cover"><table class="matrix vs"><thead><tr><th class="corner">我方 ↓<br>對手 →</th>`
    + C.scs.map((sc, r) => `<th>#${sc.rank}<br><span class="meta">${simTeamText(sc.mons)}</span></th>`).join('') + '</tr></thead><tbody>'
    + rows.map(x => `<tr><th>${team3(x.c)}</th>` + C.scs.map((_, r) => { const t = rate(x.a, per(r)); const p = t.n ? t.w / t.n : null;
      return `<td class="${p == null ? '' : p >= 0.6 ? 'm2' : p <= 0.4 ? 'mh' : 'm1'}">${t.n ? simPctText(t.w, t.n) : '—'}</td>`; }).join('') + '</tr>').join('') + '</tbody></table></div>';
  return head + intro + bar + stale + prog + sum + rows.map(row).join('')
    + `<details class="b-more"><summary>每種對手帶法的勝率</summary>${table}</details>`
    + '<p class="note">※ 勝率＝贏的場數／場數（打滿回合的平手不算贏）。「比建議」是和出戰選角建議的帶法在同一批場次（同一組亂數）比的差值，括號是誤差，'
    + '超過誤差 2 倍的標 ▲／▼，其他的差異可能只是運氣。我方照「隊伍分析」登錄的配招，一場只能超級進化一隻；對手照 OP.GG 最常見的配置、道具同一隊不重複、'
    + '超級石使用率過半的當成超級進化（同「模擬對戰」）。只算挑了寶可夢的隊員。結果只存在這個頁面。</p>';
}
// 一種帶法裡超級進化 2 隻以上時只有 c.evo 那隻進化，其他寫原型）
function oppGuessHTML() {
  const g = oppBringPlan(bring.opp, team.mons, team.fmt), head = '<h3>對手可能帶的</h3>';
  if (!g) return head + '<p class="muted small b-intro">我方都只選屬性、沒挑寶可夢，沒有能力值可以替對手算。</p>';
  const nm = c => j => { const m = MON[g.mems[j].key]; return `${g.at[j] + 1} ${(m.base && c.evo != null && j !== c.evo ? MON[m.base] : m).zh}`; };
  return head + '<p class="muted small b-intro">把對手當成也用上面同一套方法選角猜的，只是參考：對手看不到我方的配招，所以我方也照 OP.GG 最常見的配置算'
    + '（只選屬性的隊員不算）；對手選一般型態、但某顆超級石使用率過半的，當成會超級進化（名字寫超級進化型態）。到「對戰中」放上場的對手會標成出場過，再改猜還沒出場的。</p>'
    + g.combos.slice(0, 3).map((c, r) => `<div class="combo"><span class="rank">${r + 1}</span><b>${c.idx.map(nm(c)).join('、')}</b>`
      + (r ? '' : `<span class="who">先發：${g.pick.js.map(nm(c)).join('、')}</span>`) + '</div>').join('');
}
// 出招表：第 1 名組合 best 的每隻（一場只能超級進化一隻，不進化的用原型）對上每隻對手（常帶超級石的另列超級進化後），
// 用 duel 算誰先動、我方最痛的一招、對手打回來最痛的一招；我方有登錄配招的照登錄的算
function moveTableHTML(members, opps, best, alt, oppMegas) {
  const fmt = team.fmt;
  const keyIn = j => { const k = team.mons[members[j][1]]; return k && alt[j] && best.evo != null && j !== best.evo ? MON[k].base : k; };
  const hit = rows => rows.top ? `${mvName(rows.top.k)} ${hpPct(rows.top.r.min, rows.top.r.hp)}～${hpPct(rows.top.r.max, rows.top.r.hp)}%（${koText(rows.top.r.ko).text}`
    + `${rows.top.r.disguise ? `・${abilZh('disguise')}擋下第一下` : ''}）`
    : rows.ok.length ? '招式都沒有效果' : rows.use.length ? '沒有能算傷害的攻擊招式' : '沒有招式資料';
  const forms = opps.flatMap(([m, i], o) => [[m, i, false], ...oppMegas[o].map(x => [x, i, true])]);
  return `<h3>出招表</h3><p class="muted small b-intro">第 1 名組合的每隻對上每隻對手：誰先動、我方最痛的一招、對手打回來最痛的一招（% 是佔對方 HP 的比例）。</p>`
    + forms.map(([m, i, mega]) => {
      const opp = battler(m.key, fmt);
      return `<div class="mrole"><div class="mrole-h"><b>${i + 1} ${m.zh}</b>${chips(m.types)}${mega ? '<span class="meta">超級進化後</span>' : ''}</div>`
        + best.idx.map(j => {
          const k = keyIn(j), slot = members[j][1];
          if (!k) return `<div class="x-line"><b>${slot + 1} ${slotName(slot)}</b><span class="meta">只選屬性，沒有能力值可以算</span></div>`;
          // 不進化而以原型上場的，帶的是自己的超級石（不影響計算），不套最常帶的道具；雙方都剛出場，各自的威嚇打對方（同對位表）；
          // 特性變身者（百變怪）照變成對面那隻算（imposterVs，同對位表）；出場特性開的天氣場地（entryField，同對位表的正面對打）
          const me0 = { ...battler(k, fmt, team.sets[slot]), ...(k !== team.mons[slot] && { item: '' }) };
          const me = imposterVs(me0, opp), op = imposterVs(opp, me);
          // 鏡甲把威嚇反彈回威嚇方（intimReflect）
          const d = duel(intimidated(intimReflect(me, op), op), intimidated(intimReflect(op, me), me), { fmt, ...entryField(me, op) });
          const order = d.first < 0 ? '同速' : d.first ? '後動' : '先動';
          const tf = [me, op].filter(x => x.tfFrom).map(x => `${MON[x.tfFrom].zh}變身成${MON[x.key].zh}`).join('、');
          // 帶到傷害計算（不進化而以原型上場的不帶：傷害計算只會對隊上的型態套用登錄配招）
          return `<div class="x-line"><b>${slot + 1} ${MON[k].zh}</b><span class="meta">${order}（${d.spd[0].v}／${d.spd[1].v}）${tf ? `・${tf}` : ''}</span>`
            + `<span>我打：${hit(d.xy)}</span><span>牠打：${hit(d.yx)}</span>`
            + (k === team.mons[slot] ? `<button class="mini" data-ca="${k}" data-cd="${m.key}">傷害計算</button>` : '') + '</div>';
        }).join('') + '</div>';
    }).join('')
    + '<p class="note">※ 我方有在「隊伍分析」登錄配招的照登錄的招式、特性、道具、能力點數與性格算；沒登錄的欄位和對手都照「傷害計算」的預設：'
    + '能力點數與性格用 OP.GG 最常見的（沒有統計的攻擊／特攻 32＋性格、速度 32＋性格、HP／防禦／特防 0）、'
    + '道具帶 OP.GG 最常帶的（超級進化帶超級石）、特性用 OP.GG 最常見的（超級進化用固定特性）。'
    + '招式看登錄的，沒登錄的（含對手）看 OP.GG 使用率前 4 招（同挑寶可夢時預填的）裡的攻擊招式，列傷害最高的一招；幾擊＝連續用同一招幾次打倒。'
    + '先動看實際速度（括號是我方／對手的速度；同速各 50%，先制招式不看速度）。雙方的威嚇都算（同對位表的正面對打）；謎擬Ｑ的畫皮也算（第一下改扣 1/8，標「畫皮擋下第一下」）；出場特性開的天氣、場地也算（同對位表的正面對打：速度慢的蓋掉快的）；不含其他能力變化與出場特性。'
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
          + `${mgOut.length ? `<span class="muted">超級石不到 ${ROLE_PCT}%、不算：${megaText(mgOut)}</span>` : ''}</div>` : '')
        // 原地切換型態（不用先移除再篩屬性）：確定會進化就改成超級進化型態，選錯了改回原型
        + (mg.length || m.base ? `<div class="bst">${m.base ? `<button class="mini" data-omega="${i}" data-k="${m.base}">改回${MON[m.base].zh}</button>`
          : mg.map(x => `<button class="mini" data-omega="${i}" data-k="${x.mon.key}">確定會進化：改成${x.mon.zh}</button>`).join('')}</div>` : '');
      const realLine = real ? `<div class="bst">${real}</div>` : '';
      if (!r) return `${head}<div class="bst"><span>${fz}沒有統計資料，對位表看本系</span></div>${realLine}</div>`;
      const abils = [top(r.use.abils.filter(([k]) => !r.mega.includes(k)), ABILS, 2), ...r.mega.map(k => `<b>${ABILS[k][0]}</b> 超級進化後固定`)].filter(Boolean).join('・');
      return head + `<div class="bst"><span>常帶攻擊 <b>${oppAtkText(monUnit(m, team.fmt))}</b></span><span>對位算的招式（使用率前 4 招）<b>${top4Text(m.key)}</b></span></div>`
        + `<div class="bst">${abils ? `<span>特性 ${abils}</span>` : ''}${r.use.fixedItem ? megaItemHTML(r.use) : r.use.items.length ? `<span>道具 ${top(r.use.items, ITEMS, 3)}</span>` : ''}</div>`
        + realLine + useDetailsHTML(r) + '</div>';
    }).join('')
    + `<p class="note">※「常帶攻擊」＝同屬性招式使用率加總 ${ROLE_PCT}% 以上的攻擊招式（輔助用、固定傷害、反擊類不算），只選屬性的隊員在對位表看的「不怕」就是這些；`
    + '「對位算的招式」＝對位表、出招表算傷害時替牠算的招式（OP.GG 使用率前 4 招裡的攻擊招式，同挑寶可夢時預填的配招）；'
    + '特性列前 2 名、道具列前 3 名（超級進化型態的道具固定是自己的超級石，不看統計），「實戰」同「隊伍分析」熱門威脅檢查的說明。'
    + `「可能超級進化」＝選的是一般型態、但 OP.GG 道具統計有 ${ROLE_PCT}% 以上帶這顆超級石（% 是超級石使用率；沒有道具統計的每種都算），`
    + '對位表會連進化後的屬性一起看；確定牠會進化就按「改成超級進化」，只看進化後的。</p>';
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
  pBgFlush();
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
// 對位表的格子、出招表的「傷害計算」：攻擊方放我方、防守方放對手，切到傷害計算並捲到最上面。
// 沒有滑鼠停留（手機）時，點對位表的格子先在表下方顯示誰先動與幾下打倒（格子的 title），再按「傷害計算」過去
$('#pResult').addEventListener('click', e => {
  const sb = e.target.closest('[data-bsim]');
  if (sb) { if (sb.dataset.bsim === 'run') bSimStart(); else bSimStop(); return; }
  const cell = e.target.closest('.vs-go');
  if (cell && !matchMedia('(hover: hover)').matches) {
    const d = cell.dataset;
    $('#pCellTip').innerHTML = `<div class="c-sum">${escHTML(d.tip || '')}${d.ca ? `<button class="mini" data-ca="${d.ca}" data-cd="${d.cd}">傷害計算</button>` : ''}</div>`;
    return;
  }
  const b = e.target.closest('[data-ca]');
  if (!b) return;
  setCalcMon('atk', b.dataset.ca);
  setCalcMon('def', b.dataset.cd, true);
  showTab('calc');
  $('#p-calc').scrollIntoView({ block: 'start' });
});
// 對手情報的「改成超級進化／改回原型」：那一格換成另一個型態
$('#pInfo').addEventListener('click', e => {
  const b = e.target.closest('[data-omega]');
  if (b && MON[b.dataset.k]) { bring.opp[+b.dataset.omega] = b.dataset.k; renderBring(); }
});
$('#pOpp').addEventListener('click', e => {
  const b = e.target.closest('.slot');
  if (b) { bring.opp[+b.dataset.i] = ''; renderBring(); }
});
$('#pFmt').addEventListener('click', setFmt);
$('#pClear').addEventListener('click', () => { bring.opp = bring.opp.map(() => ''); renderBring(); });

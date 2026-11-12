# 從 OP.GG 寶可夢冠軍圖鑑頁擷取寶可夢名單（屬性、單打／雙打排名、超級進化原型），
# 再逐隻抓有排名的寶可夢詳細頁，取單打／雙打的常用招式、特性、道具使用率，隊友、勝於、敗於名單，能力點數與性格的使用率，
# 以及招式／特性／道具的中文名與效果（招式另存 PP、命中率、先制、範圍、追加效果、連續攻擊次數、招式標記等），
# 和每隻可學的招式與可能的特性（LEARN；沒人常用的招式／特性另存 LEARN_MOVES／LEARN_ABILS），
# 整個檔重寫到 index.html 旁邊的 mons-data.js。超級進化沒有獨立統計，網頁端沿用原型的；
# 超級進化的特性是固定的，名單頁就有，另外存在名單裡。
# 種族值不太會變，另外寫到 index.html 旁邊的 base-stats.js（不帶日期，資料沒變就不會有 diff）；
# 體重（打草結、踢倒、重磅衝撞、高溫重壓用）OP.GG 沒有，從 Pokémon Showdown 的寶可夢資料（pokedex.json 的 weightkg）補，也寫在 base-stats.js
# （Showdown 的冠軍版 mod 沒有自己的 pokedex，沿用主資料的體重）。
# 寫完後列出這次新出現（舊的 mons-data.js 沒有）、網頁程式（js 資料夾）也還沒提到的招式與特性，提醒特殊效果要另外補程式。
# 用法：python tools/update_mons.py [--stats] [index.html 路徑，預設為 repo 根目錄的 index.html；只用來決定寫到哪個資料夾，不會改 index.html]
#   --stats：只重寫 base-stats.js（OP.GG 名單頁的種族值＋Showdown 的體重，幾秒），不抓詳細頁、不動 mons-data.js
# 有排名的寶可夢約 250 隻要逐頁抓，跑一次約 3～5 分鐘。
import datetime
import json
import os
import re
import sys
import time
import urllib.request

URL = 'https://op.gg/zh-tw/pokemon-champions/pokedex'
DEX_URL = 'https://play.pokemonshowdown.com/data/pokedex.json'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Accept-Language': 'zh-TW,zh;q=0.9',
}
TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
         'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy']
MIN_PCT = 5  # 使用率（四捨五入到整數）低於這個 % 的招式／特性／道具不收
LIST_N = 10  # 隊友／勝於／敗於名單只收前幾隻
SP_N = 6  # 能力點數配法只收前幾種（使用率四捨五入到整數，0% 的不收；配法很分散，不設 MIN_PCT 門檻）
FMTS = ('single', 'double')
# OP.GG 性格的 increased／decreased → 能力索引（1 攻擊、2 防禦、3 特攻、4 特防、5 速度，同網頁的 STAT_ZH）
NAT_STAT = {'attack': 1, 'defense': 2, 'spAttack': 3, 'spDefense': 4, 'speed': 5}
CAT_ZH = {'physical': '物理', 'special': '特殊', 'status': '變化'}


def fetch(url=URL, rsc=False):
    # rsc：帶 RSC 標頭只回 Next.js 的資料串流（比整頁 HTML 小一半），內容和 payload() 解出來的相同
    req = urllib.request.Request(url, headers={**HEADERS, **({'RSC': '1'} if rsc else {})})
    for n in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('utf-8')
        except OSError:
            if n == 2:
                raise
            time.sleep(3)


def payload(html):
    # Next.js 把資料放在 self.__next_f.push([1,"..."]) 的字串常值裡
    parts = []
    for m in re.finditer(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html, re.S):
        parts.append(json.loads(m.group(1)))
    return ''.join(parts)


def grab(txt, key, opener):
    i = txt.index('"%s":%s' % (key, opener)) + len(key) + 3
    depth, in_str, esc = 0, False, False
    for k in range(i, len(txt)):
        c = txt[k]
        if in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c in '[{':
            depth += 1
        elif c in ']}':
            depth -= 1
            if depth == 0:
                return json.loads(txt[i:k + 1])
    raise ValueError('找不到 ' + key)


def clean(s):
    # 遊戲內文字的換行在 OP.GG 變成空白，中文旁邊的空白都拿掉
    return re.sub(r'(?<=[^\x00-\x7f])\s+|\s+(?=[^\x00-\x7f])', '', (s or '').strip())


def detail(key):
    # 一隻寶可夢詳細頁：單打／雙打統計（沒有統計時是 null）、這頁用到的特性、道具與性格對照、全部招式的字典，
    # 以及這隻的資料（pokemon：可學招式 moves、禁用招式 bannedMoves、可能的特性 abilities 等；沒有的話是 {}）
    txt = fetch(URL + '/' + key, rsc=True)
    det = {f: grab(txt, f + 'Detail', '{') if '"%sDetail":{' % f in txt else None for f in FMTS}
    lk = grab(txt, 'lookupData', '{') if '"lookupData":{' in txt else {}
    i = txt.index('"moves":[{"id":1,"key":"pound"')
    j = txt.find('"pokemon":{"id":')
    mon = grab(txt[j:], 'pokemon', '{') if j >= 0 else {}
    return det, lk.get('abilities', []), lk.get('items', []), lk.get('natures', []), grab(txt[i:], 'moves', '['), mon


# OP.GG 招式的 meta／statChanges／moveTraits → 只留有值的欄位（見 mons-data.js 的 MOVES 說明）
def move_extra(m):
    meta, x = m.get('meta') or {}, {}
    if meta.get('ailment') not in (None, 'none'):
        x['ail'] = meta['ailment']
    for k, o in (('ailmentChance', 'ailP'), ('flinchChance', 'fl'), ('critRate', 'cr'), ('drain', 'dr'), ('healing', 'hl'), ('statChance', 'stP')):
        if meta.get(k):
            x[o] = meta[k]
    if meta.get('minHits') is not None or meta.get('maxHits') is not None:
        x['hits'] = [meta.get('minHits'), meta.get('maxHits')]
    if m.get('statChanges'):
        x['st'] = [[c['stat'], c['change']] for c in m['statChanges']]
    tr = [t for t in m.get('moveTraits') or [] if t != 'non-contact']
    if tr:
        x['tr'] = tr
    return x


def move_row(m):
    # 招式一筆：[中文名, 屬性, 分類, 威力, 效果, PP, 命中率, 先制等級, 目標範圍, 其他（move_extra）]
    return [m['name'], m['type'], m['category'], m['power'], clean(m['effect'] or m['description']),
            m.get('pp'), m.get('accuracy'), m.get('priority') or 0, m.get('target'), move_extra(m)]


def usage(det, names):
    # [{id, usagePercent}...] → "key:使用率 key:使用率"（依使用率高到低，低於 MIN_PCT 的不收，對照不到的略過）
    if not det:
        return ''
    return ' '.join('%s:%d' % (names[x['id']], round(x['usagePercent'])) for x in det
                    if round(x['usagePercent']) >= MIN_PCT and x['id'] in names)


def spreads(det):
    # 能力點數配法 [{spread: "02-20-00-00-00-20"（HP-攻擊-防禦-特攻-特防-速度，16 進位）, usagePercent}...]
    # → "2.32.0.0.0.32:使用率 ..."（依使用率高到低取前 SP_N 種；每項超過 32 或合計超過 66 的不收）
    if not det:
        return ''
    out = []
    for x in sorted(det.get('training') or [], key=lambda x: -x['usagePercent']):
        sp = [int(h, 16) for h in x['spread'].split('-')]
        if len(sp) == 6 and max(sp) <= 32 and sum(sp) <= 66 and round(x['usagePercent']) >= 1:
            out.append('%s:%d' % ('.'.join(map(str, sp)), round(x['usagePercent'])))
    return ' '.join(out[:SP_N])


def natures(det, nats):
    # 性格 [{id, usagePercent}...] → "↑能力索引.↓能力索引:使用率 ..."（不加減的寫 0.0；依使用率高到低，0% 的不收，對照不到的略過）
    if not det:
        return ''
    out = []
    for x in sorted(det.get('natures') or [], key=lambda x: -x['usagePercent']):
        n = nats.get(x['id'])
        if n is None or round(x['usagePercent']) < 1:
            continue
        u, d = NAT_STAT.get(n.get('increased')), NAT_STAT.get(n.get('decreased'))
        out.append('%s:%d' % ('%d.%d' % (u, d) if u and d and u != d else '0.0', round(x['usagePercent'])))
    return ' '.join(out)


def ranked(det, sec, sub, known):
    # 隊友（team.ttog，網頁上「隊友」顯示的就是這份）／勝於（win.pokemon）／敗於（lose.pokemon）：
    # 寶可夢 key 以空白分隔，依 OP.GG 的順序取前 LIST_N 隻，名單裡沒有的型態不收
    if not det:
        return ''
    return ' '.join([p['key'] for p in (det.get(sec) or {}).get(sub) or [] if p['key'] in known][:LIST_N])


# OP.GG 的寶可夢 key → Showdown 的 id：地區型態的寫法不同（alolan→alola…）、超級進化在後面（mega-charizard-y→charizardmegay）、
# 母的寫 f（indeedee-female→indeedeef）、公的就是原型、羽色不寫 plumage（squawkabilly-blue-plumage→squawkabillyblue）；寫法對不起來的直接對照（DEX_FIX）
DEX_REGION = {'alolan': 'alola', 'galarian': 'galar', 'hisuian': 'hisui', 'paldean': 'paldea'}
DEX_FIX = {'floette-eternal-flower': 'floetteeternal', 'mega-meowstic': 'meowsticmmega',
           'maushold-family-of-four': 'mausholdfour', 'maushold-family-of-three': 'maushold'}


def dex_id(key):
    alnum = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
    mega = key.startswith('mega-')
    parts = [DEX_REGION.get(p, p) for p in (key[5:] if mega else key).split('-') if p != 'plumage']
    if parts[-1] == 'male':
        parts = parts[:-1]
    elif parts[-1] == 'female':
        parts[-1] = 'f'
    if mega:
        return alnum(''.join(parts[:-1])) + 'mega' + parts[-1] if parts[-1] in ('x', 'y', 'z') else alnum(''.join(parts)) + 'mega'
    return alnum(''.join(parts))


def weights(keys):
    # 寶可夢 key → 體重 kg（Showdown pokedex.json 的 weightkg）。依序試：DEX_FIX、dex_id、
    # Showdown 沒分開的（只差外觀的母的、Showdown 原型的 baseForme 就是這個型態，如 gourgeist-average、toxtricity-amped）用原型的；
    # 都對不上的不收（網頁上看體重的招式就不算），並印出來
    req = urllib.request.Request(DEX_URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        dex = json.loads(r.read().decode('utf-8'))
    out, miss = {}, []
    for key in keys:
        parts, sid = [p for p in key.split('-') if p != 'plumage'], dex_id(key)
        base = re.sub(r'[^a-z0-9]', '', parts[0])
        cands = [DEX_FIX.get(key), sid, sid[:-1] if parts[-1] == 'female' else None,
                 base if len(parts) > 1 and (dex.get(base, {}).get('baseForme') or '').lower() == parts[-1] else None]
        s = next((c for c in cands if c and dex.get(c, {}).get('weightkg')), None)
        if s:
            out[key] = dex[s]['weightkg']
        else:
            miss.append(key)
    if miss:
        print('這些寶可夢在 Showdown 找不到體重（看體重的招式不算）：%r' % miss)
    return out


def stats_js(stats, wts):
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    return ('// 種族值：擷取自 OP.GG 寶可夢冠軍圖鑑（含超級進化）；這個檔由 tools/update_mons.py 產生，勿手改\n'
            '// 寶可夢 key → [HP, 攻擊, 防禦, 特攻, 特防, 速度]\n'
            'const BASE_STATS = {\n%s\n};\n'
            '// 體重 kg（打草結、踢倒、重磅衝撞、高溫重壓用）：OP.GG 沒有，取自 Pokémon Showdown 的 pokedex.json（weightkg）；找不到的不收\n'
            'const WEIGHT_KG = {\n%s\n};\n') % ('\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in stats.items()),
                                              '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in wts.items()))


def section(txt, name):
    # mons-data.js 裡「const <name> = {」或「[」到「};」或「];」之間的各行
    m = re.search(r'^const %s = [\[{]\n(.*?)\n[\]}];' % name, txt, re.S | re.M)
    return m.group(1).split('\n') if m else []


def old_keys(txt):
    # 舊的 mons-data.js 收了哪些招式 key、特性 key（ABILS，加上超級進化名單的特性：沒有說明的不在 ABILS）
    txt = txt.replace('\r\n', '\n')
    keys = lambda name: {re.match(r'"([^"]+)":', l).group(1) for l in section(txt, name) if l.startswith('"')}
    megas = {a for l in section(txt, 'MONS_RAW') for r in [json.loads(l.rstrip(','))] if len(r) > 6 for a in r[6].split('.') if a}
    return keys('MOVES'), keys('ABILS') | megas


def js_words(folder):
    # 網頁程式（folder 底下的 .js）字串裡的詞（含空白分隔的招式清單）與物件 key（如 { levitate: 'ground' }）：
    # 招式／特性 key 出現在這裡＝程式已經有考慮它的效果。只看字串與物件 key，免得 key 剛好和變數名相同（如 endure）被當成提到過
    words = set()
    for root, _, files in os.walk(folder):
        for fn in files:
            if fn.endswith('.js'):
                with open(os.path.join(root, fn), encoding='utf-8') as f:
                    s = f.read()
                for lit in re.findall(r"'[^'\n]*'|\"[^\"\n]*\"|`[^`]*`", s):
                    words.update(re.findall(r'[a-z0-9]+(?:-[a-z0-9]+)*', lit))
                words.update(re.findall(r'[{,]\s*([a-z][a-z0-9]*)\s*:', s))
    return words


def remind(old_txt, js_dir, mv_out, ab_out, mega_a):
    # 印出這次新出現（舊的 mons-data.js 沒有）、網頁程式也還沒提到的招式與特性：網頁只會照威力、屬性、分類算，
    # 先制、範圍、連續攻擊、特性效果這類特殊效果要另外補程式。下次更新時它們就算舊的了，只會列這一次
    if old_txt is None:
        print('沒有舊的 mons-data.js 可以比，略過新招式／特性的提醒')
        return
    om, oa = old_keys(old_txt)
    known = js_words(js_dir)
    new_m = sorted(k for k in mv_out if k not in om and k not in known)
    new_a = sorted(k for k in set(ab_out) | {k for ks in mega_a.values() for k in ks} if k not in oa and k not in known)
    if not new_m and not new_a:
        print('沒有新出現、網頁程式還沒提到的招式／特性')
        return
    print('\n【提醒】新出現、網頁程式還沒提到的招式／特性 %d 種（只列這一次，下次更新就算舊的了）：\n'
          '  網頁只照威力、屬性、分類算；先制、範圍、連續攻擊、特性效果等特殊效果要另外補進 js 的清單' % (len(new_m) + len(new_a)))
    for k in new_m:
        zh, _, cat, power, eff = mv_out[k][:5]
        print('  招式 %s %s（%s%s）：%s' % (k, zh, CAT_ZH.get(cat, cat), '' if power is None else '、威力 %s' % power, eff))
    for k in new_a:
        zh, eff = ab_out.get(k, ('', '沒有說明'))
        print('  特性 %s%s：%s' % (k, ' ' + zh if zh else '', eff))


def write_stats(out, stats):
    # 重寫 base-stats.js（種族值＋體重）；換行沿用既有的檔（Windows 上 git 取出來是 CRLF），還不存在就用 LF
    p, s = os.path.join(out, 'base-stats.js'), stats_js(stats, weights(list(stats)))
    if os.path.exists(p):
        with open(p, encoding='utf-8', newline='') as f:
            if f.readline().endswith('\r\n'):
                s = s.replace('\n', '\r\n')
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)
    return s


def main(path, only_stats=False):
    txt = payload(fetch())
    mons = grab(txt, 'pokemon', '[')
    ranks = grab(txt, 'rankings', '{')
    rows, bad, stats = [], [], {}
    for p in mons:
        if not set(p['types']) <= set(TYPES):
            bad.append((p['key'], p['types']))
        base = p.get('base_key') or ''
        rs = ranks['single'].get(p['key']) or ranks['single'].get(base) or 0
        rd = ranks['double'].get(p['key']) or ranks['double'].get(base) or 0
        rows.append([p['key'], p['name'], '.'.join(p['types']), rs, rd, base] + (['.'.join(p.get('abilities') or [])] if base else []))
        st = p['stats']
        stats[p['key']] = [st['hp'], st['attack'], st['defense'], st['spAttack'], st['spDefense'], st['speed']]
    if bad:
        raise SystemExit('有不認得的屬性：%r' % bad)
    # 洗翠型態和原型同名，補上前綴（阿羅拉等其他地區型態 OP.GG 已自帶前綴）
    names = [r[1] for r in rows]
    for r in rows:
        if names.count(r[1]) > 1 and r[0].endswith('-hisui'):
            r[1] = '洗翠' + r[1]
    names = [r[1] for r in rows]
    dup = sorted({n for n in names if names.count(n) > 1})
    if dup:
        raise SystemExit('中文名重複：%r' % dup)
    out = os.path.dirname(os.path.abspath(path))
    if only_stats:
        s = write_stats(out, stats)
        print('只重寫 base-stats.js：種族值 %d 隻、體重 %d 隻' % (len(stats), s.count('\n', s.index('const WEIGHT_KG')) - 2))
        return

    # 常用招式／特性：只抓有排名的非超級進化寶可夢
    targets = [r[0] for r in rows if not r[5] and (r[3] or r[4])]
    use, moves, abils, items, nats, known, learn = {}, {}, {}, {}, {}, {r[0] for r in rows}, {}
    for n, key in enumerate(targets, 1):
        det, ab, it, nt, mv, mon = detail(key)
        moves = moves or {m['id']: m for m in mv}
        learn[key] = mon
        abils.update({a['id']: a for a in ab})
        items.update({x['id']: x for x in it})
        nats.update({x['id']: x for x in nt})
        mid, aid, iid = ({i: x['key'] for i, x in d.items()} for d in (moves, abils, items))
        use[key] = [usage(det[f] and det[f][sec], ids) for sec, ids in (('moves', mid), ('abilities', aid)) for f in FMTS] \
            + [usage(det[f] and det[f].get('items'), iid) for f in FMTS] \
            + [ranked(det[f], sec, sub, known) for sec, sub in (('team', 'ttog'), ('win', 'pokemon'), ('lose', 'pokemon')) for f in FMTS] \
            + [spreads(det[f]) for f in FMTS] + [natures(det[f], nats) for f in FMTS]
        if n % 25 == 0 or n == len(targets):
            print('詳細頁 %d/%d' % (n, len(targets)), flush=True)
        time.sleep(0.3)
    # 超級進化的特性：中文名與效果只能從各詳細頁帶到的特性對照取（超級進化自己的詳細頁對照是空的），沒帶到的就沒有說明
    mega_a = {r[0]: [a for a in r[6].split('.') if a] for r in rows if r[5]}
    used_m = {s.split(':')[0] for u in use.values() for s in ' '.join(u[:2]).split()}
    used_a = {s.split(':')[0] for u in use.values() for s in ' '.join(u[2:4]).split()} | {k for ks in mega_a.values() for k in ks}
    used_i = {s.split(':')[0] for u in use.values() for s in ' '.join(u[4:6]).split()}
    mv_out = {m['key']: move_row(m) for m in moves.values() if m['key'] in used_m}
    ab_out = {a['key']: [a['name'], clean(a['description'])] for a in abils.values() if a['key'] in used_a}
    # 可學招式（OP.GG 標為不可用、或這隻禁用的不收）與可能的特性；不在 MOVES／ABILS 的另外存 LEARN_MOVES／LEARN_ABILS，
    # 網頁現有功能只看 MOVES／ABILS，不受影響
    avail = {m['key'] for m in moves.values() if m.get('isAvailable', True)}
    learn_out = {}
    for key, mon in learn.items():
        banned = {b if isinstance(b, str) else b.get('key') for b in mon.get('bannedMoves') or []}
        ms = [k for k in mon.get('moves') or [] if k in avail and k not in banned]
        ab = list(mon.get('abilities') or [])
        if ms or ab:
            learn_out[key] = ' '.join(ms) + '|' + ' '.join(ab)
    learn_m = {k for v in learn_out.values() for k in v.split('|')[0].split()} - used_m
    learn_a = {k for v in learn_out.values() for k in v.split('|')[1].split()} - used_a
    lm_out = {m['key']: move_row(m) for m in moves.values() if m['key'] in learn_m}
    la_out = {a['key']: [a['name'], clean(a['description'])] for a in abils.values() if a['key'] in learn_a}
    it_out = {x['key']: [x['name'], clean(x.get('effect') or x.get('description'))] for x in items.values() if x['key'] in used_i}
    miss = sorted({k for ks in mega_a.values() for k in ks} - set(ab_out))
    if miss:
        print('找不到這些超級進化特性的說明，網頁上會略過：%r' % miss)

    today = datetime.date.today().isoformat()
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    body = '\n'.join(dump(r) + ',' for r in rows)
    mons_js = ('// 寶可夢名單與常用招式：%s 擷取自 OP.GG 寶可夢冠軍圖鑑（含超級進化）；這個檔由 tools/update_mons.py 產生，勿手改\n'
               "const MONS_DATE = '%s';\n"
               '// [key, 中文名, 屬性（. 分隔）, 單打排名, 雙打排名（0＝沒有排名）, 超級進化的原型 key, 超級進化後的特性 key（. 分隔，只有超級進化有）]；\n'
               '// 種族值在 base-stats.js\n'
               'const MONS_RAW = [\n%s\n];\n'
               '// 常用統計：寶可夢 key → [單打招式, 雙打招式, 單打特性, 雙打特性, 單打道具, 雙打道具,\n'
               '//   單打隊友, 雙打隊友, 單打勝於, 雙打勝於, 單打敗於, 雙打敗於, 單打能力點數, 雙打能力點數, 單打性格, 雙打性格]。\n'
               '//   招式／特性／道具每項是「key:使用率%%」以空白分隔、依使用率高到低，低於 %d%% 的不收；\n'
               '//   隊友／勝於／敗於是寶可夢 key 以空白分隔，依 OP.GG 順序取前 %d 隻；\n'
               '//   能力點數每項是「HP.攻擊.防禦.特攻.特防.速度:使用率%%」，取前 %d 種；性格每項是「↑能力.↓能力:使用率%%」\n'
               '//   （1 攻擊、2 防禦、3 特攻、4 特防、5 速度，不加減的寫 0.0）；這兩種依使用率高到低，0%% 的不收。\n'
               '//   沒有統計的是空字串，超級進化不在這裡（沿用原型）\n'
               'const USAGE_RAW = {\n%s\n};\n'
               '// 招式（任一隻常用的）：key → [中文名, 屬性, 分類（physical 物理／special 特殊／status 變化）, 威力（null＝沒有）, 效果,\n'
               '//   PP, 命中率（null＝必中）, 先制等級, 目標範圍（OP.GG target，如 selected-pokemon 單體、all-opponents 對手全體）, 其他]；\n'
               '//   其他只列有值的：ail 異常／附加狀態（burn、paralysis…）、ailP 機率%%、fl 畏縮機率%%、cr 急所等級、dr 吸血%%（負的是反作用力）、\n'
               '//   hl 回復%%、hits [最少, 最多] 連續攻擊次數、st [[能力, 變化]…] 能力變化、stP 能力變化機率%%（0＝輔助招必定）、tr 招式標記（contact 接觸、sound 聲音…）\n'
               'const MOVES = {\n%s\n};\n'
               '// 特性：key → [中文名, 效果]\n'
               'const ABILS = {\n%s\n};\n'
               '// 道具：key → [中文名, 效果]\n'
               'const ITEMS = {\n%s\n};\n'
               '// 可學招式與可能的特性（抓了詳細頁的寶可夢；超級進化沿用原型；不可用與禁用的招式不收）：寶可夢 key → "招式 key 空白分隔|特性 key 空白分隔"\n'
               'const LEARN = {\n%s\n};\n'
               '// 可學但不在 MOVES 的招式（沒有寶可夢常用），格式同 MOVES\n'
               'const LEARN_MOVES = {\n%s\n};\n'
               '// 可能但不在 ABILS 的特性，格式同 ABILS\n'
               'const LEARN_ABILS = {\n%s\n};\n') % (
        today, today, body, MIN_PCT, LIST_N, SP_N,
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in use.items()),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(mv_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(ab_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(it_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(learn_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(lm_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(la_out.items())))
    mons_path = os.path.join(out, 'mons-data.js')
    # 換行沿用既有的 mons-data.js（Windows 上 git 取出來是 CRLF），檔案還不存在就用 LF；舊內容留著，寫完後比出新出現的招式／特性
    old_txt = None
    if os.path.exists(mons_path):
        with open(mons_path, encoding='utf-8', newline='') as f:
            old_txt = f.read()
        if old_txt.split('\n', 1)[0].endswith('\r'):
            mons_js = mons_js.replace('\n', '\r\n')
    with open(mons_path, 'w', encoding='utf-8', newline='') as f:
        f.write(mons_js)
    write_stats(out, stats)
    print('寫入 %d 隻（超級進化 %d、單打有排名 %d、雙打有排名 %d）；常用招式 %d 隻、能力點數 %d 隻、性格 %d 隻、招式 %d 種、特性 %d 種、道具 %d 種，%d bytes' % (
        len(rows), sum(1 for r in rows if r[5]), sum(1 for r in rows if r[3]), sum(1 for r in rows if r[4]),
        sum(1 for u in use.values() if u[0] or u[1]), sum(1 for u in use.values() if u[12] or u[13]),
        sum(1 for u in use.values() if u[14] or u[15]), len(mv_out), len(ab_out), len(it_out), len(mons_js.encode())))
    print('可學招式表 %d 隻；可學但沒人常用的招式 %d 種、特性 %d 種' % (len(learn_out), len(lm_out), len(la_out)))
    print('前 3 筆：', rows[:3])
    remind(old_txt, os.path.join(out, 'js'), mv_out, ab_out, mega_a)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--stats']
    main(args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html'), '--stats' in sys.argv[1:])

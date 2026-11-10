# 從 OP.GG 寶可夢冠軍圖鑑頁擷取寶可夢名單（屬性、單打／雙打排名、超級進化原型），
# 再逐隻抓有排名的寶可夢詳細頁，取單打／雙打的常用招式、特性、道具使用率，隊友、勝於、敗於名單，
# 以及招式／特性／道具的中文名與效果，
# 寫進 index.html 的 MONS START / MONS END 區塊之間。超級進化沒有獨立統計，網頁端沿用原型的；
# 超級進化的特性是固定的，名單頁就有，另外存在名單裡。
# 種族值不太會變，另外寫到 index.html 旁邊的 base-stats.js（不帶日期，資料沒變就不會有 diff）。
# 用法：python tools/update_mons.py [index.html 路徑，預設為 repo 根目錄的 index.html]
# 有排名的寶可夢約 250 隻要逐頁抓，跑一次約 3～5 分鐘。
import datetime
import json
import os
import re
import sys
import time
import urllib.request

URL = 'https://op.gg/zh-tw/pokemon-champions/pokedex'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Accept-Language': 'zh-TW,zh;q=0.9',
}
TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
         'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy']
MIN_PCT = 5  # 使用率（四捨五入到整數）低於這個 % 的招式／特性／道具不收
LIST_N = 10  # 隊友／勝於／敗於名單只收前幾隻
FMTS = ('single', 'double')


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
    # 一隻寶可夢詳細頁：單打／雙打統計（沒有統計時是 null）、這頁用到的特性與道具對照，以及全部招式的字典
    txt = fetch(URL + '/' + key, rsc=True)
    det = {f: grab(txt, f + 'Detail', '{') if '"%sDetail":{' % f in txt else None for f in FMTS}
    lk = grab(txt, 'lookupData', '{') if '"lookupData":{' in txt else {}
    i = txt.index('"moves":[{"id":1,"key":"pound"')
    return det, lk.get('abilities', []), lk.get('items', []), grab(txt[i:], 'moves', '[')


def usage(det, names):
    # [{id, usagePercent}...] → "key:使用率 key:使用率"（依使用率高到低，低於 MIN_PCT 的不收，對照不到的略過）
    if not det:
        return ''
    return ' '.join('%s:%d' % (names[x['id']], round(x['usagePercent'])) for x in det
                    if round(x['usagePercent']) >= MIN_PCT and x['id'] in names)


def ranked(det, sec, sub, known):
    # 隊友（team.ttog，網頁上「隊友」顯示的就是這份）／勝於（win.pokemon）／敗於（lose.pokemon）：
    # 寶可夢 key 以空白分隔，依 OP.GG 的順序取前 LIST_N 隻，名單裡沒有的型態不收
    if not det:
        return ''
    return ' '.join([p['key'] for p in (det.get(sec) or {}).get(sub) or [] if p['key'] in known][:LIST_N])


def main(path):
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

    # 常用招式／特性：只抓有排名的非超級進化寶可夢
    targets = [r[0] for r in rows if not r[5] and (r[3] or r[4])]
    use, moves, abils, items, known = {}, {}, {}, {}, {r[0] for r in rows}
    for n, key in enumerate(targets, 1):
        det, ab, it, mv = detail(key)
        moves = moves or {m['id']: m for m in mv}
        abils.update({a['id']: a for a in ab})
        items.update({x['id']: x for x in it})
        mid, aid, iid = ({i: x['key'] for i, x in d.items()} for d in (moves, abils, items))
        use[key] = [usage(det[f] and det[f][sec], ids) for sec, ids in (('moves', mid), ('abilities', aid)) for f in FMTS] \
            + [usage(det[f] and det[f].get('items'), iid) for f in FMTS] \
            + [ranked(det[f], sec, sub, known) for sec, sub in (('team', 'ttog'), ('win', 'pokemon'), ('lose', 'pokemon')) for f in FMTS]
        if n % 25 == 0 or n == len(targets):
            print('詳細頁 %d/%d' % (n, len(targets)), flush=True)
        time.sleep(0.3)
    # 超級進化的特性：中文名與效果只能從各詳細頁帶到的特性對照取（超級進化自己的詳細頁對照是空的），沒帶到的就沒有說明
    mega_a = {r[0]: [a for a in r[6].split('.') if a] for r in rows if r[5]}
    used_m = {s.split(':')[0] for u in use.values() for s in ' '.join(u[:2]).split()}
    used_a = {s.split(':')[0] for u in use.values() for s in ' '.join(u[2:4]).split()} | {k for ks in mega_a.values() for k in ks}
    used_i = {s.split(':')[0] for u in use.values() for s in ' '.join(u[4:6]).split()}
    mv_out = {m['key']: [m['name'], m['type'], m['category'], m['power'], clean(m['effect'] or m['description'])]
              for m in moves.values() if m['key'] in used_m}
    ab_out = {a['key']: [a['name'], clean(a['description'])] for a in abils.values() if a['key'] in used_a}
    it_out = {x['key']: [x['name'], clean(x.get('effect') or x.get('description'))] for x in items.values() if x['key'] in used_i}
    miss = sorted({k for ks in mega_a.values() for k in ks} - set(ab_out))
    if miss:
        print('找不到這些超級進化特性的說明，網頁上會略過：%r' % miss)

    today = datetime.date.today().isoformat()
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    body = '\n'.join(dump(r) + ',' for r in rows)
    block = ('// ----- MONS START -----\n'
             '// 寶可夢名單與常用招式：%s 擷取自 OP.GG 寶可夢冠軍圖鑑（含超級進化）；這段由 tools/update_mons.py 產生，勿手改\n'
             "const MONS_DATE = '%s';\n"
             '// [key, 中文名, 屬性（. 分隔）, 單打排名, 雙打排名（0＝沒有排名）, 超級進化的原型 key, 超級進化後的特性 key（. 分隔，只有超級進化有）]；\n'
             '// 種族值在 base-stats.js\n'
             'const MONS_RAW = [\n%s\n];\n'
             '// 常用統計：寶可夢 key → [單打招式, 雙打招式, 單打特性, 雙打特性, 單打道具, 雙打道具,\n'
             '//   單打隊友, 雙打隊友, 單打勝於, 雙打勝於, 單打敗於, 雙打敗於]。招式／特性／道具每項是「key:使用率%%」以空白分隔、\n'
             '//   依使用率高到低，低於 %d%% 的不收；隊友／勝於／敗於是寶可夢 key 以空白分隔，依 OP.GG 順序取前 %d 隻。\n'
             '//   沒有統計的是空字串，超級進化不在這裡（沿用原型）\n'
             'const USAGE_RAW = {\n%s\n};\n'
             '// 招式：key → [中文名, 屬性, 分類（physical 物理／special 特殊／status 變化）, 威力（null＝沒有）, 效果]\n'
             'const MOVES = {\n%s\n};\n'
             '// 特性：key → [中文名, 效果]\n'
             'const ABILS = {\n%s\n};\n'
             '// 道具：key → [中文名, 效果]\n'
             'const ITEMS = {\n%s\n};\n'
             '// ----- MONS END -----') % (
        today, today, body, MIN_PCT, LIST_N,
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in use.items()),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(mv_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(ab_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(it_out.items())))
    stats_js = ('// 種族值：擷取自 OP.GG 寶可夢冠軍圖鑑（含超級進化）；這個檔由 tools/update_mons.py 產生，勿手改\n'
                '// 寶可夢 key → [HP, 攻擊, 防禦, 特攻, 特防, 速度]\n'
                'const BASE_STATS = {\n%s\n};\n') % '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in stats.items())
    with open(path, encoding='utf-8', newline='') as f:
        html = f.read()
    if '\r\n' in html:
        block = block.replace('\n', '\r\n')
        stats_js = stats_js.replace('\n', '\r\n')
    new, n = re.subn(r'// ----- MONS START -----.*?// ----- MONS END -----', lambda m: block, html, flags=re.S)
    if n != 1:
        raise SystemExit('index.html 裡找不到唯一的 MONS 區塊')
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(new)
    with open(os.path.join(os.path.dirname(os.path.abspath(path)), 'base-stats.js'), 'w', encoding='utf-8', newline='') as f:
        f.write(stats_js)
    print('寫入 %d 隻（超級進化 %d、單打有排名 %d、雙打有排名 %d）；常用招式 %d 隻、招式 %d 種、特性 %d 種、道具 %d 種，%d bytes' % (
        len(rows), sum(1 for r in rows if r[5]), sum(1 for r in rows if r[3]), sum(1 for r in rows if r[4]),
        sum(1 for u in use.values() if u[0] or u[1]), len(mv_out), len(ab_out), len(it_out), len(block.encode())))
    print('前 3 筆：', rows[:3])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html'))

#!/usr/bin/env python3
"""
Sound-effect pipeline: find CC0 sounds on Freesound, verify each licence on its own page,
download the HQ preview, cut the first clean impact into a one-shot, normalise and encode AAC.

Usage: python3 -I tools/sfx.py <work_dir> <out_dir> <category> <max_seconds> <count> "query 1" "query 2" ...
Appends credits to <work_dir>/credits-<category>.tsv (id, user, title, url, files).
"""
import html, json, os, re, subprocess, sys, time, urllib.parse, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh) night-duty-build'}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()


def run(args):
    return subprocess.run(args, capture_output=True, text=True)


def search(query, max_seconds):
    url = 'https://freesound.org/search/?' + urllib.parse.urlencode(
        {'q': query, 'f': 'license:"Creative Commons 0"', 's': 'Rating highest first'})
    h = get(url).decode('utf8', 'ignore')
    out = []
    for m in re.finditer(r'data-mp3="(https://cdn\.freesound\.org/previews/\d+/(\d+)_(\d+)-lq\.mp3)"', h):
        sid = m.group(2)
        seg = h[max(0, m.start() - 3000):m.start() + 3000]
        t = re.search(r'/people/([^/]+)/sounds/' + sid + r'/"[^>]*>\s*([^<]+)<', seg)
        d = re.search(r'data-duration="([\d.]+)"', seg)
        dur = float(d.group(1)) if d else 99
        if not t or dur > max_seconds:
            continue
        out.append({'id': sid, 'user': t.group(1), 'title': html.unescape(t.group(2).strip()), 'dur': dur,
                    'hq': m.group(1).replace('-lq.mp3', '-hq.mp3')})
    return out


def verify_cc0(s):
    page = get(f"https://freesound.org/people/{s['user']}/sounds/{s['id']}/").decode('utf8', 'ignore')
    lic = sorted(set(re.findall(r'creativecommons\.org/(?:publicdomain/zero|licenses/[a-z-]+)/[\d.]+', page)))
    return lic == ['creativecommons.org/publicdomain/zero/1.0']


def first_segment(path):
    """Start and end of the first loud region (after leading silence)."""
    err = run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'silencedetect=noise=-36dB:d=0.12', '-f', 'null', '-']).stderr
    marks = re.findall(r'silence_(start|end): ([\d.]+)', err)
    dur = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).stdout or 0)
    start, end = 0.0, dur
    if marks and marks[0][0] == 'end':
        start = float(marks[0][1])
        marks = marks[1:]
    for kind, t in marks:
        if kind == 'start' and float(t) > start + 0.08:
            end = float(t)
            break
    return start, end


def main():
    work, out, cat, max_s, count = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), int(sys.argv[5])
    queries = sys.argv[6:]
    os.makedirs(work, exist_ok=True)
    os.makedirs(out, exist_ok=True)
    seen, picked = set(), []
    for q in queries:
        for s in search(q, max_s):
            if s['id'] in seen:
                continue
            seen.add(s['id'])
            try:
                if not verify_cc0(s):
                    print('  skip (not CC0)', s['id'], s['title'])
                    continue
            except Exception as e:
                print('  skip (page error)', s['id'], e)
                continue
            picked.append(s)
            time.sleep(0.3)
            if len(picked) >= count:
                break
        if len(picked) >= count:
            break
    credits = open(os.path.join(work, f'credits-{cat}.tsv'), 'a')
    for i, s in enumerate(picked):
        src = os.path.join(work, f"{s['id']}.mp3")
        open(src, 'wb').write(get(s['hq']))
        a, b = first_segment(src)
        b = min(b, a + max(0.25, min(1.6, max_s)))
        tmp = os.path.join(work, f'tmp_{cat}_{i}.wav')
        run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', src, '-ac', '1', '-ar', '44100',
             '-af', 'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.004,highpass=f=40', tmp])
        try:
            d = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp]).stdout)
        except ValueError:
            d = 0
        if d < 0.05:
            print('  skip (empty cut)', s['id'])
            continue
        pk = float(re.search(r'max_volume: ([-\d.]+)', run(['ffmpeg', '-hide_banner', '-i', tmp, '-af', 'volumedetect', '-f', 'null', '-']).stderr).group(1))
        fd = d * 0.35
        name = f'{cat}_{i:02d}'
        run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-af',
             f'afade=t=in:d=0.003,afade=t=out:st={d - fd:.3f}:d={fd:.3f},volume={-1.0 - pk:.2f}dB',
             '-c:a', 'aac', '-b:a', '112k', os.path.join(out, f'{name}.m4a')])
        os.remove(tmp)
        credits.write(f"{name}\t{s['id']}\t{s['user']}\t{s['title']}\thttps://freesound.org/people/{s['user']}/sounds/{s['id']}/\n")
        print(f"{name} <- {s['id']} {s['title'][:50]} ({d:.2f}s, gain {-1.0 - pk:+.1f}dB)")


if __name__ == '__main__':
    main()

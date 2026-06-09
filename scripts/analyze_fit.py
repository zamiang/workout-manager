#!/usr/bin/env python3
"""
Analyze L/R balance and pedal smoothness across FIT files in ref/.

Setup (once):
    python3 -m venv .venv && .venv/bin/pip install fitparse

Run:
    .venv/bin/python scripts/analyze_fit.py
    .venv/bin/python scripts/analyze_fit.py path/to/single.fit
"""
import sys, os, glob, statistics
from fitparse import FitFile


def analyze(path):
    ff = FitFile(path)
    bal, lps, rps, lte, rte = [], [], [], [], []
    cad, pwr, hr = [], [], []
    start, sport, duration = None, None, 0

    for rec in ff.get_messages():
        if rec.name == 'session':
            for f in rec:
                if f.name == 'start_time' and start is None:
                    start = f.value
                if f.name == 'sport':
                    sport = f.value
                if f.name == 'total_timer_time':
                    duration = f.value
        elif rec.name == 'record':
            d = {f.name: f.value for f in rec}
            v = d.get('left_right_balance')
            if isinstance(v, int) and v > 100:
                v = v & 0x7F
            if isinstance(v, (int, float)) and 0 < v < 100:
                bal.append(float(v))
            for k, bucket in (
                ('left_pedal_smoothness', lps),
                ('right_pedal_smoothness', rps),
                ('left_torque_effectiveness', lte),
                ('right_torque_effectiveness', rte),
            ):
                x = d.get(k)
                if x is not None and 0 <= x <= 100:
                    bucket.append(x)
            c = d.get('cadence')
            if c is not None and c > 30:
                cad.append(c)
            p = d.get('power')
            if p is not None and p > 0:
                pwr.append(p)
            h = d.get('heart_rate')
            if h is not None:
                hr.append(h)

    def st(v):
        if not v:
            return None
        return {
            'n': len(v),
            'mean': statistics.mean(v),
            'stdev': statistics.pstdev(v) if len(v) > 1 else 0.0,
        }

    return {
        'file': os.path.basename(path),
        'start': start,
        'sport': sport,
        'duration_min': duration / 60 if duration else None,
        'avg_power': statistics.mean(pwr) if pwr else None,
        'avg_cadence': statistics.mean(cad) if cad else None,
        'avg_hr': statistics.mean(hr) if hr else None,
        'lr_balance_left': st(bal),
        'l_pedal_smoothness': st(lps),
        'r_pedal_smoothness': st(rps),
        'l_torque_eff': st(lte),
        'r_torque_eff': st(rte),
    }


def fmt(v, n=1):
    return '—' if v is None else f"{v:.{n}f}"


def main(argv):
    if len(argv) > 1:
        paths = argv[1:]
    else:
        here = os.path.dirname(os.path.abspath(__file__))
        ref = os.path.join(os.path.dirname(here), 'ref')
        paths = sorted(glob.glob(os.path.join(ref, '*.fit')))

    rows = []
    for p in paths:
        try:
            rows.append(analyze(p))
        except Exception as e:
            print(f"ERR {p}: {e}", file=sys.stderr)
    rows.sort(key=lambda r: str(r['start'] or ''))

    hdr = f"{'File':<28} {'Date':<17} {'Min':>4} {'Pwr':>4} {'HR':>4} {'Cad':>4} {'L%':>5} {'L-PS':>5} {'R-PS':>5} {'Δ':>5} {'L-TE':>5} {'R-TE':>5}"
    print(hdr)
    print('-' * len(hdr))
    for r in rows:
        lb = r['lr_balance_left']['mean'] if r['lr_balance_left'] else None
        lp = r['l_pedal_smoothness']['mean'] if r['l_pedal_smoothness'] else None
        rp = r['r_pedal_smoothness']['mean'] if r['r_pedal_smoothness'] else None
        delta = (rp - lp) if (lp is not None and rp is not None) else None
        lt = r['l_torque_eff']['mean'] if r['l_torque_eff'] else None
        rt = r['r_torque_eff']['mean'] if r['r_torque_eff'] else None
        date = str(r['start'])[:16] if r['start'] else '?'
        print(
            f"{r['file']:<28} {date:<17} "
            f"{fmt(r['duration_min'],0):>4} {fmt(r['avg_power'],0):>4} "
            f"{fmt(r['avg_hr'],0):>4} {fmt(r['avg_cadence'],0):>4} "
            f"{fmt(lb,1):>5} {fmt(lp,1):>5} {fmt(rp,1):>5} {fmt(delta,1):>5} "
            f"{fmt(lt,1):>5} {fmt(rt,1):>5}"
        )

    print("\nKey: L% = left's share of power (50 = balanced). "
          "L-PS/R-PS = pedal smoothness %. Δ = R-PS − L-PS (positive = right smoother). "
          "L-TE/R-TE = torque effectiveness %.")


if __name__ == '__main__':
    main(sys.argv)

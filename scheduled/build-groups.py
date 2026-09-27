"""TEST-5MIN-1a "Quarantine + no retries + <=240 s groups" - regenerate the scheduled-run files.

Run from E2ETests/:
  ssh jim@10.0.0.2 python3 - < scheduled/fetch-history.py > hist.json
  E2E_TARGET=prod npx playwright test --list --reporter=json > list.json   (project names: config.projects[].name)
  python scheduled/build-groups.py hist.json list.json
Outputs (committed): scheduled/quarantine.json, scheduled/scheduled-groups.json, QUARANTINE.md

Rules (owner decisions Q1-Q4, TEST-5MIN-1 task doc):
  - quarantine: a test red ("unexpected") in >= 5 of the last 7 full nightly runs of that target.
  - project duration: sum over its non-quarantined tests of min(200, median measured duration), + 5 s.
  - groups: first-fit decreasing at <= 240 s, ties broken by name -> deterministic.
  - poueni-* projects form the "poueni" target (prod data) and are removed from "prod".
  - a project with no measured duration gets ESTIMATE_S and is packed into trailing groups flagged
    "estimated": true (the old nightly image never ran it; its first scheduled run measures it).
"""
import datetime
import json
import re
import statistics
import sys

CAP, TEST_CAP, OVERHEAD, ESTIMATE_S, RED_MIN = 240, 200, 5, 60, 5
DEPS = {"setup", "multi-tenant-setup"}
# Scheduled-only splits of a project whose green time alone exceeds CAP (zygos-ui ~264-272 s).
SPLITS = {
    "zygos-ui-part1": {"base": "zygos-ui", "testMatch": r"zygos[\\/]zygos-[a-h][^\\/]*\.ui\.spec\.ts"},
    "zygos-ui-part2": {"base": "zygos-ui", "testMatch": r"zygos[\\/]zygos-[i-z][^\\/]*\.ui\.spec\.ts"},
}
SPLIT_BASES = {v["base"] for v in SPLITS.values()}
OWNER = [
    ("agora/", "frontend-dev (agora-web)"), ("online-menus/", "frontend-dev (katalogos-web)"),
    ("prod-gate/", "frontend-dev (per product)"), ("questioner/", "frontend-dev (erevna-web)"),
    ("kefi", "frontend-dev (kefi-web) / backend-dev (kefi)"), ("poueni/", "backend-dev (poueni)"),
    ("zygos/", "frontend-dev (zygos-web)"), ("ichnos/", "backend-dev (ichnos)"),
    ("identity/", "backend-dev (auth / keycloak)"), ("helpers/", "backend-dev (auth / login methods)"),
]


def owner(f):
    return next((o for k, o in OWNER if f.startswith(k)), "e2e-tester (triage)")


def pack(items):
    bins = []
    for name, secs in sorted(items, key=lambda x: (-x[1], x[0])):
        for b in bins:
            if b["seconds"] + secs <= CAP:
                b["seconds"] += secs
                b["projects"].append(name)
                break
        else:
            bins.append({"seconds": secs, "projects": [name]})
    return bins


def target_stats(runs):
    red, dur, proj = {}, {}, {}
    for r in runs:
        for f, tp, p, s, d in r["tests"]:
            k = (f, " ".join(tp), p)
            proj.setdefault(p, set()).add(k)
            if s == "unexpected":
                red.setdefault(k, []).append(r["mtime"][:10])
            if s != "skipped" and d > 0:
                dur.setdefault(k, []).append(d / 1000)
    return red, dur, proj


def seconds(keys, dur):
    return OVERHEAD + sum(min(TEST_CAP, statistics.median(dur[k])) for k in keys if k in dur)


def main(hist_path, list_path):
    h = json.load(open(hist_path, encoding="utf8"))
    raw = open(list_path, encoding="utf8").read()
    names = [p["name"] for p in json.loads(raw[raw.index("{"):])["config"]["projects"]]
    quarantine, per_target = {}, {}
    for t in ("staging", "prod"):
        runs = [r for r in h[t] if r["kind"] == "full"]
        red, dur, proj = target_stats(runs)
        q = sorted(k for k, v in red.items() if len(v) >= RED_MIN)
        quarantine[t] = [{"file": f, "title": ti, "project": p, "redSince": min(red[(f, ti, p)]),
                          "redRuns": "%d/%d" % (len(red[(f, ti, p)]), len(runs)), "owner": owner(f)}
                         for f, ti, p in q]
        qs, secs = set(q), {}
        for p, ks in proj.items():
            live = [k for k in ks if k not in qs]
            if not live:
                continue  # every test quarantined -> nothing left to schedule
            if p in SPLIT_BASES:
                for sp, cfg in SPLITS.items():
                    rx = re.compile(cfg["testMatch"])
                    secs[sp] = seconds([k for k in live if rx.search(k[0])], dur)
                continue
            secs[p] = seconds(live, dur)
        per_target[t] = (secs, set(proj), [r["mtime"] for r in runs])
    measured = per_target["staging"][1] | per_target["prod"][1]
    unmeasured = [n for n in names if n not in measured and n not in DEPS]
    groups = {"capSeconds": CAP, "testCapSeconds": TEST_CAP, "splits": SPLITS, "targets": {},
              "source": {t: v[2] for t, v in per_target.items()}}

    def build(secs, keep):
        items = [(p, round(s)) for p, s in secs.items() if keep(p)]
        est = [(p, ESTIMATE_S) for p in unmeasured if keep(p)]
        return pack(items) + [dict(b, estimated=True) for b in pack(est)]

    def is_pou(p):
        return p.startswith("poueni-")

    for t in ("staging", "prod"):
        groups["targets"][t] = build(per_target[t][0], lambda p: not is_pou(p))
    groups["targets"]["poueni"] = build(per_target["prod"][0], is_pou)
    dump = dict(indent=1, ensure_ascii=False)
    json.dump(quarantine, open("scheduled/quarantine.json", "w", encoding="utf8", newline="\n"), **dump)
    json.dump(groups, open("scheduled/scheduled-groups.json", "w", encoding="utf8", newline="\n"), **dump)
    write_md(quarantine)
    for t, g in groups["targets"].items():
        print(t, "groups=%d measured=%d estimated=%d max=%ds quarantine=%d" % (
            len(g), sum(1 for b in g if not b.get("estimated")), sum(1 for b in g if b.get("estimated")),
            max(b["seconds"] for b in g), len(quarantine.get(t, []))))


def write_md(quarantine):
    md = ["# QUARANTINE - tests excluded from every scheduled run", "",
          'TEST-5MIN-1a "Quarantine + no retries + <=240 s groups". A test red in >= %d of the last 7 full nightly'
          " runs of a target is excluded from scheduled runs (`E2E_SCHEDULED=1` / `E2E_GROUP_INDEX`) and never runs"
          ' on a schedule (owner decision Q4 "quarantine never"). Each spec needs an owner/ticket so the list shrinks.'
          % RED_MIN, "",
          "- Run the lane by hand: `E2E_TARGET=<staging|prod> E2E_QUARANTINE=1 npx playwright test`.",
          "- Test-level list (exact titles): `scheduled/quarantine.json`. Regenerate after fixes: see"
          " `scheduled/build-groups.py`.",
          "- `red since` = first red run inside the 7-run window; it may have gone red earlier. Generated %s."
          % datetime.date.today(), ""]
    for t in ("staging", "prod"):
        files = {}
        for e in quarantine[t]:
            files.setdefault(e["file"], []).append(e)
        md += ["## %s - %d tests in %d spec files" % (t, len(quarantine[t]), len(files)), "",
               "| spec | tests | red since | suggested owner |", "|---|---|---|---|"]
        md += ["| `%s` | %d | %s | %s |" % (f, len(v), min(e["redSince"] for e in v), v[0]["owner"])
               for f, v in sorted(files.items())]
        md.append("")
    open("QUARANTINE.md", "w", encoding="utf8", newline="\n").write("\n".join(md))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

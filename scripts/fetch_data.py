#!/usr/bin/env python3
"""뉴스(Google News RSS), 논문(PubMed), 임상시험(ClinicalTrials.gov)을 수집해 data/*.json으로 저장한다.

표준 라이브러리만 사용한다. GitHub Actions에서 매일 실행된다.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
UA = {"User-Agent": "lymphoma-portal/1.0 (+https://github.com/kayjo81/lymphoma)"}

NEWS_QUERIES = [
    # (검색어, 언어, 주제 라벨)
    ("림프종 신약", "ko", "신약"),
    ("림프종 임상", "ko", "임상"),
    ("림프종 치료", "ko", "치료"),
    ("lymphoma FDA approval", "en", "신약"),
    ("lymphoma phase 3 trial results", "en", "임상"),
    ("lymphoma CAR-T OR bispecific", "en", "신약"),
]

# 제목·초록·MeSH에 림프종이 있는 논문만
PUBMED_TERM = "lymphoma[tiab] OR lymphoma[mh]"
TRANSLATE = "https://translate.googleapis.com/translate_a/single"


def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            print(f"retry {url}: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def translate(texts, target="ko"):
    """영문 문자열 목록을 한국어로 번역한다. 실패한 항목은 빈 문자열."""
    out = []
    for text in texts:
        q = urllib.parse.urlencode({"client": "gtx", "sl": "en", "tl": target, "dt": "t", "q": text})
        try:
            data = json.loads(fetch(f"{TRANSLATE}?{q}", retries=2))
            out.append("".join(seg[0] for seg in data[0] if seg[0]).strip())
        except Exception as e:  # noqa: BLE001
            print(f"translate failed: {e}", file=sys.stderr)
            out.append("")
        time.sleep(0.15)
    return out


def add_korean(items, field="title"):
    """lang이 ko가 아닌 항목에 title_ko를 붙인다."""
    targets = [it for it in items if it.get("lang", "en") != "ko"]
    for it, ko in zip(targets, translate([it[field] for it in targets])):
        if ko:
            it[f"{field}_ko"] = ko
    return items


def collect_news():
    items, seen = [], set()
    for query, lang, topic in NEWS_QUERIES:
        hl, gl, ceid = ("ko", "KR", "KR:ko") if lang == "ko" else ("en-US", "US", "US:en")
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
            {"q": f"{query} when:30d", "hl": hl, "gl": gl, "ceid": ceid})
        try:
            root = ET.fromstring(fetch(url))
        except Exception as e:  # noqa: BLE001
            print(f"news query failed ({query}): {e}", file=sys.stderr)
            continue
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            source = (it.findtext("source") or "").strip()
            # Google News 제목은 "기사 제목 - 언론사" 형식
            if source and title.endswith(" - " + source):
                title = title[: -len(source) - 3]
            key = title.lower()
            if not title or key in seen:
                continue
            seen.add(key)
            try:
                date = iso(parsedate_to_datetime(it.findtext("pubDate")))
            except Exception:  # noqa: BLE001
                date = ""
            items.append({"title": title, "link": it.findtext("link"), "source": source,
                          "date": date, "lang": lang, "topic": topic})
    items.sort(key=lambda x: x["date"], reverse=True)
    return add_korean(items[:150])


def collect_papers():
    base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
    q = urllib.parse.urlencode({"db": "pubmed", "term": PUBMED_TERM, "retmode": "json",
                                "retmax": 60, "datetype": "edat", "reldate": 30})
    ids = json.loads(fetch(base + "esearch.fcgi?" + q))["esearchresult"]["idlist"]
    if not ids:
        return []
    res = json.loads(fetch(base + "esummary.fcgi?db=pubmed&retmode=json&id=" + ",".join(ids)))["result"]
    out = []
    for pmid in ids:
        r = res.get(pmid)
        if not r:
            continue
        doi = next((a["value"] for a in r.get("articleids", []) if a.get("idtype") == "doi"), "")
        out.append({"pmid": pmid, "title": r.get("title", ""),
                    "journal": r.get("fulljournalname") or r.get("source", ""),
                    "date": r.get("epubdate") or r.get("pubdate", ""), "authors": [a["name"] for a in r.get("authors", [])],
                    "doi": doi, "types": r.get("pubtype", [])})
    return add_korean(out)


def collect_trials():
    q = urllib.parse.urlencode({"query.cond": "lymphoma", "filter.overallStatus": "RECRUITING",
                                "sort": "LastUpdatePostDate:desc", "pageSize": 100, "format": "json"})
    studies = json.loads(fetch("https://clinicaltrials.gov/api/v2/studies?" + q)).get("studies", [])
    out = []
    for s in studies:
        p = s.get("protocolSection", {})
        countries = [loc.get("country") for loc in p.get("contactsLocationsModule", {}).get("locations", [])]
        phases = [x for x in p.get("designModule", {}).get("phases", []) if x != "NA"]
        out.append({
            "nct": p.get("identificationModule", {}).get("nctId"),
            "title": p.get("identificationModule", {}).get("briefTitle"),
            "phase": "/".join(phases).replace("PHASE", "Phase "),
            "sponsor": p.get("sponsorCollaboratorsModule", {}).get("leadSponsor", {}).get("name", ""),
            "interventions": list(dict.fromkeys(
                i.get("name") for i in p.get("armsInterventionsModule", {}).get("interventions", []))),
            "korea": "Korea, Republic of" in countries,
            "updated": p.get("statusModule", {}).get("lastUpdatePostDateStruct", {}).get("date", ""),
        })
    return add_korean(out)


def save(name, items):
    if not items:
        print(f"{name}: 수집 결과 없음, 기존 파일 유지", file=sys.stderr)
        return
    payload = {"updated": iso(datetime.now(timezone.utc)), "items": items}
    (DATA / f"{name}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{name}: {len(items)}건 저장")


def main():
    DATA.mkdir(exist_ok=True)
    for name, fn in (("news", collect_news), ("papers", collect_papers), ("trials", collect_trials)):
        try:
            save(name, fn())
        except Exception as e:  # noqa: BLE001
            print(f"{name} 수집 실패: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()

# 림프종 정보 포털

림프종(혈액암) 정보를 한곳에 모은 정적 웹사이트입니다. 빌드 과정 없이 GitHub Pages로 배포됩니다.

| 메뉴 | 내용 | 데이터 |
|---|---|---|
| 질병 정보 | 증상, 진단, 루가노 병기·IPI, WHO 5판/ICC 기준 아형 16종, 치료, FDA 신약 허가 타임라인 | `assets/content.js` (직접 작성) |
| 뉴스·임상 | 신약·임상 뉴스(한/영), 모집 중인 임상시험(국내 기관 필터) | Google News RSS → `data/news.json`, ClinicalTrials.gov API (실시간, 실패 시 `data/trials.json`) |
| 최신 논문 | 아형·주제·기간별 PubMed 검색, 초록 펼쳐보기 | PubMed E-utilities (실시간, 실패 시 `data/papers.json`) |

## 구조

```
index.html               # 단일 페이지 (해시 라우팅: #info, #news, #papers)
assets/app.js            # 화면 로직, PubMed·ClinicalTrials.gov 호출
assets/content.js        # 아형 카드, 신약 타임라인 데이터
assets/style.css
data/*.json              # 자동 수집 스냅샷
scripts/fetch_data.py    # 뉴스·논문·임상 수집 (표준 라이브러리만 사용)
.github/workflows/update-data.yml  # 매일 06:17 KST 수집 후 Pages 배포
```

## 로컬 실행

```bash
python3 scripts/fetch_data.py   # 선택: 데이터 수집
python3 -m http.server 8000     # http://localhost:8000
```

## 배포

1. 저장소 Settings → Pages → Source를 **GitHub Actions**로 설정
2. Actions 탭에서 `Update data & deploy`를 수동 실행(또는 push)

뉴스는 브라우저에서 직접 RSS를 읽을 수 없어(CORS) Actions가 매일 수집한 `data/news.json`을 표시합니다.

## 콘텐츠 수정

- 아형 추가·수정: `assets/content.js`의 `LYMPHOMA_TYPES`
- 신약 타임라인: `assets/content.js`의 `DRUG_TIMELINE`
- 뉴스 검색어: `scripts/fetch_data.py`의 `NEWS_QUERIES`

> 이 사이트의 정보는 교육 목적이며 의학적 진단이나 치료를 대신하지 않습니다.

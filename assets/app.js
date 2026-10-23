(function () {
  "use strict";

  const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
  const CTGOV = "https://clinicaltrials.gov/api/v2/studies";
  const PAGE_SIZE = 20;
  const TRANSLATE = "https://translate.googleapis.com/translate_a/single";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtDate(s) {
    const d = new Date(s);
    if (isNaN(d)) return esc(s || "");
    return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + " " + url);
    return res.json();
  }

  // ---------- 번역 ----------
  // 영문 제목·초록을 한국어로 번역해 원문과 함께 보여준다. 수집 데이터는 title_ko를 미리 담고 있고,
  // 실시간 검색 결과는 브라우저에서 Google 번역으로 번역한다.
  const trCache = new Map();
  let trOn = true;
  try { trOn = localStorage.getItem("tr") !== "off"; } catch {}

  async function translateText(text) {
    if (trCache.has(text)) return trCache.get(text);
    const params = new URLSearchParams({ client: "gtx", sl: "en", tl: "ko", dt: "t", q: text });
    const data = await getJSON(TRANSLATE + "?" + params);
    const ko = data[0].map(seg => seg[0] || "").join("").trim();
    trCache.set(text, ko);
    return ko;
  }

  // 번역문 칸(.ko)과 원문 칸(.orig)을 함께 출력한다
  function bilingual(text, ko) {
    return `<span class="ko"${ko ? "" : " hidden"}>${esc(ko || "")}</span><span class="orig" data-src="${esc(text)}">${esc(text)}</span>`;
  }

  // root 안에서 아직 번역되지 않은 칸을 채운다. 동시에 4개씩 요청
  async function translateIn(root) {
    if (!trOn) return;
    const queue = $$(".ko[hidden]", root).filter(el => !el.dataset.tried);
    let failed = false;
    async function worker() {
      while (queue.length) {
        const el = queue.shift();
        el.dataset.tried = "1";
        try {
          const ko = await translateText(el.nextElementSibling.dataset.src);
          if (ko) { el.textContent = ko; el.hidden = false; }
        } catch { failed = true; }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    return !failed;
  }

  function setTranslation(on) {
    trOn = on;
    try { localStorage.setItem("tr", on ? "on" : "off"); } catch {}
    document.body.classList.toggle("tr-on", on);
    const btn = $("#tr-toggle");
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "한국어 번역 켜짐" : "한국어 번역 꺼짐";
    if (on) translateIn(document);
  }

  // ---------- 라우팅 ----------
  const loaded = {};
  function route() {
    const [view, anchor] = (location.hash.slice(1) || "home").split("/");
    const name = ["home", "info", "news", "papers"].includes(view) ? view : "home";
    $$(".view").forEach(v => (v.hidden = v.id !== "view-" + name));
    $$(".nav a").forEach(a => a.classList.toggle("active", a.dataset.route === name));
    if (!loaded[name]) {
      loaded[name] = true;
      ({ home: initHome, info: initInfo, news: initNews, papers: initPapers })[name]();
    }
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" });
    else window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  // ---------- 질병 정보 ----------
  const GROUP_LABEL = { hl: "호지킨", b: "B세포", tnk: "T/NK세포" };

  function initInfo() {
    const grid = $("#type-grid");
    const render = filter => {
      grid.innerHTML = window.LYMPHOMA_TYPES
        .filter(t => filter === "all" || t.group === filter)
        .map(t => `
          <div class="type-card g-${t.group}">
            <div class="type-meta"><span class="badge">${GROUP_LABEL[t.group]}</span><span class="pace">${esc(t.pace)}</span></div>
            <h3>${esc(t.name)}</h3>
            <p class="en">${esc(t.en)}</p>
            <p>${esc(t.desc)}</p>
            <p class="tx"><strong>치료</strong> ${esc(t.tx)}</p>
          </div>`).join("");
    };
    $$("[data-type-filter]").forEach(b => b.addEventListener("click", () => {
      $$("[data-type-filter]").forEach(x => x.classList.toggle("active", x === b));
      render(b.dataset.typeFilter);
    }));
    render("all");

    $("#drug-timeline").innerHTML = window.DRUG_TIMELINE.map(d => `
      <li><span class="tl-date">${esc(d.date)}</span><div><strong>${esc(d.drug)}</strong><p>${esc(d.note)}</p></div></li>`).join("");
  }

  // ---------- PubMed ----------
  async function pubmedSearch(term, days, retstart = 0) {
    const params = new URLSearchParams({
      db: "pubmed", term, retmode: "json",
      retmax: PAGE_SIZE, retstart, datetype: "edat", reldate: days
    });
    const s = await getJSON(EUTILS + "esearch.fcgi?" + params);
    const ids = s.esearchresult.idlist;
    const count = +s.esearchresult.count;
    if (!ids.length) return { count, items: [] };
    const sum = await getJSON(EUTILS + "esummary.fcgi?db=pubmed&retmode=json&id=" + ids.join(","));
    const items = ids.map(id => sum.result[id]).filter(Boolean).map(r => ({
      pmid: r.uid,
      title: r.title,
      journal: r.fulljournalname || r.source,
      // 인쇄본 발행 예정일(pubdate)은 미래일 수 있어 온라인 게재일을 우선
      date: r.epubdate || r.pubdate,
      authors: (r.authors || []).map(a => a.name),
      doi: (r.articleids || []).find(a => a.idtype === "doi")?.value || "",
      types: r.pubtype || []
    }));
    return { count, items };
  }

  async function fetchAbstract(pmid) {
    const res = await fetch(EUTILS + "efetch.fcgi?db=pubmed&rettype=abstract&retmode=xml&id=" + pmid);
    const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
    const nodes = $$("AbstractText", xml);
    if (!nodes.length) return "<p class='muted'>초록이 제공되지 않습니다.</p>";
    const full = nodes.map(n => n.textContent).join("\n\n");
    const gt = "https://translate.google.com/?sl=en&tl=ko&op=translate&text=" + encodeURIComponent(full.slice(0, 4500));
    return nodes.map(n => {
      const label = n.getAttribute("Label");
      return `<p>${label ? `<strong>${esc(label)}</strong> ` : ""}${bilingual(n.textContent)}</p>`;
    }).join("") + `<div class="abs-tools">
        <button type="button" class="linkish" data-abs-toggle>원문 보기</button>
        <a href="${esc(gt)}" target="_blank" rel="noopener">Google 번역에서 열기</a>
      </div>`;
  }

  function paperItem(p) {
    const authors = p.authors.length > 3 ? p.authors.slice(0, 3).join(", ") + " 외" : p.authors.join(", ");
    const badges = p.types.filter(t => /Trial|Review|Meta-Analysis|Guideline/i.test(t))
      .map(t => `<span class="badge">${esc(t)}</span>`).join("");
    return `
      <li class="item paper" data-pmid="${esc(p.pmid)}">
        <button class="paper-title" aria-expanded="false">${bilingual(p.title, p.title_ko)}</button>
        <div class="meta">${badges}<span>${esc(p.journal)}</span><span>${esc(p.date)}</span><span>${esc(authors)}</span></div>
        <div class="abstract" hidden></div>
        <div class="links">
          <a href="https://pubmed.ncbi.nlm.nih.gov/${esc(p.pmid)}/" target="_blank" rel="noopener">PubMed</a>
          ${p.doi ? `<a href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">원문(DOI)</a>` : ""}
        </div>
      </li>`;
  }

  function bindAbstracts(list) {
    list.addEventListener("click", async e => {
      const toggle = e.target.closest("[data-abs-toggle]");
      if (toggle) {
        const box = toggle.closest(".abstract");
        const showOrig = box.classList.toggle("show-orig");
        toggle.textContent = showOrig ? "번역 보기" : "원문 보기";
        return;
      }
      const btn = e.target.closest(".paper-title");
      if (!btn) return;
      const li = btn.closest(".paper");
      const box = $(".abstract", li);
      const open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      box.hidden = open;
      if (!open && !box.dataset.loaded) {
        box.innerHTML = "<p class='muted'>초록 불러오는 중…</p>";
        try {
          box.innerHTML = await fetchAbstract(li.dataset.pmid);
          box.dataset.loaded = "1";
          translateIn(box);
        } catch {
          box.innerHTML = "<p class='muted'>초록을 불러오지 못했습니다. PubMed 링크를 이용하세요.</p>";
        }
      }
    });
  }

  // 저장된 스냅샷(data/papers.json) — 실시간 검색이 실패할 때 사용
  async function snapshotPapers() {
    const data = await getJSON("data/papers.json");
    return data.items || [];
  }

  function initPapers() {
    const form = $("#paper-form");
    const list = $("#paper-list");
    const status = $("#paper-status");
    const more = $("#paper-more");
    let term = "", days = 30, offset = 0, total = 0;
    bindAbstracts(list);

    const buildTerm = () => {
      const type = $("#paper-type").value;
      const parts = [type === "lymphoma" ? "(lymphoma[tiab] OR lymphoma[mh])" : `(${type})`];
      if ($("#paper-topic").value) parts.push($("#paper-topic").value);
      const q = $("#paper-q").value.trim();
      if (q) parts.push(`(${q})`);
      return parts.join(" AND ");
    };

    async function load(reset) {
      if (reset) {
        term = buildTerm(); days = +$("#paper-days").value; offset = 0;
        list.innerHTML = ""; status.textContent = "검색 중…";
      }
      more.hidden = true;
      try {
        const { count, items } = await pubmedSearch(term, days, offset);
        total = count; offset += items.length;
        list.insertAdjacentHTML("beforeend", items.map(paperItem).join(""));
        translateIn(list);
        status.textContent = total ? `총 ${total.toLocaleString()}건 중 ${offset}건 표시` : "검색 결과가 없습니다.";
        more.hidden = offset >= total;
      } catch (err) {
        if (!reset) { status.textContent = "더 불러오지 못했습니다."; return; }
        try {
          const items = await snapshotPapers();
          list.innerHTML = items.map(paperItem).join("");
          status.textContent = "PubMed 실시간 검색에 실패해 저장된 최신 논문 목록을 표시합니다.";
        } catch {
          status.textContent = "논문을 불러오지 못했습니다. 잠시 후 다시 시도하세요.";
        }
      }
    }

    form.addEventListener("submit", e => { e.preventDefault(); load(true); });
    more.addEventListener("click", () => load(false));
    load(true);
  }

  async function initHome() {
    const ul = $("#home-papers");
    bindAbstracts(ul);
    let items;
    try { items = (await pubmedSearch("lymphoma[tiab] OR lymphoma[mh]", 14)).items; }
    catch { try { items = await snapshotPapers(); } catch { items = []; } }
    ul.innerHTML = items.length ? items.slice(0, 5).map(paperItem).join("")
      : "<li class='muted'>논문을 불러오지 못했습니다.</li>";
    translateIn(ul);
  }

  // ---------- 뉴스·임상 ----------
  function initNews() {
    let news = [], trials = [];
    const list = $("#news-list"), tUl = $("#trials-ul");
    const search = $("#news-search"), lang = $("#news-lang"), korea = $("#trials-korea");

    const matches = (text, q) => !q || text.toLowerCase().includes(q.toLowerCase());

    function renderNews() {
      const q = search.value.trim(), l = lang.value;
      const rows = news.filter(n => (l === "all" || n.lang === l) && matches(`${n.title} ${n.title_ko || ""} ${n.source || ""}`, q));
      list.innerHTML = rows.length ? rows.map(n => `
        <li class="item">
          <a class="title" href="${esc(n.link)}" target="_blank" rel="noopener">${n.lang === "ko" ? esc(n.title) : bilingual(n.title, n.title_ko)}</a>
          <div class="meta"><span class="badge">${esc(n.topic || "뉴스")}</span><span>${esc(n.source || "")}</span><span>${fmtDate(n.date)}</span></div>
        </li>`).join("")
        : `<li class="muted">${news.length ? "조건에 맞는 뉴스가 없습니다." : "수집된 뉴스가 아직 없습니다. GitHub Actions의 데이터 갱신 작업이 실행되면 표시됩니다."}</li>`;
      translateIn(list);
    }

    function renderTrials() {
      const q = search.value.trim();
      const rows = trials.filter(t => (!korea.checked || t.korea) && matches(`${t.title} ${t.title_ko || ""} ${t.interventions.join(" ")} ${t.sponsor}`, q));
      tUl.innerHTML = rows.length ? rows.map(t => `
        <li class="item">
          <a class="title" href="https://clinicaltrials.gov/study/${esc(t.nct)}" target="_blank" rel="noopener">${bilingual(t.title, t.title_ko)}</a>
          <div class="meta">
            ${t.phase ? `<span class="badge">${esc(t.phase)}</span>` : ""}
            <span>${esc(t.nct)}</span><span>${esc(t.sponsor)}</span>
            ${t.korea ? '<span class="badge kr">국내 기관</span>' : ""}
            <span>업데이트 ${esc(t.updated)}</span>
          </div>
          ${t.interventions.length ? `<p class="small">치료: ${esc(t.interventions.slice(0, 4).join(", "))}</p>` : ""}
        </li>`).join("")
        : "<li class='muted'>조건에 맞는 임상시험이 없습니다.</li>";
      translateIn(tUl);
    }

    $$(".tab").forEach(tab => tab.addEventListener("click", () => {
      $$(".tab").forEach(t => t.classList.toggle("active", t === tab));
      list.hidden = tab.dataset.tab !== "news-list";
      $("#trials-list").hidden = tab.dataset.tab !== "trials-list";
      lang.hidden = tab.dataset.tab !== "news-list";
    }));
    search.addEventListener("input", () => { renderNews(); renderTrials(); });
    lang.addEventListener("change", renderNews);
    korea.addEventListener("change", renderTrials);

    list.innerHTML = "<li class='muted'>불러오는 중…</li>";
    getJSON("data/news.json").then(d => {
      news = d.items || [];
      if (d.updated) $("#news-updated").textContent = "마지막 갱신: " + fmtDate(d.updated);
    }).catch(() => {}).finally(renderNews);

    tUl.innerHTML = "<li class='muted'>불러오는 중…</li>";
    loadTrials().then(t => { trials = t; }).catch(() => {}).finally(renderTrials);
  }

  function parseStudy(s) {
    const p = s.protocolSection || {};
    const countries = (p.contactsLocationsModule?.locations || []).map(l => l.country);
    return {
      nct: p.identificationModule?.nctId,
      title: p.identificationModule?.briefTitle,
      phase: (p.designModule?.phases || []).filter(x => x !== "NA").join("/").replace(/PHASE/g, "Phase "),
      sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name || "",
      interventions: [...new Set((p.armsInterventionsModule?.interventions || []).map(i => i.name))],
      korea: countries.includes("Korea, Republic of"),
      updated: p.statusModule?.lastUpdatePostDateStruct?.date || ""
    };
  }

  // ClinicalTrials.gov 실시간 조회, 실패 시 스냅샷
  async function loadTrials() {
    try {
      const params = new URLSearchParams({
        "query.cond": "lymphoma", "filter.overallStatus": "RECRUITING",
        sort: "LastUpdatePostDate:desc", pageSize: 100, format: "json"
      });
      const d = await getJSON(CTGOV + "?" + params);
      return (d.studies || []).map(parseStudy);
    } catch {
      return (await getJSON("data/trials.json")).items || [];
    }
  }

  $("#tr-toggle").addEventListener("click", () => setTranslation(!trOn));
  setTranslation(trOn);
  route();
})();

(() => {
  "use strict";

  // ---------- 유틸 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $("#app");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const plain = (r) => r.replace(/_/g, ""); // 읽기에서 조사 표시 제거

  // ---------- 가나 → 로마자 ----------
  const KS = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉゔ";
  const KR = "a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa o n ga gi gu ge go za ji zu ze zo da ji zu de do ba bi bu be bo pa pi pu pe po a i u e o vu".split(" ");
  const BASE = {}; [...KS].forEach((k, i) => (BASE[k] = KR[i]));
  const SMALL_Y = { "ゃ": "a", "ゅ": "u", "ょ": "o" };
  const SMALL_V = { "ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o" };
  const PUNCT = { "。": ". ", "、": ", ", "？": "? ", "！": "! ", "　": " ", " ": " " };
  const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  function romaji(reading) {
    const s = toHira(reading);
    let out = "", sokuon = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i], n = s[i + 1];
      if (c === "_") { // 조사 は/へ
        if (n === "は") { out += "wa"; i++; continue; }
        if (n === "へ") { out += "e"; i++; continue; }
        continue;
      }
      if (c === "っ") { sokuon = true; continue; }
      if (c === "ー") { const m = out.match(/[aiueo](?=[^aiueo]*$)/); if (m) out += m[0]; continue; }
      let rom = BASE[c];
      if (rom === undefined) { out += PUNCT[c] ?? c; sokuon = false; continue; }
      if (SMALL_Y[n] && rom.endsWith("i") && rom.length > 1) {
        rom = ["shi", "chi", "ji"].includes(rom) ? rom.slice(0, -1) + SMALL_Y[n] : rom.slice(0, -1) + "y" + SMALL_Y[n];
        i++;
      } else if (SMALL_V[n] && c !== n) {
        rom = (rom.length > 1 ? rom.slice(0, -1) : "w") + SMALL_V[n];
        i++;
      }
      if (sokuon) { rom = (rom.startsWith("ch") ? "t" : rom[0]) + rom; sokuon = false; }
      out += rom;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  // ---------- 저장소 ----------
  const KEY = "nihongo-step-v1";
  const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD
  let S = { kana: {}, known: {}, dialogs: {}, days: [], prefs: { r: true, ro: false, ko: true } };
  try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(S, JSON.parse(raw)); } catch (e) { /* 저장소 사용 불가 */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 무시 */ } };
  if (!S.days.includes(today())) { S.days.push(today()); S.days = S.days.slice(-400); save(); }

  function streak() {
    const set = new Set(S.days);
    let n = 0; const d = new Date();
    while (set.has(d.toLocaleDateString("sv-SE"))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // ---------- 음성 (TTS) ----------
  let jaVoice = null, speakId = 0;
  const slowBox = $("#slow");
  slowBox.checked = !!S.prefs.slow;
  slowBox.addEventListener("change", () => { S.prefs.slow = slowBox.checked; save(); });
  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    const vs = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
    jaVoice = vs.find((v) => /Google|Kyoko|O-ren|Nanami|Haruka/i.test(v.name)) || vs[0] || null;
  }
  if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

  function speak(text, onend) {
    const id = ++speakId;
    let fired = false;
    const done = () => { if (fired || id !== speakId) return; fired = true; onend && onend(); };
    if (!("speechSynthesis" in window)) { setTimeout(done, 600); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    if (jaVoice) u.voice = jaVoice;
    u.rate = S.prefs.slow ? 0.65 : 0.95;
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
    // 일부 브라우저에서 onend가 오지 않는 경우 대비
    setTimeout(done, Math.max(2000, text.length * (S.prefs.slow ? 420 : 280)) + 1500);
  }
  const stopSpeak = () => { speakId++; if ("speechSynthesis" in window) speechSynthesis.cancel(); };

  // ---------- 음성 인식 (말하기 연습) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const normJa = (s) => toHira(plain(s)).replace(/[\s。、，,．.！!？?「」・ー〜~]/g, "");
  function similarity(a, b) {
    a = normJa(a); b = normJa(b);
    if (!a.length && !b.length) return 1;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
  }
  function listen(btn, line, outEl, onPass) {
    if (!SR) { outEl.innerHTML = `<span class="muted">이 브라우저는 음성 인식을 지원하지 않아요. Chrome이나 Safari를 사용해 보세요.</span>`; return; }
    stopSpeak();
    const rec = new SR();
    rec.lang = "ja-JP"; rec.interimResults = false; rec.maxAlternatives = 3;
    btn.classList.add("mic-on");
    outEl.innerHTML = `<span class="muted">듣고 있어요… 문장을 말해 보세요.</span>`;
    rec.onresult = (e) => {
      const alts = [...e.results[0]].map((a) => a.transcript);
      let best = { t: alts[0], s: 0 };
      alts.forEach((t) => { const s = Math.max(similarity(t, line.jp), similarity(t, line.r)); if (s > best.s) best = { t, s }; });
      const pct = Math.round(best.s * 100);
      const msg = pct >= 85 ? "완벽해요! 🎉" : pct >= 60 ? "좋아요! 👍" : "다시 한 번 해볼까요?";
      outEl.innerHTML = `<span class="jp">「${esc(best.t)}」</span> → <b>${pct}점</b> ${msg}`;
      if (pct >= 60 && onPass) onPass();
    };
    rec.onerror = (e) => {
      outEl.innerHTML = `<span class="muted">${e.error === "not-allowed" ? "마이크 권한을 허용해 주세요." : e.error === "no-speech" ? "소리가 들리지 않았어요." : "인식 오류: " + esc(e.error)}</span>`;
    };
    rec.onend = () => btn.classList.remove("mic-on");
    try { rec.start(); } catch (e) { btn.classList.remove("mic-on"); }
  }

  // ---------- 데이터 준비 ----------
  const kanaItems = (set, script) => KANA_ROWS[set].map((k) => k && { ch: script === "h" ? k[0] : k[1], hira: k[0], ko: k[2], ro: k[0] === "を" ? "o (wo)" : romaji(k[0]) });
  const kanaKey = (script, ch) => `${script}:${ch}`;
  const isMastered = (script, ch) => (S.kana[kanaKey(script, ch)] || 0) >= 3;
  const allWords = VOCAB.flatMap((c) => c.words);
  const allLines = DIALOGS.flatMap((d) => d.lines.map((l) => ({ ...l, did: d.id })));

  // ---------- 화면: 홈 ----------
  function viewHome() {
    const basicCount = KANA_ROWS.basic.filter(Boolean).length;
    const hm = KANA_ROWS.basic.filter((k) => k && isMastered("h", k[0])).length;
    const km = KANA_ROWS.basic.filter((k) => k && isMastered("k", k[1])).length;
    const kw = allWords.filter((w) => S.known[w.jp]).length;
    const dd = DIALOGS.filter((d) => S.dialogs[d.id]).length;
    const dayIdx = Math.floor(Date.now() / 86400000);
    const line = allLines[dayIdx % allLines.length];
    const stat = (num, total, lbl) => `<div class="card stat"><div class="num">${num}<span class="muted small"> / ${total}</span></div><div class="lbl">${lbl}</div><div class="bar"><i style="width:${Math.round((num / total) * 100)}%"></i></div></div>`;
    app.innerHTML = `
      <div class="hero">
        <h1>일본어, 매일 한 걸음</h1>
        <p class="lead" style="margin:0">문자부터 실전 회화까지. 듣고, 고르고, 직접 말해 보세요.</p>
        <p style="margin:12px 0 0">🔥 연속 학습 <b>${streak()}일</b></p>
      </div>
      <div class="stats">
        ${stat(hm, basicCount, "히라가나 익힘")}
        ${stat(km, basicCount, "가타카나 익힘")}
        ${stat(kw, allWords.length, "아는 단어")}
        ${stat(dd, DIALOGS.length, "회화 완료")}
      </div>
      <h2>오늘의 문장</h2>
      <div class="card today">
        <div>
          <div class="jp jp-big">${esc(line.jp)}</div>
          <div class="muted small jp">${esc(plain(line.r))}</div>
          <div class="muted small">${esc(romaji(line.r))}</div>
          <div>${esc(line.ko)}</div>
        </div>
        <div class="row">
          <button class="btn" id="today-play">🔊 듣기</button>
          <button class="btn" id="today-mic">🎤 따라 말하기</button>
        </div>
        <div id="today-out" class="mic-result" style="flex-basis:100%"></div>
      </div>
      <h2>학습하기</h2>
      <div class="grid">
        <a class="card link-card" href="#kana"><div class="ico">あ</div><h3>문자</h3><p>히라가나·가타카나 표와 퀴즈</p></a>
        <a class="card link-card" href="#vocab"><div class="ico">📚</div><h3>단어</h3><p>주제별 ${allWords.length}개 단어, 플래시카드</p></a>
        <a class="card link-card" href="#talk"><div class="ico">💬</div><h3>회화</h3><p>상황별 대화 ${DIALOGS.length}편 롤플레이</p></a>
        <a class="card link-card" href="#grammar"><div class="ico">✏️</div><h3>문법</h3><p>꼭 필요한 기초 문형 ${GRAMMAR.length}가지</p></a>
      </div>
      <p style="margin-top:28px"><button class="btn small" id="reset">학습 기록 초기화</button></p>`;
    $("#today-play").onclick = () => speak(line.jp);
    $("#today-mic").onclick = (e) => listen(e.currentTarget, line, $("#today-out"));
    $("#reset").onclick = () => {
      if (!confirm("모든 학습 기록을 지울까요?")) return;
      S.kana = {}; S.known = {}; S.dialogs = {}; S.days = [today()]; save(); viewHome();
    };
  }

  // ---------- 화면: 문자 ----------
  const K = { script: "h", set: "basic", mode: "table", quiz: null };
  function viewKana() {
    const tabs = (name, opts, cur) => `<div class="tabs" data-tab="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${l}</button>`).join("")}</div>`;
    app.innerHTML = `
      <h1>문자</h1>
      <p class="lead">글자를 누르면 발음이 나와요. 퀴즈에서 3번 연속 맞히면 '익힘'(초록색)으로 표시됩니다.</p>
      ${tabs("script", [["h", "히라가나"], ["k", "가타카나"]], K.script)}
      ${tabs("set", [["basic", "기본 (청음)"], ["voiced", "탁음·반탁음"], ["combo", "요음"]], K.set)}
      ${tabs("mode", [["table", "📋 글자표"], ["read", "👀 보고 맞히기"], ["listen", "👂 듣고 맞히기"]], K.mode)}
      <div id="kana-body"></div>`;
    app.querySelectorAll(".tabs").forEach((t) => t.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      K[t.dataset.tab] = b.dataset.v; K.quiz = null; viewKana();
    }));
    const body = $("#kana-body");
    const items = kanaItems(K.set, K.script);
    if (K.mode === "table") {
      body.innerHTML = `<div class="kana-grid ${K.set === "combo" ? "combo" : ""}">${items.map((k) => k
        ? `<div class="kana-cell ${isMastered(K.script, k.ch) ? "mastered" : ""}"><button data-ch="${k.ch}" aria-label="${k.ch} 발음 듣기"><div class="ch">${k.ch}</div><div class="ro">${k.ro} · ${k.ko}</div></button></div>`
        : `<div class="kana-cell empty"></div>`).join("")}</div>`;
      body.addEventListener("click", (e) => { const b = e.target.closest("button[data-ch]"); if (b) speak(b.dataset.ch); });
    } else {
      kanaQuiz(body, items.filter(Boolean));
    }
  }

  function kanaQuiz(body, pool) {
    const q = K.quiz || (K.quiz = { right: 0, total: 0 });
    const weighted = pool.flatMap((k) => Array(isMastered(K.script, k.ch) ? 1 : 4).fill(k));
    let target = pick(weighted);
    if (q.last && pool.length > 1) while (target.ch === q.last) target = pick(weighted);
    q.last = target.ch;
    const others = shuffle(pool.filter((k) => k.ro !== target.ro)).slice(0, 3);
    const opts = shuffle([target, ...others]);
    const listenMode = K.mode === "listen";
    body.innerHTML = `
      <div class="card quiz">
        <div class="q">${listenMode ? `<button class="btn" id="replay" style="font-size:22px">🔊 다시 듣기</button>` : esc(target.ch)}</div>
        <div class="qsub">${listenMode ? "들리는 글자를 고르세요" : "이 글자의 발음은?"}</div>
        <div class="choices">${opts.map((o) => `<button data-ch="${o.ch}">${listenMode ? `<span class="jp" style="font-size:26px">${o.ch}</span>` : `${o.ro} <span class="muted small">${o.ko}</span>`}</button>`).join("")}</div>
        <div class="score">정답 ${q.right} / ${q.total}</div>
      </div>`;
    if (listenMode) { speak(target.ch); $("#replay").onclick = () => speak(target.ch); }
    body.querySelector(".choices").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const k = kanaKey(K.script, target.ch);
      const ok = b.dataset.ch === target.ch;
      q.total++;
      body.querySelectorAll(".choices button").forEach((x) => { x.disabled = true; if (x.dataset.ch === target.ch) x.classList.add("right"); });
      if (ok) { q.right++; S.kana[k] = (S.kana[k] || 0) + 1; } else { b.classList.add("wrong"); S.kana[k] = 0; }
      save();
      if (!listenMode) speak(target.ch);
      setTimeout(() => { if (body.isConnected && K.quiz === q) kanaQuiz(body, pool); }, ok ? 800 : 1800);
    };
  }

  // ---------- 화면: 단어 ----------
  const V = { cat: VOCAB[0].id, mode: "list", idx: 0, flip: false, order: null, quiz: null };
  function viewVocab() {
    const cat = VOCAB.find((c) => c.id === V.cat);
    const known = cat.words.filter((w) => S.known[w.jp]).length;
    app.innerHTML = `
      <h1>단어</h1>
      <p class="lead">주제를 고르고 목록·플래시카드·퀴즈로 익혀 보세요. 퀴즈에서 맞힌 단어는 '아는 단어'로 체크됩니다.</p>
      <div class="tabs" id="cats">${VOCAB.map((c) => `<button data-v="${c.id}" class="${c.id === V.cat ? "on" : ""}">${c.icon} ${c.title}</button>`).join("")}</div>
      <div class="tabs" id="vmode">${[["list", "📋 목록"], ["flash", "🃏 플래시카드"], ["quiz", "❓ 뜻 맞히기"]].map(([v, l]) => `<button data-v="${v}" class="${v === V.mode ? "on" : ""}">${l}</button>`).join("")}
        <span class="pill ok" style="align-self:center">${known} / ${cat.words.length} 암기</span></div>
      <div id="vbody"></div>`;
    $("#cats").onclick = (e) => { const b = e.target.closest("button"); if (b) { V.cat = b.dataset.v; V.idx = 0; V.flip = false; V.order = null; V.quiz = null; viewVocab(); } };
    $("#vmode").onclick = (e) => { const b = e.target.closest("button"); if (b) { V.mode = b.dataset.v; V.idx = 0; V.flip = false; V.quiz = null; viewVocab(); } };
    const body = $("#vbody");
    if (V.mode === "list") {
      body.innerHTML = `<div class="word-list">${cat.words.map((w, i) => `
        <div class="word ${S.known[w.jp] ? "known" : ""}">
          <button class="icon-btn" data-play="${i}" aria-label="듣기">🔊</button>
          <div class="w-main"><div class="w-jp">${esc(w.jp)}</div><div class="w-r jp">${esc(plain(w.r))} · ${esc(romaji(w.r))}</div><div class="w-ko">${esc(w.ko)}</div></div>
          <button class="check" data-known="${i}" aria-label="아는 단어로 표시">✓</button>
        </div>`).join("")}</div>`;
      body.onclick = (e) => {
        const p = e.target.closest("[data-play]"); if (p) return speak(cat.words[p.dataset.play].jp);
        const k = e.target.closest("[data-known]");
        if (k) { const w = cat.words[k.dataset.known]; S.known[w.jp] = !S.known[w.jp]; save(); viewVocab(); }
      };
    } else if (V.mode === "flash") {
      const order = V.order || (V.order = cat.words.map((_, i) => i));
      const w = cat.words[order[V.idx % order.length]];
      body.innerHTML = `
        <div class="flash">
          <div class="card flash-card" id="fc" role="button" tabindex="0" aria-label="카드 뒤집기">
            ${V.flip
              ? `<div class="back"><div class="front jp" style="font-size:32px">${esc(w.jp)}</div><div class="w-r">${esc(plain(w.r))}</div><div class="muted small">${esc(romaji(w.r))}</div><div class="w-ko">${esc(w.ko)}</div></div>`
              : `<div><div class="front">${esc(w.jp)}</div><div class="muted small">눌러서 뜻 보기</div></div>`}
          </div>
          <div class="row" style="justify-content:center;margin-top:12px">
            <button class="btn" id="fprev">◀</button>
            <button class="btn" id="fplay">🔊</button>
            <span class="muted small">${(V.idx % order.length) + 1} / ${order.length}</span>
            <button class="btn" id="fshuf">🔀 섞기</button>
            <button class="btn" id="fnext">▶</button>
          </div>
          <div class="row" style="justify-content:center;margin-top:10px">
            <button class="btn" id="fagain">다시 볼래요</button>
            <button class="btn primary" id="fknow">${S.known[w.jp] ? "✓ 알아요" : "알아요"}</button>
          </div>
        </div>`;
      const go = (d) => { V.idx = (V.idx + d + order.length) % order.length; V.flip = false; viewVocab(); };
      const flip = () => { V.flip = !V.flip; if (V.flip) speak(w.jp); viewVocab(); };
      $("#fc").onclick = flip;
      $("#fc").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } };
      $("#fprev").onclick = () => go(-1);
      $("#fnext").onclick = () => go(1);
      $("#fplay").onclick = () => speak(w.jp);
      $("#fshuf").onclick = () => { V.order = shuffle(order); V.idx = 0; V.flip = false; viewVocab(); };
      $("#fagain").onclick = () => { S.known[w.jp] = false; save(); go(1); };
      $("#fknow").onclick = () => { S.known[w.jp] = true; save(); go(1); };
    } else {
      vocabQuiz(body, cat);
    }
  }

  function vocabQuiz(body, cat) {
    const q = V.quiz || (V.quiz = { right: 0, total: 0 });
    const pool = cat.words.filter((w) => !S.known[w.jp]);
    let target = pick(pool.length ? pool : cat.words);
    if (q.last && cat.words.length > 1) while (target.jp === q.last) target = pick(pool.length > 1 ? pool : cat.words);
    q.last = target.jp;
    const opts = shuffle([target, ...shuffle(cat.words.filter((w) => w !== target)).slice(0, 3)]);
    body.innerHTML = `
      <div class="card quiz">
        <div class="q word">${esc(target.jp)}</div>
        <div class="qsub jp">${esc(plain(target.r))}</div>
        <div class="choices">${opts.map((o) => `<button data-jp="${esc(o.jp)}">${esc(o.ko)}</button>`).join("")}</div>
        <div class="score">정답 ${q.right} / ${q.total}${pool.length ? "" : " · 이 주제는 모두 암기했어요! 🎉"}</div>
      </div>`;
    speak(target.jp);
    body.querySelector(".choices").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const ok = b.dataset.jp === target.jp;
      q.total++;
      body.querySelectorAll(".choices button").forEach((x) => { x.disabled = true; if (x.dataset.jp === target.jp) x.classList.add("right"); });
      if (ok) { q.right++; S.known[target.jp] = true; save(); } else b.classList.add("wrong");
      setTimeout(() => { if (location.hash.startsWith("#vocab") && V.mode === "quiz") viewVocab(); }, ok ? 900 : 1800);
    };
  }

  // ---------- 화면: 회화 ----------
  let rp = null; // 롤플레이 상태
  function bubble(line, d, i, withTools = true) {
    const who = d.roles[line.s];
    return `<div class="msg ${line.s}">
      <div class="who">${esc(who)}</div>
      <div class="bubble">
        <div class="b-jp">${esc(line.jp)}</div>
        <div class="b-r jp">${esc(plain(line.r))}</div>
        <div class="b-ro">${esc(romaji(line.r))}</div>
        <div class="b-ko">${esc(line.ko)}</div>
        ${withTools ? `<div class="tools"><button class="icon-btn" data-play="${i}" aria-label="듣기">🔊</button><button class="icon-btn" data-mic="${i}" aria-label="따라 말하기">🎤</button></div><div class="mic-result" data-out="${i}"></div>` : ""}
      </div></div>`;
  }

  function viewTalk(id, mode) {
    stopSpeak();
    const d = DIALOGS.find((x) => x.id === id);
    if (!d) {
      app.innerHTML = `
        <h1>회화</h1>
        <p class="lead">상황을 골라 대화를 듣고, 롤플레이에서 '나'의 대사를 직접 골라 보거나 말해 보세요.</p>
        <div class="grid">${DIALOGS.map((x) => `
          <a class="card link-card" href="#talk/${x.id}">
            <div class="ico">${x.icon}</div><h3>${esc(x.title)}</h3>
            <p>${x.lines.length}문장 · <span class="pill">${x.level}</span> ${S.dialogs[x.id] ? `<span class="pill ok">완료</span>` : ""}</p>
          </a>`).join("")}</div>`;
      return;
    }
    const isRp = mode === "rp";
    const P = S.prefs;
    app.innerHTML = `
      <p><a href="#talk" class="muted">← 회화 목록</a></p>
      <h1>${d.icon} ${esc(d.title)}</h1>
      <div class="tabs">
        <button data-go="#talk/${d.id}" class="${isRp ? "" : "on"}">📖 대화 보기</button>
        <button data-go="#talk/${d.id}/rp" class="${isRp ? "on" : ""}">🎭 롤플레이</button>
      </div>
      <div class="toggles">
        <label><input type="checkbox" data-pref="r" ${P.r ? "checked" : ""}> 읽는 법</label>
        <label><input type="checkbox" data-pref="ro" ${P.ro ? "checked" : ""}> 로마자</label>
        <label><input type="checkbox" data-pref="ko" ${P.ko ? "checked" : ""}> 번역</label>
        ${isRp ? "" : `<button class="btn small" id="playall">▶ 전체 듣기</button>`}
      </div>
      <div class="chat" id="chat"></div>
      <div id="talk-extra"></div>`;
    app.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => { location.hash = b.dataset.go; });
    const chat = $("#chat");
    const applyPrefs = () => { chat.classList.toggle("hide-r", !P.r); chat.classList.toggle("hide-ro", !P.ro); chat.classList.toggle("hide-ko", !P.ko); };
    applyPrefs();
    app.querySelectorAll("[data-pref]").forEach((cb) => cb.onchange = () => { P[cb.dataset.pref] = cb.checked; save(); applyPrefs(); });
    chat.onclick = (e) => {
      const p = e.target.closest("[data-play]"); if (p) return speak(d.lines[p.dataset.play].jp);
      const m = e.target.closest("[data-mic]");
      if (m) { const i = m.dataset.mic; listen(m, d.lines[i], chat.querySelector(`[data-out="${i}"]`)); }
    };

    if (!isRp) {
      chat.innerHTML = d.lines.map((l, i) => bubble(l, d, i)).join("");
      $("#playall").onclick = () => {
        let i = 0;
        const next = () => { if (i >= d.lines.length || !location.hash.startsWith(`#talk/${d.id}`)) return; const l = d.lines[i++]; speak(l.jp, () => setTimeout(next, 350)); };
        next();
      };
      return;
    }

    // 롤플레이
    rp = { d, idx: 0, token: Symbol() };
    const extra = $("#talk-extra");
    const myToken = rp.token;
    const alive = () => rp && rp.token === myToken && location.hash === `#talk/${d.id}/rp`;
    const step = () => {
      if (!alive()) return;
      chat.innerHTML = d.lines.slice(0, rp.idx).map((l, i) => bubble(l, d, i)).join("");
      if (rp.idx >= d.lines.length) {
        S.dialogs[d.id] = true; save();
        extra.innerHTML = `<div class="done">🎉 대화 완료! 잘했어요.<div class="row" style="justify-content:center;margin-top:10px"><button class="btn" id="again">다시 하기</button><a class="btn" href="#talk">다른 상황</a></div></div>`;
        $("#again").onclick = () => { rp.idx = 0; extra.innerHTML = ""; step(); };
        return;
      }
      const line = d.lines[rp.idx];
      if (line.s === "A") {
        extra.innerHTML = `<p class="muted small">${esc(d.roles.A)}이(가) 말하고 있어요… <button class="btn small" id="skip">건너뛰기 ▶</button></p>`;
        chat.insertAdjacentHTML("beforeend", bubble(line, d, rp.idx));
        chat.lastElementChild.scrollIntoView({ block: "nearest", behavior: "smooth" });
        const adv = () => { if (!alive() || d.lines[rp.idx] !== line) return; rp.idx++; step(); };
        $("#skip").onclick = () => { stopSpeak(); adv(); };
        speak(line.jp, () => setTimeout(adv, 400));
        return;
      }
      // 내 차례
      const distract = shuffle(allLines.filter((l) => l.s === "B" && l.jp !== line.jp && l.did !== d.id)).slice(0, 2);
      const opts = shuffle([line, ...distract]);
      extra.innerHTML = `
        <div class="reply">
          <div><b>내 차례</b> — 이렇게 말하고 싶어요: <b>${esc(line.ko)}</b></div>
          <div class="reply-opts">${opts.map((o, i) => `<button data-o="${i}"><span class="o-jp">${esc(o.jp)}</span></button>`).join("")}</div>
          <div class="row" style="margin-top:10px">
            <button class="btn" id="say">🎤 직접 말하기</button>
            <button class="btn" id="hint">💡 정답 듣기</button>
          </div>
          <div class="mic-result" id="say-out"></div>
        </div>`;
      extra.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const accept = () => {
        extra.innerHTML = "";
        chat.insertAdjacentHTML("beforeend", bubble(line, d, rp.idx));
        speak(line.jp, () => setTimeout(() => { if (alive() && d.lines[rp.idx] === line) { rp.idx++; step(); } }, 300));
      };
      extra.querySelector(".reply-opts").onclick = (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (opts[b.dataset.o] === line) accept();
        else { b.classList.remove("wrong"); void b.offsetWidth; b.classList.add("wrong"); }
      };
      $("#hint").onclick = () => speak(line.jp);
      $("#say").onclick = (e) => listen(e.currentTarget, line, $("#say-out"), () => setTimeout(accept, 900));
    };
    step();
  }

  // ---------- 화면: 문법 ----------
  function viewGrammar() {
    app.innerHTML = `
      <h1>기초 문법</h1>
      <p class="lead">회화에 바로 쓰이는 핵심 문형입니다. 예문을 듣고 따라 말해 보세요.</p>
      ${GRAMMAR.map((g, gi) => `
        <div class="card gram">
          <h3>${esc(g.title)}</h3>
          <div class="g-sub">${esc(g.sub)}</div>
          <p>${esc(g.body)}</p>
          ${g.ex.map((x, xi) => `
            <div class="ex">
              <button class="icon-btn" data-g="${gi}-${xi}" aria-label="듣기">🔊</button>
              <div><div class="e-jp">${esc(x.jp)}</div><div class="e-r jp">${esc(plain(x.r))} · ${esc(romaji(x.r))}</div><div class="e-ko">${esc(x.ko)}</div></div>
            </div>`).join("")}
        </div>`).join("")}`;
    app.onclick = (e) => {
      const b = e.target.closest("[data-g]"); if (!b) return;
      const [gi, xi] = b.dataset.g.split("-"); speak(GRAMMAR[gi].ex[xi].jp);
    };
  }

  // ---------- 라우터 ----------
  function route() {
    const [name, arg, arg2] = (location.hash.slice(1) || "home").split("/");
    app.onclick = null;
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
    stopSpeak();
    ({ home: viewHome, kana: viewKana, vocab: viewVocab, talk: () => viewTalk(arg, arg2), grammar: viewGrammar }[name] || viewHome)();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  route();

  // 테스트용 노출
  window.__nihongo = { romaji };
})();

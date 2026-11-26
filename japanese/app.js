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
  let S = { kana: {}, known: {}, dialogs: {}, listen: {}, kanji: {}, verb: {}, days: [], prefs: { r: true, ro: false, ko: true } };
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

  // ---------- 따라 말하기 (음성 인식 / 받아쓰기 / 녹음 비교) ----------
  // 사용 가능한 방식을 순서대로 고릅니다.
  //  1) dict: Claude Artifact의 받아쓰기 기능 (Artifact로 열었을 때)
  //  2) sr:   브라우저 음성 인식 (Chrome·Edge·Safari)
  //  3) rec:  마이크 녹음 후 원어민 음성과 비교 듣기 (그 밖의 브라우저)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let dict = null, srBroken = false, session = null;
  try {
    const p = window.claude && window.claude.use && window.claude.use("dictation");
    if (p && p.then) p.then((d) => {
      if (!d) return;
      dict = d;
      d.onPartial(({ text }) => session && session.partial && session.partial(text));
      d.onFinal(({ text }) => session && session.final && session.final(text));
      d.onState(({ state, reason }) => session && session.state && session.state(state, reason));
    }).catch(() => {});
  } catch (e) { /* Artifact 밖에서는 없음 */ }
  // 마이크를 못 쓸 때 원인별 안내
  const PUBLIC_URL = "https://kayjo81.github.io/lymphoma/japanese/";
  const inClaude = !!window.claude;                       // Claude 앱·Artifact 안
  const inApp = /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  function micHelp(errName) {
    const tag = errName ? ` <span class="small">(${esc(errName)})</span>` : "";
    if (inClaude) return `Claude 앱 화면 안에서는 마이크를 쓸 수 없어요. <a href="${PUBLIC_URL}" target="_blank" rel="noopener">공개 주소</a>를 Safari나 Chrome에서 열어 주세요.` + tag;
    if (inApp) return "카카오톡·네이버 같은 앱 안의 브라우저에서는 마이크가 막혀 있어요. 오른쪽 위(또는 아래) 메뉴에서 <b>'다른 브라우저로 열기'</b>를 눌러 Safari나 Chrome으로 열어 주세요." + tag;
    if (errName === "") return "이 브라우저는 음성 인식과 녹음을 지원하지 않아요. Safari나 Chrome 최신 버전에서 열어 주세요.";
    if (errName === "NotFoundError" || errName === "OverconstrainedError") return "이 기기에서 마이크를 찾지 못했어요. 이어폰 마이크나 블루투스 연결을 확인해 주세요." + tag;
    if (errName === "NotReadableError" || errName === "AbortError") return "다른 앱(통화, 녹음, 화상회의 등)이 마이크를 쓰고 있어요. 그 앱을 닫고 다시 시도해 주세요." + tag;
    if (errName === "SecurityError" || errName === "TypeError" || !window.isSecureContext) return `이 주소에서는 마이크를 쓸 수 없어요. <a href="${PUBLIC_URL}" target="_blank" rel="noopener">공개 주소(https)</a>로 열어 주세요.` + tag;
    return (isIOS
      ? "마이크가 차단돼 있어요. 주소창의 <b>aA</b> → 웹 사이트 설정 → 마이크를 '허용'으로 바꾸거나, 설정 앱 → Safari → 마이크에서 허용해 주세요."
      : "마이크가 차단돼 있어요. 주소창 왼쪽의 🔒(사이트 설정) → 마이크를 '허용'으로 바꾼 뒤 다시 눌러 주세요.") + tag;
  }
  const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const engine = () => (dict ? "dict" : SR && !srBroken ? "sr" : canRecord() ? "rec" : null);

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
  const note = (t) => `<span class="muted">${t}</span>`;
  const live = (t) => `<span class="muted">듣는 중: </span><span class="jp">${esc(t)}</span>`;

  function showScore(outEl, alts, line, onPass) {
    let best = { t: alts[0], s: 0 };
    alts.forEach((t) => { const s = Math.max(similarity(t, line.jp), similarity(t, line.r)); if (s >= best.s) best = { t, s }; });
    const pct = Math.round(best.s * 100);
    const msg = pct >= 85 ? "완벽해요! 🎉" : pct >= 60 ? "좋아요! 👍" : "🔊로 다시 듣고 한 번 더 해볼까요?";
    outEl.innerHTML = `<span class="jp">「${esc(best.t)}」</span> → <b>${pct}점</b> ${msg}`;
    if (pct >= 60 && onPass) onPass();
  }

  // 버튼 하나로 시작/끝. 같은 버튼을 다시 누르면 멈추고 결과를 봅니다.
  function listen(btn, line, outEl, onPass) {
    if (session) { const same = session.btn === btn; session.stop(); if (same) return; }
    stopSpeak();
    const eng = engine();
    if (!eng) { outEl.innerHTML = note(micHelp("")); return; }
    ({ dict: listenDict, sr: listenSR, rec: listenRec })[eng](btn, line, outEl, onPass);
  }

  const DICT_MSG = {
    not_granted: "받아쓰기 권한이 꺼져 있어요. 페이지의 권한 메뉴에서 켤 수 있어요.",
    dismissed: "권한 요청이 닫혔어요. 🎤를 다시 누르면 다시 물어봐요.",
    unavailable: "이 환경에서는 일본어 받아쓰기를 쓸 수 없어요.",
    rate_limited: "잠시 후 다시 시도해 주세요.",
    upstream_error: "마이크나 음성 인식에 문제가 생겼어요. 다시 시도해 주세요.",
  };
  function listenDict(btn, line, outEl, onPass) {
    const s = { btn, text: "", done: false, err: false };
    session = s;
    let quiet, hardStop;
    const finish = () => {
      if (s.done) return; s.done = true;
      clearTimeout(quiet); clearTimeout(hardStop);
      btn.classList.remove("mic-on");
      if (session === s) session = null;
      const t = s.text.trim();
      if (t) showScore(outEl, [t], line, onPass);
      else if (!s.err) outEl.innerHTML = note("소리가 들리지 않았어요. 🎤를 눌러 다시 말해 보세요.");
    };
    const fail = (code) => {
      s.err = true;
      outEl.innerHTML = note(DICT_MSG[code] || DICT_MSG.upstream_error);
      if (code === "unavailable" || code === "not_granted") dict = null; // 다음엔 다른 방식 시도
      finish();
    };
    s.partial = (t) => { if (t) { clearTimeout(quiet); outEl.innerHTML = live(s.text + t); } };
    s.final = (t) => { s.text += t; outEl.innerHTML = live(s.text); clearTimeout(quiet); quiet = setTimeout(() => dict && dict.stop(), 1400); };
    s.state = (st, reason) => {
      if (st === "listening") outEl.innerHTML = note("듣고 있어요… 따라 말해 보세요. (다시 누르면 끝)");
      if (st === "idle") { if (reason && reason !== "stopped" && reason !== "viewer_stopped" && reason !== "hidden") fail(reason); else finish(); }
    };
    s.stop = () => { dict ? dict.stop().catch(() => {}) : finish(); };
    btn.classList.add("mic-on");
    outEl.innerHTML = note("마이크 준비 중…");
    hardStop = setTimeout(() => dict && dict.stop(), 15000);
    dict.start({ language: "ja" }).catch((e) => { if (e && e.code !== "stopped") fail(e.code); else finish(); });
  }

  const SR_FATAL = ["service-not-allowed", "network", "audio-capture", "language-not-supported", "bad-grammar"];
  function listenSR(btn, line, outEl, onPass) {
    let rec;
    try { rec = new SR(); } catch (e) { srBroken = true; return listen(btn, line, outEl, onPass); }
    rec.lang = "ja-JP"; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
    const s = { btn, stop: () => { try { rec.stop(); } catch (e) { /* 이미 멈춤 */ } } };
    session = s;
    let finals = null, errored = false;
    rec.onresult = (e) => {
      let interim = "";
      for (const r of e.results) { if (r.isFinal) finals = [...r].map((a) => a.transcript); else interim += r[0].transcript; }
      if (!finals && interim) outEl.innerHTML = live(interim);
    };
    rec.onerror = (e) => {
      errored = true;
      if (SR_FATAL.includes(e.error)) {
        srBroken = true;
        outEl.innerHTML = canRecord()
          ? note("이 브라우저에서는 음성 인식이 안 돼서 <b>녹음 비교 모드</b>로 바꿨어요. 🎤를 다시 눌러 녹음해 보세요.")
          : note("이 브라우저에서는 음성 인식을 쓸 수 없어요.");
      } else if (e.error === "not-allowed") {
        if (inClaude && canRecord()) { srBroken = true; outEl.innerHTML = note("음성 인식이 막혀 있어 녹음 비교 모드로 바꿨어요. 🎤를 다시 눌러 보세요."); }
        else outEl.innerHTML = note(micHelp("not-allowed"));
      } else if (e.error === "no-speech") {
        outEl.innerHTML = note("소리가 들리지 않았어요. 🎤를 누르고 바로 말해 보세요.");
      } else if (e.error !== "aborted") {
        outEl.innerHTML = note("인식 오류가 났어요. 다시 시도해 주세요.");
      }
    };
    rec.onend = () => {
      btn.classList.remove("mic-on");
      if (session === s) session = null;
      if (finals) showScore(outEl, finals, line, onPass);
      else if (!errored) outEl.innerHTML = note("소리가 들리지 않았어요. 🎤를 누르고 바로 말해 보세요.");
    };
    btn.classList.add("mic-on");
    outEl.innerHTML = note("듣고 있어요… 따라 말해 보세요.");
    try { rec.start(); } catch (e) { btn.classList.remove("mic-on"); session = null; srBroken = true; listen(btn, line, outEl, onPass); }
  }

  function listenRec(btn, line, outEl, onPass) {
    const s = { btn, stopped: false };
    session = s;
    let mr = null, stream = null, maxT;
    const chunks = [];
    const cleanup = () => {
      clearTimeout(maxT);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      btn.classList.remove("mic-on");
      if (session === s) session = null;
    };
    s.stop = () => { s.stopped = true; if (mr && mr.state !== "inactive") mr.stop(); else cleanup(); };
    btn.classList.add("mic-on");
    outEl.innerHTML = note("마이크 준비 중…");
    navigator.mediaDevices.getUserMedia({ audio: true }).then((st) => {
      stream = st;
      if (s.stopped) return cleanup();
      mr = new MediaRecorder(st);
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        cleanup();
        if (!chunks.length) { outEl.innerHTML = note("녹음된 소리가 없어요. 다시 시도해 주세요."); return; }
        const audio = new Audio(URL.createObjectURL(new Blob(chunks, { type: mr.mimeType || "audio/webm" })));
        outEl.innerHTML = `
          <div class="muted small">녹음 비교 모드 · 두 소리를 번갈아 들어 보세요</div>
          <div class="row" style="margin-top:4px">
            <button class="btn small" data-cmp="model">🔊 원어민</button>
            <button class="btn small" data-cmp="mine">▶ 내 목소리</button>
            ${onPass ? `<button class="btn small primary" data-cmp="next">다음 ▶</button>` : ""}
          </div>`;
        const playMine = () => { stopSpeak(); audio.currentTime = 0; audio.play().catch(() => {}); };
        outEl.querySelector('[data-cmp="model"]').onclick = (e) => { e.stopPropagation(); audio.pause(); speak(line.jp); };
        outEl.querySelector('[data-cmp="mine"]').onclick = (e) => { e.stopPropagation(); playMine(); };
        const nx = outEl.querySelector('[data-cmp="next"]');
        if (nx) nx.onclick = (e) => { e.stopPropagation(); audio.pause(); onPass(); };
        speak(line.jp, () => setTimeout(playMine, 300)); // 원어민 → 내 목소리 순서로 자동 재생
      };
      mr.start();
      outEl.innerHTML = note("녹음 중… 다 말했으면 🎤를 다시 누르세요.");
      maxT = setTimeout(() => s.stop(), Math.max(6000, line.jp.length * 450));
    }).catch((err) => {
      cleanup();
      outEl.innerHTML = note(micHelp(err && err.name));
    });
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
    const ld = LISTENING.filter((x) => S.listen[x.id]).length;
    const kd = KANJI.filter((k) => kanjiKnown(k.ch)).length;
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
        ${stat(kd, KANJI.length, "외운 한자")}
        ${stat(kw, allWords.length, "아는 단어")}
        ${stat(dd, DIALOGS.length, "회화 완료")}
        ${stat(ld, LISTENING.length, "듣기 완료")}
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
        <a class="card link-card" href="#kana"><div class="ico jp">あ</div><h3>문자</h3><p>히라가나·가타카나 표와 퀴즈</p></a>
        <a class="card link-card" href="#kanji"><div class="ico jp">漢</div><h3>한자</h3><p>N5 기초 한자 ${KANJI.length}자, 한국 훈음과 함께</p></a>
        <a class="card link-card" href="#vocab"><div class="ico jp">語</div><h3>단어</h3><p>주제별 ${allWords.length}개 단어, 플래시카드</p></a>
        <a class="card link-card" href="#talk"><div class="ico jp">話</div><h3>회화</h3><p>여행 상황별 대화 ${DIALOGS.length}편 롤플레이</p></a>
        <a class="card link-card" href="#listen"><div class="ico jp">聞</div><h3>듣기</h3><p>길 안내·안내방송 ${LISTENING.length}편 듣고 맞히기</p></a>
        <a class="card link-card" href="#verb"><div class="ico jp">動</div><h3>동사 활용</h3><p>1·2·3그룹, ます·ない·て·た형 규칙과 퀴즈</p></a>
        <a class="card link-card" href="#grammar"><div class="ico jp">文</div><h3>문법</h3><p>꼭 필요한 기초 문형 ${GRAMMAR.length}가지</p></a>
      </div>
      <p style="margin-top:28px"><button class="btn small" id="reset">학습 기록 초기화</button></p>`;
    $("#today-play").onclick = () => speak(line.jp);
    $("#today-mic").onclick = (e) => listen(e.currentTarget, line, $("#today-out"));
    let armed = false;
    $("#reset").onclick = (e) => {
      if (!armed) { armed = true; e.currentTarget.textContent = "정말 지울까요? 한 번 더 누르면 초기화돼요"; return; }
      S.kana = {}; S.known = {}; S.dialogs = {}; S.listen = {}; S.kanji = {}; S.verb = {}; S.days = [today()]; save(); viewHome();
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
        <div class="q qword">${esc(target.jp)}</div>
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
        <p class="lead">공항부터 숙소·식당·쇼핑·관광, 문제가 생겼을 때까지 여행 순서대로 정리했어요. 상황을 골라 대화를 듣고, 롤플레이에서 '나'의 대사를 직접 골라 보거나 말해 보세요.</p>
        <div class="grid">${DIALOGS.map((x) => `
          <a class="card link-card" href="#talk-${x.id}">
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
        <button data-go="#talk-${d.id}" class="${isRp ? "" : "on"}">📖 대화 보기</button>
        <button data-go="#talk-${d.id}-rp" class="${isRp ? "on" : ""}">🎭 롤플레이</button>
      </div>
      <div class="toggles">
        <label><input type="checkbox" data-pref="r" ${P.r ? "checked" : ""}> 읽는 법</label>
        <label><input type="checkbox" data-pref="ro" ${P.ro ? "checked" : ""}> 로마자</label>
        <label><input type="checkbox" data-pref="ko" ${P.ko ? "checked" : ""}> 번역</label>
        ${isRp ? "" : `<button class="btn small" id="playall">▶ 전체 듣기</button>`}
      </div>
      <p class="muted small" style="margin:-6px 0 14px">🔊로 듣고 🎤를 눌러 따라 말해 보세요. 다 말하면 자동으로 채점돼요.</p>
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
        const next = () => { if (i >= d.lines.length || !location.hash.startsWith(`#talk-${d.id}`)) return; const l = d.lines[i++]; speak(l.jp, () => setTimeout(next, 350)); };
        next();
      };
      return;
    }

    // 롤플레이
    rp = { d, idx: 0, token: Symbol() };
    const extra = $("#talk-extra");
    const myToken = rp.token;
    const alive = () => rp && rp.token === myToken && location.hash === `#talk-${d.id}-rp`;
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

  // ---------- 화면: 듣기 ----------
  const chipOf = (c) => { const [jp, r] = c.split("|"); return { jp, r: r || jp }; };
  const chipHtml = (c, cls, attr) => `<button class="chip ${cls}" ${attr}><span class="jp">${esc(c.jp)}</span>${c.r !== c.jp ? `<small class="jp">${esc(c.r)}</small>` : ""}</button>`;
  const LS = { id: null, tab: "pick" };

  function playSeq(lines, statusEl) {
    let i = 0;
    const next = () => {
      if (!statusEl.isConnected) return;
      if (i >= lines.length) { statusEl.textContent = "끝까지 들었어요."; return; }
      statusEl.textContent = `재생 중… ${i + 1} / ${lines.length}`;
      const l = lines[i++];
      speak(l.say || l.jp, () => setTimeout(next, 500));
    };
    next();
  }

  function viewListen(id) {
    stopSpeak();
    const it = LISTENING.find((x) => x.id === id);
    if (!it) {
      app.innerHTML = `
        <h1>듣기</h1>
        <p class="lead">글자 없이 소리만 듣고 알아듣는 연습이에요. 들린 단어 찾기 → 순서대로 배열 → 내용 확인 순서로 해 보세요.</p>
        <div class="grid">${LISTENING.map((x) => `
          <a class="card link-card" href="#listen-${x.id}">
            <div class="ico">${x.icon}</div><h3>${esc(x.title)}</h3>
            <p>${x.lines.length}문장 · <span class="pill">${x.level}</span> ${S.listen[x.id] ? `<span class="pill ok">완료 ${S.listen[x.id].score}점</span>` : ""}</p>
          </a>`).join("")}</div>`;
      return;
    }
    if (LS.id !== id) Object.assign(LS, { id, tab: "pick", picked: new Set(), checked: false, pool: null, idx: 0, ord: null, answers: [] });
    const tabs = [["pick", "① 들린 단어 찾기"], ["order", "② 순서대로 배열"], ["quiz", "③ 내용 확인"], ["script", "④ 스크립트"]];
    app.innerHTML = `
      <p><a href="#listen" class="muted">← 듣기 목록</a></p>
      <h1>${it.icon} ${esc(it.title)}</h1>
      <p class="lead">${esc(it.desc)}</p>
      <div class="row" style="margin-bottom:16px">
        <button class="btn primary" id="lplay">▶ 전체 듣기</button>
        <span id="lstat" class="muted small">상단의 '느리게'를 켜면 천천히 들을 수 있어요.</span>
      </div>
      <div class="tabs" id="ltabs">${tabs.map(([v, l]) => `<button data-v="${v}" class="${v === LS.tab ? "on" : ""}">${l}</button>`).join("")}</div>
      <div id="lbody"></div>`;
    $("#lplay").onclick = () => playSeq(it.lines, $("#lstat"));
    $("#ltabs").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      LS.tab = b.dataset.v; viewListen(id);
      if (LS.tab === "order") speak(it.lines[LS.idx].say || it.lines[LS.idx].jp);
    };
    const body = $("#lbody");
    ({ pick: listenPick, order: listenOrder, quiz: listenQuiz, script: listenScript })[LS.tab](body, it);
  }

  function listenPick(body, it) {
    if (!LS.pool) LS.pool = shuffle([...it.keys.map((c) => ({ ...chipOf(c), key: true })), ...it.fakes.map((c) => ({ ...chipOf(c), key: false }))]);
    const P = LS.pool;
    let hit = 0, wrong = 0;
    const chips = P.map((c, i) => {
      const sel = LS.picked.has(i);
      let cls = sel ? "sel" : "";
      if (LS.checked) {
        if (c.key && sel) { cls = "hit"; hit++; }
        else if (c.key) cls = "miss";
        else if (sel) { cls = "bad"; wrong++; }
        else cls = "dim";
      }
      return chipHtml(c, cls, `data-i="${i}" ${LS.checked ? "disabled" : ""}`);
    }).join("");
    const total = it.keys.length;
    body.innerHTML = `
      <div class="card">
        <p style="margin-top:0">'전체 듣기'를 누르고 <b>들린 단어를 모두</b> 고르세요. 들리지 않은 단어도 섞여 있어요. 몇 번이든 다시 들어도 돼요.</p>
        <div class="chips">${chips}</div>
        ${LS.checked ? `
          <div class="result">
            <b>찾은 단어 ${hit} / ${total}</b>${wrong ? ` · 잘못 고른 단어 ${wrong}개` : ""}
            <div class="small muted" style="margin-top:4px"><span class="legend hit">초록</span> 맞힘 · <span class="legend miss">점선</span> 놓친 단어 · <span class="legend bad">빨강</span> 나오지 않은 단어</div>
            ${hit === total && !wrong ? `<div style="margin-top:6px">🎉 완벽해요! 다음은 순서대로 배열해 볼까요?</div>` : `<div style="margin-top:6px">놓친 단어를 떠올리며 한 번 더 들어 보세요.</div>`}
          </div>
          <div class="row" style="margin-top:12px"><button class="btn" id="pagain">다시 하기</button><button class="btn primary" id="pnext">② 순서대로 배열 ▶</button></div>`
        : `<div class="row" style="margin-top:12px"><button class="btn primary" id="pcheck" ${LS.picked.size ? "" : "disabled"}>확인</button><span class="muted small">${LS.picked.size}개 선택</span></div>`}
      </div>`;
    body.querySelector(".chips").onclick = (e) => {
      const b = e.target.closest("[data-i]"); if (!b || LS.checked) return;
      const i = +b.dataset.i; LS.picked.has(i) ? LS.picked.delete(i) : LS.picked.add(i);
      listenPick(body, it);
    };
    const ck = $("#pcheck"); if (ck) ck.onclick = () => { LS.checked = true; listenPick(body, it); };
    const ag = $("#pagain"); if (ag) ag.onclick = () => { LS.checked = false; LS.picked = new Set(); LS.pool = null; listenPick(body, it); };
    const nx = $("#pnext"); if (nx) nx.onclick = () => { LS.tab = "order"; viewListen(it.id); speak(it.lines[LS.idx].say || it.lines[LS.idx].jp); };
  }

  function listenOrder(body, it) {
    const line = it.lines[LS.idx];
    const parts = line.w.map(chipOf);
    if (!LS.ord) {
      let pool = parts.map((_, i) => i);
      if (pool.length > 1) do { pool = shuffle(pool); } while (pool.every((v, i) => v === i));
      LS.ord = { pool, ans: [], checked: false };
    }
    const O = LS.ord;
    const ok = O.checked && O.ans.every((v, i) => parts[v].jp === parts[i].jp);
    const say = line.say || line.jp;
    body.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <b>문장 ${LS.idx + 1} / ${it.lines.length}</b>
          <div class="row"><button class="btn small" id="oplay">🔊 듣기</button><button class="btn small" id="oslow">🐢 천천히</button></div>
        </div>
        <p class="muted small">들은 순서대로 아래 어구를 눌러 문장을 완성하세요. 올린 어구를 다시 누르면 내려가요.</p>
        <div class="answer ${O.checked ? (ok ? "good" : "nogood") : ""}">${O.ans.length
          ? O.ans.map((v, i) => chipHtml(parts[v], O.checked && !ok && parts[v].jp !== parts[i].jp ? "bad" : O.checked && ok ? "hit" : "", `data-a="${i}"`)).join("")
          : `<span class="muted small">여기에 순서대로 쌓여요</span>`}</div>
        <div class="chips" style="margin-top:10px">${O.pool.map((v) => chipHtml(parts[v], "", `data-p="${v}"`)).join("")}</div>
        ${ok ? `
          <div class="result good-box">
            <div class="jp" style="font-size:18px">${esc(line.jp)}</div>
            <div class="muted small jp">${esc(plain(line.r))}</div>
            <div>${esc(line.ko)}</div>
          </div>
          <div class="row" style="margin-top:12px">${LS.idx + 1 < it.lines.length
            ? `<button class="btn primary" id="onext">다음 문장 ▶</button>`
            : `<span>🎉 모든 문장을 맞혔어요!</span><button class="btn primary" id="oquiz">③ 내용 확인 ▶</button>`}</div>`
        : `
          ${O.checked ? `<p class="small" style="color:var(--bad)">빨간 어구의 위치가 달라요. 다시 듣고 고쳐 보세요.</p>` : ""}
          <div class="row" style="margin-top:12px">
            <button class="btn primary" id="ocheck" ${O.pool.length ? "disabled" : ""}>확인</button>
            <button class="btn" id="oreset">처음부터</button>
            <button class="btn" id="ohint">💡 힌트 (뜻 보기)</button>
          </div>
          <div id="ohintbox" class="muted small" style="margin-top:8px"></div>`}
      </div>`;
    const rerender = () => listenOrder(body, it);
    $("#oplay").onclick = () => speak(say);
    $("#oslow").onclick = () => { const was = S.prefs.slow; S.prefs.slow = true; speak(say); S.prefs.slow = was; };
    body.querySelector(".chips").onclick = (e) => {
      const b = e.target.closest("[data-p]"); if (!b || ok) return;
      const v = +b.dataset.p; O.pool.splice(O.pool.indexOf(v), 1); O.ans.push(v); O.checked = false; rerender();
    };
    body.querySelector(".answer").onclick = (e) => {
      const b = e.target.closest("[data-a]"); if (!b || ok) return;
      const [v] = O.ans.splice(+b.dataset.a, 1); O.pool.push(v); O.checked = false; rerender();
    };
    const ck = $("#ocheck"); if (ck) ck.onclick = () => { O.checked = true; rerender(); if (O.ans.every((v, i) => parts[v].jp === parts[i].jp)) speak(say); };
    const rs = $("#oreset"); if (rs) rs.onclick = () => { O.pool = O.pool.concat(O.ans); O.ans = []; O.checked = false; rerender(); };
    const hn = $("#ohint"); if (hn) hn.onclick = () => { $("#ohintbox").textContent = "뜻: " + line.ko; };
    const nx = $("#onext"); if (nx) nx.onclick = () => { LS.idx++; LS.ord = null; rerender(); speak(it.lines[LS.idx].say || it.lines[LS.idx].jp); };
    const qz = $("#oquiz"); if (qz) qz.onclick = () => { LS.tab = "quiz"; viewListen(it.id); };
  }

  function listenQuiz(body, it) {
    const A = LS.answers;
    const done = it.quiz.every((_, i) => A[i] !== undefined);
    const right = it.quiz.filter((q, i) => A[i] === q.a).length;
    body.innerHTML = `
      <div class="card">
        <p style="margin-top:0">'전체 듣기'로 다시 들으면서 답해 보세요.</p>
        ${it.quiz.map((q, qi) => `
          <div class="lq">
            <div><b>Q${qi + 1}.</b> ${esc(q.q)}</div>
            <div class="row" style="margin-top:6px">${q.o.map((o, oi) => {
              const ans = A[qi] !== undefined;
              const cls = !ans ? "" : oi === q.a ? "right" : oi === A[qi] ? "wrong" : "";
              return `<button class="opt ${cls}" data-q="${qi}" data-o="${oi}" ${ans ? "disabled" : ""}>${esc(o)}</button>`;
            }).join("")}</div>
          </div>`).join("")}
        ${done ? `
          <div class="result"><b>${right} / ${it.quiz.length} 정답</b> ${right === it.quiz.length ? "🎉 다 알아들었어요!" : "· 틀린 문제는 스크립트에서 확인해 보세요."}</div>
          <div class="row" style="margin-top:12px"><button class="btn" id="qagain">다시 풀기</button><button class="btn primary" id="qscript">④ 스크립트 보기 ▶</button></div>` : ""}
      </div>`;
    body.onclick = (e) => {
      const b = e.target.closest("[data-q]"); if (!b) return;
      A[+b.dataset.q] = +b.dataset.o;
      if (it.quiz.every((_, i) => A[i] !== undefined)) {
        const sc = Math.round((it.quiz.filter((q, i) => A[i] === q.a).length / it.quiz.length) * 100);
        S.listen[it.id] = { score: Math.max(sc, (S.listen[it.id] || {}).score || 0) }; save();
      }
      listenQuiz(body, it);
    };
    const ag = $("#qagain"); if (ag) ag.onclick = (e) => { e.stopPropagation(); LS.answers = []; listenQuiz(body, it); };
    const sc = $("#qscript"); if (sc) sc.onclick = (e) => { e.stopPropagation(); LS.tab = "script"; viewListen(it.id); };
  }

  function listenScript(body, it) {
    body.innerHTML = `
      <div class="card">
        <p style="margin-top:0" class="muted small">원문을 보면서 들어 보고, 🎤로 따라 말해 보세요.</p>
        ${it.lines.map((l, i) => `
          <div class="ex">
            <div class="row" style="flex-direction:column;gap:2px">
              <button class="icon-btn" data-sp="${i}" aria-label="듣기">🔊</button>
              <button class="icon-btn" data-mi="${i}" aria-label="따라 말하기">🎤</button>
            </div>
            <div style="min-width:0">
              <div class="e-jp">${esc(l.jp)}</div>
              <div class="e-r jp">${esc(plain(l.r))}</div>
              <div class="e-r">${esc(romaji(l.r))}</div>
              <div class="e-ko">${esc(l.ko)}</div>
              <div class="mic-result" data-mo="${i}"></div>
            </div>
          </div>`).join("")}
      </div>`;
    body.onclick = (e) => {
      const p = e.target.closest("[data-sp]"); if (p) return speak(it.lines[p.dataset.sp].say || it.lines[p.dataset.sp].jp);
      const m = e.target.closest("[data-mi]");
      if (m) { const i = m.dataset.mi; listen(m, it.lines[i], body.querySelector(`[data-mo="${i}"]`)); }
    };
  }

  // ---------- 한자 ----------
  const KANJI = KANJI_GROUPS.flatMap((g) => g.list.map(([ch, hun, on, kun, strokes, ex]) => ({
    ch, hun, on, kun, strokes, gid: g.id,
    ex: ex.split(";").map((w) => { const [jp, r, ko] = w.split("|"); return { jp, r, ko }; }),
  })));
  const KANJI_WORDS = KANJI.flatMap((k) => k.ex.map((w) => ({ ...w, ch: k.ch, gid: k.gid })));
  const kanjiLevel = (ch) => S.kanji[ch] || 0;
  const kanjiKnown = (ch) => kanjiLevel(ch) >= 3;
  const KJ = { group: "all", mode: "table", sel: null, quiz: null };

  function viewKanji() {
    const groupTabs = [["all", "전체"], ...KANJI_GROUPS.map((g) => [g.id, g.title])];
    const known = KANJI.filter((k) => kanjiKnown(k.ch)).length;
    app.innerHTML = `
      <h1>한자</h1>
      <p class="lead">JLPT N5 기초 한자 ${KANJI.length}자. 한국 한자음(훈음)과 함께 외우면 음독이 쉽게 연결돼요. 예: 日 <b>날 일</b> → ニチ. 퀴즈에서 3번 맞히거나 '외웠어요'를 누르면 초록색이 돼요.</p>
      <div class="tabs" id="kjmode">${[["table", "📋 한자표"], ["read", "📖 단어 읽기 퀴즈"], ["mean", "🈯 훈음 맞히기"]].map(([v, l]) => `<button data-v="${v}" class="${v === KJ.mode ? "on" : ""}">${l}</button>`).join("")}
        <span class="pill ok" style="align-self:center">${known} / ${KANJI.length} 외움</span></div>
      <div class="tabs" id="kjgroup">${groupTabs.map(([v, l]) => `<button data-v="${v}" class="${v === KJ.group ? "on" : ""}">${l}</button>`).join("")}</div>
      <div id="kjbody"></div>`;
    $("#kjmode").onclick = (e) => { const b = e.target.closest("button"); if (b) { KJ.mode = b.dataset.v; KJ.quiz = null; viewKanji(); } };
    $("#kjgroup").onclick = (e) => { const b = e.target.closest("button"); if (b) { KJ.group = b.dataset.v; KJ.sel = null; KJ.quiz = null; viewKanji(); } };
    const body = $("#kjbody");
    const list = KANJI.filter((k) => KJ.group === "all" || k.gid === KJ.group);
    if (KJ.mode === "table") kanjiTable(body, list);
    else kanjiQuiz(body, list);
  }

  function kanjiCard(k, list) {
    const i = list.indexOf(k);
    return `
      <div class="card kcard" id="kcard">
        <div class="kc-top">
          <div class="kc-big jp">${k.ch}</div>
          <div class="kc-info">
            <div class="kc-hun">${esc(k.hun)}</div>
            <dl>
              <dt>음독</dt><dd class="jp">${esc(k.on)}</dd>
              <dt>훈독</dt><dd class="jp">${esc(k.kun)}</dd>
              <dt>획수</dt><dd>${k.strokes}획</dd>
            </dl>
          </div>
        </div>
        <div class="kc-ex">${k.ex.map((w, wi) => `
          <div class="ex">
            <button class="icon-btn" data-kw="${wi}" aria-label="듣기">🔊</button>
            <div><span class="e-jp">${esc(w.jp)}</span> <span class="e-r jp">${esc(w.r)}</span> <span class="e-ko">· ${esc(w.ko)}</span></div>
          </div>`).join("")}</div>
        <div class="row" style="justify-content:space-between;margin-top:10px">
          <div class="row">
            <button class="btn small" id="kprev" ${i <= 0 ? "disabled" : ""}>◀ 이전</button>
            <button class="btn small" id="knext" ${i >= list.length - 1 ? "disabled" : ""}>다음 ▶</button>
          </div>
          <div class="row">
            <button class="btn small" id="kclose">닫기</button>
            <button class="btn small ${kanjiKnown(k.ch) ? "" : "primary"}" id="kknow">${kanjiKnown(k.ch) ? "✓ 외웠어요 (취소)" : "외웠어요"}</button>
          </div>
        </div>
      </div>`;
  }

  function kanjiTable(body, list) {
    const sel = list.find((k) => k.ch === KJ.sel);
    body.innerHTML = `
      ${sel ? kanjiCard(sel, list) : ""}
      <div class="kgrid">${list.map((k) => `
        <button class="ktile ${kanjiKnown(k.ch) ? "known" : ""} ${sel === k ? "cur" : ""}" data-k="${k.ch}">
          <span class="jp kt-ch">${k.ch}</span><span class="kt-hun">${esc(k.hun)}</span>
        </button>`).join("")}</div>`;
    const rerender = (scroll) => { kanjiTable(body, list); if (scroll && $("#kcard")) $("#kcard").scrollIntoView({ block: "start", behavior: "smooth" }); };
    body.querySelector(".kgrid").onclick = (e) => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      KJ.sel = b.dataset.k; rerender(true);
      const k = list.find((x) => x.ch === KJ.sel); speak(k.ex[0].r);
    };
    if (!sel) return;
    body.querySelector(".kc-ex").onclick = (e) => { const b = e.target.closest("[data-kw]"); if (b) speak(sel.ex[+b.dataset.kw].r); };
    const go = (d) => { const i = list.indexOf(sel) + d; KJ.sel = list[i].ch; rerender(false); speak(list[i].ex[0].r); };
    $("#kprev").onclick = () => go(-1);
    $("#knext").onclick = () => go(1);
    $("#kclose").onclick = () => { KJ.sel = null; rerender(false); };
    $("#kknow").onclick = () => { S.kanji[sel.ch] = kanjiKnown(sel.ch) ? 0 : 3; save(); viewKanji(); if ($("#kcard")) $("#kcard").scrollIntoView({ block: "start" }); };
  }

  function kanjiQuiz(body, list) {
    const q = KJ.quiz || (KJ.quiz = { right: 0, total: 0 });
    const readMode = KJ.mode === "read";
    const weighted = list.flatMap((k) => Array(kanjiKnown(k.ch) ? 1 : 4).fill(k));
    let k = pick(weighted);
    if (q.last && list.length > 1) while (k.ch === q.last) k = pick(weighted);
    q.last = k.ch;
    let prompt, sub, opts, answer;
    if (readMode) {
      const w = pick(k.ex);
      const pool = KANJI_WORDS.filter((x) => x.r !== w.r);
      const near = shuffle(pool.filter((x) => x.ch === k.ch || x.gid === k.gid));
      const wrong = [...new Set([...near, ...shuffle(pool)].map((x) => x.r))].slice(0, 3);
      prompt = w.jp; sub = "읽는 법은?"; answer = w.r;
      opts = shuffle([w.r, ...wrong]).map((r) => ({ v: r, label: `<span class="jp">${esc(r)}</span>` }));
      q.cur = { k, after: `${esc(w.jp)} <span class="jp">${esc(w.r)}</span> · ${esc(w.ko)}`, say: w.r };
    } else {
      const wrong = shuffle(KANJI.filter((x) => x !== k && x.hun !== k.hun)).slice(0, 3);
      prompt = k.ch; sub = "이 한자의 훈음(뜻과 음)은?"; answer = k.hun;
      opts = shuffle([k, ...wrong]).map((x) => ({ v: x.hun, label: esc(x.hun) }));
      q.cur = { k, after: `${k.ch} · ${esc(k.hun)} · 음독 <span class="jp">${esc(k.on)}</span> · 훈독 <span class="jp">${esc(k.kun)}</span>`, say: k.ex[0].r };
    }
    body.innerHTML = `
      <div class="card quiz">
        <div class="q ${readMode ? "qword" : ""}">${esc(prompt)}</div>
        <div class="qsub">${sub}</div>
        <div class="choices">${opts.map((o) => `<button data-v="${esc(o.v)}">${o.label}</button>`).join("")}</div>
        <div class="kq-after small" id="kqafter"></div>
        <div class="score">정답 ${q.right} / ${q.total}</div>
      </div>`;
    body.querySelector(".choices").onclick = (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      const ok = b.dataset.v === answer;
      q.total++;
      body.querySelectorAll(".choices button").forEach((x) => { x.disabled = true; if (x.dataset.v === answer) x.classList.add("right"); });
      if (ok) { q.right++; S.kanji[k.ch] = kanjiLevel(k.ch) + 1; } else { b.classList.add("wrong"); S.kanji[k.ch] = 0; }
      save();
      $("#kqafter").innerHTML = q.cur.after;
      speak(q.cur.say);
      setTimeout(() => { if (body.isConnected && KJ.quiz === q) kanjiQuiz(body, list); }, ok ? 1300 : 2600);
    };
  }

  // ---------- 동사 활용 ----------
  const ROW = { "う": "わいえお", "く": "かきけこ", "ぐ": "がぎげご", "す": "さしせそ", "つ": "たちてと", "ぬ": "なにねの", "ぶ": "ばびべぼ", "む": "まみめも", "る": "らりれろ" };
  const TE = { "う": "って", "つ": "って", "る": "って", "む": "んで", "ぶ": "んで", "ぬ": "んで", "く": "いて", "ぐ": "いで", "す": "して" };
  const I_ROW = "いきしちにひみりぎじびぴ", E_ROW = "えけせてねへめれげぜでべぺ";
  const FORMS = [
    { id: "dict", name: "사전형", ko: "기본형 (~하다)", rule: ["그대로", "그대로", "する・くる"] },
    { id: "masu", name: "ます형", ko: "정중형 (~합니다)", rule: ["う단 → い단 + ます", "る → ます", "します・きます"] },
    { id: "nai", name: "ない형", ko: "부정 (~하지 않다)", rule: ["う단 → あ단 + ない (う → わ)", "る → ない", "しない・こない"] },
    { id: "te", name: "て형", ko: "연결 (~하고, ~해서)", rule: ["음편: う・つ・る→って / む・ぶ・ぬ→んで / く→いて / ぐ→いで / す→して (예외 行く→行って)", "る → て", "して・きて"] },
    { id: "ta", name: "た형", ko: "과거 (~했다)", rule: ["て형의 て→た, で→だ (行く→行った)", "る → た", "した・きた"] },
    { id: "pot", name: "가능형", ko: "가능 (~할 수 있다)", rule: ["う단 → え단 + る", "る → られる", "できる・こられる"] },
    { id: "vol", name: "의지형", ko: "권유·의지 (~하자)", rule: ["う단 → お단 + う", "る → よう", "しよう・こよう"] },
  ];
  const IRR = {
    suru: { dict: "する", masu: "します", nai: "しない", te: "して", ta: "した", pot: "できる", vol: "しよう" },
    kuru: { dict: "くる", masu: "きます", nai: "こない", te: "きて", ta: "きた", pot: "こられる", vol: "こよう" },
  };
  const IRR_WRONG = {
    suru: { masu: ["すます"], nai: ["すない", "さない"], te: ["すって", "しって"], ta: ["すった"], pot: ["される", "すれる"], vol: ["すよう", "そう"] },
    kuru: { masu: ["くります", "こます"], nai: ["きない", "くない"], te: ["くって", "こって"], ta: ["くった", "こった"], pot: ["きられる", "くれる"], vol: ["きよう", "くろう"] },
  };
  const VB = VERBS.map(([jp, r, g, ko]) => ({ jp, r, g, ko }));
  const irrKind = (v) => (v.r.endsWith("くる") && v.jp.endsWith("来る") ? "kuru" : v.r.endsWith("する") ? "suru" : null);

  // 읽기(r)를 기준으로 활용하고, 표기는 앞부분(한자)을 그대로 붙입니다.
  function conjAs(v, form, g) {
    const kind = g === 3 ? irrKind(v) : null;
    if (kind) {
      const cut = 2, rr = IRR[kind][form];
      const jpHead = kind === "kuru" ? v.jp.slice(0, -2) + "来" : v.jp.slice(0, -2);
      return { r: v.r.slice(0, -cut) + rr, jp: kind === "kuru" ? jpHead + rr.slice(1) : jpHead + rr };
    }
    const last = v.r.slice(-1), rStem = v.r.slice(0, -1), jStem = v.jp.slice(0, -1);
    let tail;
    if (g === 2) {
      tail = { dict: "る", masu: "ます", nai: "ない", te: "て", ta: "た", pot: "られる", vol: "よう" }[form];
    } else {
      const row = ROW[last]; if (!row) return null;
      if (form === "dict") tail = last;
      else if (form === "masu") tail = row[1] + "ます";
      else if (form === "nai") tail = row[0] + "ない";
      else if (form === "pot") tail = row[2] + "る";
      else if (form === "vol") tail = row[3] + "う";
      else {
        let te = v.r === "いく" || v.r.endsWith("いく") && v.jp.endsWith("行く") ? "って" : TE[last];
        tail = form === "te" ? te : te.replace("て", "た").replace("で", "だ");
      }
    }
    return { r: rStem + tail, jp: jStem + tail };
  }
  const conj = (v, form) => conjAs(v, form, v.g);

  function groupWhy(v) {
    if (v.g === 3) return `${v.jp}: 불규칙 동사(3그룹)는 する·来る(くる)와 '명사+する' 뿐이에요.`;
    const last = v.r.slice(-1);
    if (last !== "る") return `${v.jp}: る로 끝나지 않으면 무조건 1그룹이에요. (${last}로 끝남)`;
    const prev = v.r.slice(-2, -1);
    const ie = I_ROW.includes(prev) ? "い단" : E_ROW.includes(prev) ? "え단" : null;
    if (!ie) return `${v.jp}: る 앞이 ${prev}(い단·え단이 아님)라서 1그룹이에요.`;
    if (v.g === 2) return `${v.jp}: る 앞이 ${prev}(${ie})라서 2그룹이에요.`;
    return `${v.jp}: る 앞이 ${prev}(${ie})라 2그룹처럼 보이지만 <b>예외 1그룹</b>이에요. 꼭 외워 두세요!`;
  }
  function conjWhy(v, form) {
    const f = FORMS.find((x) => x.id === form);
    const res = conj(v, form);
    return `${v.jp} → <b class="jp">${esc(res.jp)}</b> <span class="jp muted">(${esc(res.r)})</span><br>${v.g}그룹 ${f.name}: ${esc(f.rule[v.g - 1])}${v.g === 1 && v.r.endsWith("る") && (I_ROW.includes(v.r.slice(-2, -1)) || E_ROW.includes(v.r.slice(-2, -1))) ? " · 예외 1그룹이라 2그룹처럼 활용하지 않아요." : ""}`;
  }
  function conjWrongs(v, form) {
    const right = conj(v, form).r;
    const set = new Set();
    const kind = v.g === 3 ? irrKind(v) : null;
    if (kind) (IRR_WRONG[kind][form] || []).forEach((w) => set.add(v.r.slice(0, -2) + w));
    if (v.g === 1 && v.r.endsWith("る")) { const w = conjAs(v, form, 2); if (w) set.add(w.r); }
    if (v.g === 2 && form !== "pot") { const w = conjAs(v, form, 1); if (w) set.add(w.r); } // 가능형 食べれる(ら抜き)는 회화에서 쓰이므로 오답으로 내지 않음
    if (v.g === 1 && (form === "te" || form === "ta")) {
      const stem = v.r.slice(0, -1);
      ["って", "んで", "いて", "して"].forEach((t) => set.add(stem + (form === "te" ? t : t.replace("て", "た").replace("で", "だ"))));
    }
    if (v.g === 1 && form === "nai" && v.r.endsWith("う")) set.add(v.r.slice(0, -1) + "あない");
    FORMS.filter((f) => f.id !== form && f.id !== "dict").forEach((f) => set.add(conj(v, f.id).r));
    set.delete(right);
    const ordered = [...set];
    return [...ordered.slice(0, 2), ...shuffle(ordered.slice(2))].slice(0, 3);
  }

  const VS = { tab: "rule", sel: VB[5].jp, forms: new Set(["masu", "nai", "te", "ta"]), gq: null, cq: null };
  function viewVerb() {
    const tabs = [["rule", "① 규칙 정리"], ["table", "② 활용표"], ["group", "③ 그룹 맞히기"], ["conj", "④ 활용 연습"]];
    app.innerHTML = `
      <h1>동사 활용</h1>
      <p class="lead">일본어 동사는 1그룹(5단)·2그룹(1단)·3그룹(불규칙)으로 나눠 활용해요. 규칙을 보고, 활용표로 확인하고, 퀴즈로 손에 익혀 보세요.</p>
      <div class="tabs" id="vtabs">${tabs.map(([v, l]) => `<button data-v="${v}" class="${v === VS.tab ? "on" : ""}">${l}</button>`).join("")}</div>
      <div id="vbody2"></div>`;
    $("#vtabs").onclick = (e) => { const b = e.target.closest("button"); if (b) { VS.tab = b.dataset.v; viewVerb(); } };
    const body = $("#vbody2");
    ({ rule: verbRules, table: verbTable, group: verbGroupQuiz, conj: verbConjQuiz })[VS.tab](body);
  }

  function verbRules(body) {
    const exc = VB.filter((v) => v.g === 1 && v.r.endsWith("る") && (I_ROW.includes(v.r.slice(-2, -1)) || E_ROW.includes(v.r.slice(-2, -1))));
    const sample = [VB.find((v) => v.jp === "書く"), VB.find((v) => v.jp === "食べる"), VB.find((v) => v.jp === "する"), VB.find((v) => v.jp === "来る")];
    body.innerHTML = `
      <div class="card gram">
        <h3>그룹 나누는 법</h3>
        <ol class="steps">
          <li><b>する · 来る(くる)</b>, 그리고 <span class="jp">勉強する</span>처럼 '명사 + する' → <b>3그룹</b></li>
          <li><b>る로 끝나지 않으면</b> (う・く・ぐ・す・つ・ぬ・ぶ・む) → <b>1그룹</b></li>
          <li><b>る로 끝나고, 바로 앞 글자가 い단·え단</b>이면 (<span class="jp">た<u>べ</u>る, <u>み</u>る</span>) → <b>2그룹</b></li>
          <li>る 앞이 あ단·う단·お단이면 (<span class="jp">わ<u>か</u>る, <u>の</u>る</span>) → <b>1그룹</b></li>
        </ol>
        <p class="muted small">⚠️ 예외 1그룹: 생긴 건 2그룹인데 1그룹으로 활용하는 동사예요. 시험에 자주 나와요.</p>
        <div class="chips">${exc.map((v) => `<button class="chip" data-say="${esc(v.r)}"><span class="jp">${esc(v.jp)}</span><small class="jp">${esc(v.r)} · ${esc(v.ko)}</small></button>`).join("")}</div>
      </div>
      <div class="card gram">
        <h3>て형 음편 외우기</h3>
        <p>1그룹은 마지막 글자에 따라 て형이 바뀌어요. 소리 내어 외워 보세요.</p>
        <div class="te-song">
          <div><span class="jp">う・つ・る</span> → <b class="jp">って</b> <span class="muted jp">会って 待って 乗って</span></div>
          <div><span class="jp">む・ぶ・ぬ</span> → <b class="jp">んで</b> <span class="muted jp">飲んで 遊んで 死んで</span></div>
          <div><span class="jp">く</span> → <b class="jp">いて</b> <span class="muted jp">書いて 聞いて</span></div>
          <div><span class="jp">ぐ</span> → <b class="jp">いで</b> <span class="muted jp">泳いで 急いで</span></div>
          <div><span class="jp">す</span> → <b class="jp">して</b> <span class="muted jp">話して 貸して</span></div>
          <div>예외 <span class="jp">行く</span> → <b class="jp">行って</b> <span class="muted">(いいて ✕)</span></div>
        </div>
        <p class="muted small">た형은 て형에서 て→た, で→だ로만 바꾸면 돼요.</p>
      </div>
      <div class="card gram">
        <h3>활용 규칙표</h3>
        <div class="tbl-wrap"><table class="vtbl rules">
          <thead><tr><th>활용형</th><th>1그룹 (5단)</th><th>2그룹 (1단)</th><th>3그룹</th></tr></thead>
          <tbody>${FORMS.filter((f) => f.id !== "dict").map((f) => `
            <tr><th>${f.name}<div class="muted small">${f.ko}</div></th>
              <td data-g="1그룹">${esc(f.rule[0])}<div class="jp ex-c">${esc(conj(sample[0], f.id).jp)}</div></td>
              <td data-g="2그룹">${esc(f.rule[1])}<div class="jp ex-c">${esc(conj(sample[1], f.id).jp)}</div></td>
              <td data-g="3그룹">${esc(f.rule[2])}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="muted small">예시: 1그룹 <span class="jp">書く</span>, 2그룹 <span class="jp">食べる</span>. 2그룹 가능형은 회화에서 <span class="jp">食べれる</span>처럼 ら를 빼기도 해요(ら抜き言葉).</p>
      </div>`;
    body.onclick = (e) => { const b = e.target.closest("[data-say]"); if (b) speak(b.dataset.say); };
  }

  function verbTable(body) {
    const v = VB.find((x) => x.jp === VS.sel) || VB[0];
    const byG = [1, 2, 3].map((g) => VB.filter((x) => x.g === g));
    body.innerHTML = `
      <div class="card">
        ${byG.map((list, gi) => `
          <div class="muted small" style="margin:${gi ? "10px" : "0"} 0 6px">${gi + 1}그룹</div>
          <div class="chips">${list.map((x) => `<button class="chip ${x === v ? "sel" : ""}" data-v="${esc(x.jp)}"><span class="jp">${esc(x.jp)}</span></button>`).join("")}</div>`).join("")}
      </div>
      <div class="card" style="margin-top:12px">
        <div class="row" style="justify-content:space-between">
          <div><span class="jp" style="font-size:24px">${esc(v.jp)}</span> <span class="jp muted">${esc(v.r)}</span> · ${esc(v.ko)}</div>
          <span class="pill">${v.g}그룹</span>
        </div>
        <p class="small muted" style="margin:6px 0 0">${groupWhy(v)}</p>
        <div class="tbl-wrap"><table class="vtbl">
          <tbody>${FORMS.map((f) => { const c = conj(v, f.id); return `
            <tr><th>${f.name}<div class="muted small">${f.ko}</div></th>
              <td><div class="jp" style="font-size:18px">${esc(c.jp)}</div><div class="jp muted small">${esc(c.r)} · ${esc(romaji(c.r))}</div></td>
              <td style="width:44px"><button class="icon-btn" data-say="${esc(c.r)}" aria-label="듣기">🔊</button></td></tr>`; }).join("")}</tbody>
        </table></div>
      </div>`;
    body.onclick = (e) => {
      const s = e.target.closest("[data-say]"); if (s) return speak(s.dataset.say);
      const b = e.target.closest("[data-v]"); if (b) { VS.sel = b.dataset.v; verbTable(body); speak(VB.find((x) => x.jp === VS.sel).r); }
    };
  }

  function verbGroupQuiz(body) {
    const q = VS.gq || (VS.gq = { right: 0, total: 0, v: null, ans: null });
    if (!q.v || q.ans !== null && q.next) { let v = pick(VB); while (q.v && v === q.v) v = pick(VB); q.v = v; q.ans = null; q.next = false; }
    const v = q.v;
    body.innerHTML = `
      <div class="card quiz">
        <div class="q qword">${esc(v.jp)}</div>
        <div class="qsub jp">${esc(v.r)} · <span style="font-family:var(--font)">${esc(v.ko)}</span></div>
        <div class="choices" style="grid-template-columns:repeat(3,1fr)">${[1, 2, 3].map((g) => `<button data-g="${g}" class="${q.ans === null ? "" : g === v.g ? "right" : g === q.ans ? "wrong" : ""}" ${q.ans === null ? "" : "disabled"}>${g}그룹</button>`).join("")}</div>
        ${q.ans !== null ? `<div class="result" style="text-align:left">${groupWhy(v)}</div><div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="gnext">다음 ▶</button></div>` : ""}
        <div class="score">정답 ${q.right} / ${q.total}</div>
      </div>`;
    if (q.ans === null) speak(v.r);
    body.querySelector(".choices").onclick = (e) => {
      const b = e.target.closest("[data-g]"); if (!b || q.ans !== null) return;
      q.ans = +b.dataset.g; q.total++; if (q.ans === v.g) q.right++;
      S.verb.g = [(S.verb.g || [0, 0])[0] + (q.ans === v.g ? 1 : 0), (S.verb.g || [0, 0])[1] + 1]; save();
      verbGroupQuiz(body);
    };
    const nx = $("#gnext"); if (nx) nx.onclick = () => { q.next = true; verbGroupQuiz(body); };
  }

  function verbConjQuiz(body) {
    const q = VS.cq || (VS.cq = { right: 0, total: 0, cur: null, ans: null });
    const forms = FORMS.filter((f) => VS.forms.has(f.id));
    if (!q.cur || q.next) {
      let v = pick(VB); while (q.cur && v === q.cur.v) v = pick(VB);
      const f = pick(forms.length ? forms : FORMS.slice(1));
      const right = conj(v, f.id);
      q.cur = { v, f, right, opts: shuffle([right.r, ...conjWrongs(v, f.id)]) };
      q.ans = null; q.next = false;
    }
    const { v, f, right, opts } = q.cur;
    body.innerHTML = `
      <div class="card">
        <div class="muted small" style="margin-bottom:6px">연습할 활용형</div>
        <div class="chips" id="cforms">${FORMS.slice(1).map((x) => `<button class="chip ${VS.forms.has(x.id) ? "sel" : ""}" data-f="${x.id}">${x.name}</button>`).join("")}</div>
      </div>
      <div class="card quiz" style="margin-top:12px">
        <div class="qsub"><span class="pill">${esc(f.name)}</span> ${esc(f.ko)}로 바꾸면?</div>
        <div class="q qword">${esc(v.jp)}</div>
        <div class="qsub jp">${esc(v.r)} · <span style="font-family:var(--font)">${esc(v.ko)}</span></div>
        <div class="choices">${opts.map((o) => `<button data-o="${esc(o)}" class="jp ${q.ans === null ? "" : o === right.r ? "right" : o === q.ans ? "wrong" : ""}" ${q.ans === null ? "" : "disabled"}>${esc(o)}</button>`).join("")}</div>
        ${q.ans !== null ? `<div class="result" style="text-align:left">${conjWhy(v, f.id)}</div><div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="cnext">다음 ▶</button></div>` : ""}
        <div class="score">정답 ${q.right} / ${q.total}</div>
      </div>`;
    $("#cforms").onclick = (e) => {
      const b = e.target.closest("[data-f]"); if (!b) return;
      const id = b.dataset.f;
      if (VS.forms.has(id)) { if (VS.forms.size > 1) VS.forms.delete(id); } else VS.forms.add(id);
      q.next = true; verbConjQuiz(body);
    };
    body.querySelector(".choices").onclick = (e) => {
      const b = e.target.closest("[data-o]"); if (!b || q.ans !== null) return;
      q.ans = b.dataset.o; q.total++; const ok = q.ans === right.r; if (ok) q.right++;
      S.verb.c = [(S.verb.c || [0, 0])[0] + (ok ? 1 : 0), (S.verb.c || [0, 0])[1] + 1]; save();
      speak(right.r);
      verbConjQuiz(body);
    };
    const nx = $("#cnext"); if (nx) nx.onclick = () => { q.next = true; verbConjQuiz(body); };
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
    const [name, arg, arg2] = (location.hash.slice(1) || "home").split("-");
    app.onclick = null;
    if (session) session.stop();
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
    stopSpeak();
    ({ home: viewHome, kana: viewKana, vocab: viewVocab, talk: () => viewTalk(arg, arg2), listen: () => viewListen(arg), kanji: viewKanji, verb: viewVerb, grammar: viewGrammar }[name] || viewHome)();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  route();

  // 테스트용 노출
  window.__nihongo = { romaji, conj, conjWrongs, VB, FORMS };
})();

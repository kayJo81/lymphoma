// 질병 정보 정적 콘텐츠: 아형 카드와 신약 허가 타임라인
window.LYMPHOMA_TYPES = [
  {
    group: "hl", name: "고전적 호지킨 림프종", en: "Classic Hodgkin lymphoma (cHL)", pace: "치료 반응 좋음",
    desc: "리드-스턴버그 세포(CD30+, CD15+)가 특징. 20~30대와 노년층에 많고 종격동 침범이 흔합니다.",
    tx: "ABVD 또는 BV-AVD, 병기에 따라 방사선. 재발 시 브렌툭시맙 베도틴, PD-1 억제제, 자가이식."
  },
  {
    group: "hl", name: "결절성 림프구우세 림프종", en: "Nodular lymphocyte-predominant (NLPHL / NLPBL)", pace: "무통성",
    desc: "CD20 양성 LP세포가 특징. WHO 5판은 호지킨, ICC는 B세포 림프종(NLPBL)으로 분류합니다.",
    tx: "국소 병기는 방사선 단독, 진행 병기는 리툭시맙 기반 치료."
  },
  {
    group: "b", name: "미만성 거대 B세포 림프종", en: "Diffuse large B-cell lymphoma (DLBCL)", pace: "공격형",
    desc: "가장 흔한 비호지킨 림프종(약 30~40%). 세포기원(GCB/ABC)과 MYC·BCL2 재배열 여부에 따라 예후가 다릅니다.",
    tx: "R-CHOP 또는 Pola-R-CHP 6주기. 재발 시 CAR-T, 이중특이항체, 자가이식."
  },
  {
    group: "b", name: "고등급 B세포 림프종", en: "High-grade B-cell lymphoma (MYC/BCL2 재배열)", pace: "공격형",
    desc: "MYC와 BCL2 재배열이 함께 있는 '더블히트' 림프종 등. 중추신경계 재발 위험이 높습니다.",
    tx: "DA-EPOCH-R 등 강화 요법이 흔히 사용되며 임상시험 참여가 권장됩니다."
  },
  {
    group: "b", name: "여포성 림프종", en: "Follicular lymphoma (FL)", pace: "무통성",
    desc: "두 번째로 흔한 B세포 림프종. t(14;18) BCL2 재배열이 특징이며 서서히 진행하나 재발이 반복됩니다.",
    tx: "무증상 시 관찰, 치료 필요 시 BR·R-CHOP·오비누투주맙. 재발 시 이중특이항체, CAR-T."
  },
  {
    group: "b", name: "외투세포 림프종", en: "Mantle cell lymphoma (MCL)", pace: "대개 공격형",
    desc: "t(11;14)와 사이클린 D1 과발현이 특징. 고령 남성에 많고 위장관·골수 침범이 흔합니다.",
    tx: "젊은 환자는 고용량 시타라빈 포함 요법 후 자가이식, 고령은 BR. BTK 억제제가 핵심 약제."
  },
  {
    group: "b", name: "변연부 림프종 (MALT 포함)", en: "Marginal zone lymphoma (MZL)", pace: "무통성",
    desc: "위, 침샘, 안구 부속기 등 림프절 외 점막에서 흔히 발생. 위 MALT 림프종은 헬리코박터 감염과 관련됩니다.",
    tx: "위 MALT는 헬리코박터 제균 치료가 1차. 국소 병변은 방사선, 진행 시 리툭시맙 기반 치료."
  },
  {
    group: "b", name: "만성 림프구성 백혈병 / 소림프구성 림프종", en: "CLL / SLL", pace: "무통성",
    desc: "같은 질환이 혈액에 주로 있으면 CLL, 림프절에 주로 있으면 SLL. 서구에 흔하고 국내에선 드뭅니다.",
    tx: "BTK 억제제 지속 투여 또는 베네토클락스+오비누투주맙 기간 한정 치료."
  },
  {
    group: "b", name: "버킷 림프종", en: "Burkitt lymphoma", pace: "매우 공격형",
    desc: "MYC 재배열이 특징이며 증식 속도가 매우 빠릅니다. 소아·청년층에 상대적으로 많습니다.",
    tx: "고강도 단기 항암(CODOX-M/IVAC, DA-EPOCH-R 등)과 중추신경계 예방. 완치율이 높습니다."
  },
  {
    group: "b", name: "원발성 중추신경계 림프종", en: "Primary CNS lymphoma (PCNSL)", pace: "공격형",
    desc: "뇌, 척수, 눈, 뇌척수액에만 발생하는 거대 B세포 림프종.",
    tx: "고용량 메토트렉세이트 기반 유도 항암 후 자가이식 또는 방사선 공고 요법."
  },
  {
    group: "b", name: "원발성 종격동 거대 B세포 림프종", en: "Primary mediastinal LBCL (PMBL)", pace: "공격형",
    desc: "젊은 여성에 많은 종격동 종괴. 호지킨 림프종과 생물학적 특성을 일부 공유합니다.",
    tx: "DA-EPOCH-R 또는 R-CHOP(±방사선). 재발 시 PD-1 억제제가 효과적."
  },
  {
    group: "tnk", name: "말초 T세포 림프종, 비특이형", en: "PTCL, NOS", pace: "공격형",
    desc: "다른 T세포 아형으로 분류되지 않는 가장 흔한 말초 T세포 림프종.",
    tx: "CHOP 또는 CHOEP, 반응 시 자가이식 공고를 고려합니다."
  },
  {
    group: "tnk", name: "역형성 대세포 림프종", en: "Anaplastic large cell lymphoma (ALCL)", pace: "공격형",
    desc: "CD30이 강하게 발현. ALK 양성형은 젊은 층에 많고 예후가 상대적으로 좋습니다.",
    tx: "BV-CHP(브렌툭시맙 베도틴+CHP)가 표준 1차 치료."
  },
  {
    group: "tnk", name: "혈관면역모세포성 T세포 림프종", en: "Angioimmunoblastic TCL (AITL / nTFHL-AI)", pace: "공격형",
    desc: "여포보조 T세포 기원. 전신 림프절 비대, 피부 발진, 자가면역 현상이 동반되기 쉽습니다.",
    tx: "CHOP 계열 항암, 반응 시 자가이식 고려."
  },
  {
    group: "tnk", name: "림프절외 NK/T세포 림프종", en: "Extranodal NK/T-cell lymphoma (ENKTL)", pace: "공격형",
    desc: "EBV와 관련되며 주로 비강·코인두에 발생. 동아시아(국내 포함)에서 상대적으로 흔합니다.",
    tx: "국소 병기는 방사선과 L-아스파라기나제 포함 항암 병용, 진행 병기는 SMILE·P-GemOx 등."
  },
  {
    group: "tnk", name: "균상식육종 / 세자리 증후군", en: "Mycosis fungoides / Sézary syndrome", pace: "대개 무통성",
    desc: "피부에 발생하는 T세포 림프종. 반점→판→종양 순으로 수년에 걸쳐 진행하는 경우가 많습니다.",
    tx: "피부 표적 치료(스테로이드, 광선치료), 진행 시 모가물리주맙·브렌툭시맙 베도틴 등 전신 치료."
  }
];

// 미국 FDA 허가 기준 주요 이정표. 연·월 단위로 표기
window.DRUG_TIMELINE = [
  { date: "2017.10", drug: "악시캅타진 실로류셀 (Yescarta)", note: "재발/불응성 거대 B세포 림프종 최초의 CAR-T 허가" },
  { date: "2018.03", drug: "브렌툭시맙 베도틴 + AVD", note: "진행 병기 고전적 호지킨 림프종 1차 치료" },
  { date: "2019.06", drug: "폴라투주맙 베도틴 (Polivy)", note: "재발/불응성 DLBCL, 벤다무스틴·리툭시맙 병용" },
  { date: "2021.02", drug: "리소캅타진 마라류셀 (Breyanzi)", note: "재발/불응성 거대 B세포 림프종 CAR-T" },
  { date: "2022.04", drug: "악시캅타진 실로류셀 2차 치료", note: "1차 치료 후 12개월 이내 재발한 LBCL에서 2차 치료로 확대" },
  { date: "2022.12", drug: "모수네투주맙 (Lunsumio)", note: "재발/불응성 여포성 림프종, 최초의 CD20×CD3 이중특이항체" },
  { date: "2023.01", drug: "피르토브루티닙 (Jaypirca)", note: "BTK 억제제 치료 후 재발한 외투세포 림프종, 비공유결합형 BTK 억제제" },
  { date: "2023.04", drug: "Pola-R-CHP", note: "미만성 거대 B세포 림프종 1차 치료" },
  { date: "2023.05", drug: "엡코리타맙 (Epkinly)", note: "재발/불응성 DLBCL, 피하주사 이중특이항체" },
  { date: "2023.06", drug: "글로피타맙 (Columvi)", note: "재발/불응성 DLBCL, 기간 한정 이중특이항체" },
  { date: "2024.05", drug: "리소캅타진 마라류셀 적응증 확대", note: "재발/불응성 여포성 림프종 및 외투세포 림프종" },
  { date: "2024.06", drug: "엡코리타맙 적응증 확대", note: "재발/불응성 여포성 림프종" }
];

// ClinicalTrials.gov의 영문 기관명 → 국내 병원명. 구체적인 이름을 앞에 둔다
window.KR_HOSPITALS = [
  [/bundang/i, "분당서울대학교병원"],
  [/boramae/i, "서울특별시 보라매병원"],
  [/seoul national univ/i, "서울대학교병원"],
  [/kangbuk/i, "강북삼성병원"],
  [/samsung/i, "삼성서울병원"],
  [/asan/i, "서울아산병원"],
  [/wonju/i, "원주세브란스기독병원"],
  [/gangnam severance/i, "강남세브란스병원"],
  [/severance|yonsei/i, "세브란스병원"],
  [/daegu catholic/i, "대구가톨릭대학교병원"],
  [/st\.? ?vincent/i, "가톨릭대 성빈센트병원"],
  [/yeouido|yeoido/i, "가톨릭대 여의도성모병원"],
  [/incheon st/i, "가톨릭대 인천성모병원"],
  [/uijeongbu st/i, "가톨릭대 의정부성모병원"],
  [/seoul st\.? ?mary|catholic/i, "가톨릭대 서울성모병원"],
  [/national cancer cent/i, "국립암센터"],
  [/korea cancer center|kirams|radiological/i, "원자력병원"],
  [/korea university.*guro|guro/i, "고려대 구로병원"],
  [/korea university.*ansan|ansan/i, "고려대 안산병원"],
  [/korea university/i, "고려대 안암병원"],
  [/hwasun/i, "화순전남대학교병원"],
  [/chonnam/i, "전남대학교병원"],
  [/chilgok/i, "칠곡경북대학교병원"],
  [/kyungpook/i, "경북대학교병원"],
  [/yangsan/i, "양산부산대학교병원"],
  [/pusan national/i, "부산대학교병원"],
  [/haeundae paik/i, "인제대 해운대백병원"],
  [/busan paik/i, "인제대 부산백병원"],
  [/ilsan paik/i, "인제대 일산백병원"],
  [/inje/i, "인제대 백병원"],
  [/ulsan university hosp/i, "울산대학교병원"],
  [/gachon|gil medical/i, "가천대 길병원"],
  [/ajou/i, "아주대학교병원"],
  [/hallym/i, "한림대학교병원"],
  [/kyung ?hee/i, "경희대학교병원"],
  [/chungnam/i, "충남대학교병원"],
  [/chungbuk/i, "충북대학교병원"],
  [/keimyung|dongsan/i, "계명대 동산병원"],
  [/yeungnam/i, "영남대학교병원"],
  [/dong-?a/i, "동아대학교병원"],
  [/hanyang/i, "한양대학교병원"],
  [/konkuk/i, "건국대학교병원"],
  [/soonchunhyang/i, "순천향대학교병원"],
  [/ewha/i, "이화여대 목동병원"],
  [/chung-?ang/i, "중앙대학교병원"],
  [/gyeongsang/i, "경상국립대학교병원"],
  [/jeonbuk|chonbuk/i, "전북대학교병원"],
  [/kosin/i, "고신대 복음병원"],
  [/national health insurance|ilsan hosp/i, "국민건강보험 일산병원"],
  [/inha/i, "인하대병원"],
  [/wonkwang/i, "원광대학교병원"],
  [/chosun/i, "조선대학교병원"],
  [/dongguk/i, "동국대 일산병원"],
  [/eulji/i, "을지대학교병원"]
];

// 국내 식약처 허가·건강보험 급여 이정표. 언론 보도 기준이며 각 항목에 출처를 단다
window.KOREA_TIMELINE = [
  { date: "2020.10", kind: "허가", drug: "폴라이비 (폴라투주맙 베도틴)", note: "재발/불응성 DLBCL, 벤다무스틴·리툭시맙 병용", src: "https://www.dailypharm.com/user/news/57733" },
  { date: "2021.03", kind: "허가", drug: "킴리아 (티사젠렉류셀)", note: "국내 첫 CAR-T, 첨단바이오의약품 1호. 재발/불응성 DLBCL 및 25세 이하 B세포 급성 림프구성 백혈병", src: "https://www.dailypharm.com/user/news/53755" },
  { date: "2022.04", kind: "급여", drug: "킴리아", note: "건강보험 적용, 위험분담계약 방식", src: "https://www.dailypharm.com/user/news/41456" },
  { date: "2022.11", kind: "허가", drug: "폴라이비 1차 치료 확대 (Pola-R-CHP)", note: "치료 경험이 없는 DLBCL 1차 치료", src: "https://dailypharm.com/user/news/33832" },
  { date: "2023.11", kind: "허가", drug: "룬수미오 (모수네투주맙)", note: "2차 이상 치료 후 재발/불응성 여포성 림프종. 글로벌 혁신제품 신속심사(GIFT) 1호", src: "https://dailypharm.com/user/news/22978" },
  { date: "2023.12", kind: "허가", drug: "컬럼비 (글로피타맙)", note: "2차 이상 치료 후 재발/불응성 DLBCL, 정맥주사 이중특이항체", src: "https://www.dailypharm.com/user/news/21838" },
  { date: "2024.06", kind: "허가", drug: "엡킨리 (엡코리타맙)", note: "2차 이상 치료 후 재발/불응성 DLBCL, 피하주사 이중특이항체(조건부 허가)", src: "https://www.doctorsnews.co.kr/news/articleView.html?idxno=155201" },
  { date: "2024.08", kind: "허가", drug: "제이퍼카 (피르토브루티닙)", note: "BTK 억제제 포함 2차 이상 치료 후 재발/불응성 외투세포 림프종(조건부 허가)", src: "https://www.dailypharm.com/user/news/14182" },
  { date: "2025.08", kind: "허가", drug: "예스카타 (악시캅타젠 실로류셀)", note: "재발/불응성 거대 B세포 림프종 CAR-T, 국내 세 번째 CAR-T", src: "https://dailypharm.com/user/news/3149" },
  { date: "2025.10", kind: "급여", drug: "제이퍼카", note: "건강보험 급여 등재", src: "https://dailypharm.com/user/news/338692" },
  { date: "2026.04", kind: "허가", drug: "림카토 (안발캅타젠 오토류셀)", note: "국산 첫 CAR-T(큐로셀). 2차 이상 치료 후 재발/불응성 DLBCL·원발성 종격동 거대 B세포 림프종", src: "https://dailypharm.com/user/news/338031" },
  { date: "2026.04", kind: "급여", drug: "엡킨리", note: "2차 이상 치료 후 재발/불응성 DLBCL 급여 적용", src: "https://kormedi.com/2838764/" },
  { date: "2026.07", kind: "허가", drug: "엡킨리 적응증 확대", note: "재발/불응성 여포성 림프종: 레날리도마이드·리툭시맙 병용 및 2차 이상 치료 후 단독요법", src: "https://kormedi.com/2838764/" }
];

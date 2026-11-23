# Upbit Trader

업비트 Open API 기반 암호화폐 자동매매 프레임워크 — 시세 조회, 백테스트, 파라미터 최적화(워크포워드), 모의투자/실거래 봇.

## 설치

```bash
cd upbit-trader
pip install -r requirements.txt
cp .env.example .env   # 실거래·잔고 조회 시에만 키 입력
```

API 키: 업비트 → 마이페이지 → Open API 관리. **자산조회 / 주문조회 / 주문하기** 권한만 켜고 **출금 권한은 끄세요.** 허용 IP 등록이 필수입니다.

## 사용법

```bash
# 1) 백테스트 (키 불필요)
python main.py backtest --market KRW-BTC --strategy vb --days 1000

# 2) 파라미터 최적화 + 워크포워드 검증
python main.py optimize --market KRW-BTC --strategy vb --days 1500

# 3) 모의투자 (실제 시세, 가상 잔고 100만원 — paper_state.json 에 저장)
python main.py paper --markets KRW-BTC,KRW-ETH --strategy vb --krw 200000

# 4) 실거래 (YES 확인 후 시작)
python main.py live --markets KRW-BTC --strategy vb --krw 50000 --stop-loss 0.03

python main.py balance
```

분봉 전략: `--interval minute60` (1/3/5/10/15/30/60/240 가능).

## 전략

| 키 | 전략 | 로직 |
|---|---|---|
| `vb` | 변동성 돌파 (Larry Williams) | 시가 + 전일 변동폭×k 돌파 시 매수, 다음 날 09:00 청산. 이평 필터 |
| `ma` | 이동평균 교차 | 단기 EMA > 장기 EMA 동안 보유 |
| `rsi` | RSI 역추세 | RSI < 30 매수, > 70 매도, 장기 이평 추세 필터 |
| `bb` | 볼린저 돌파 | 상단 밴드 돌파 진입, 중심선 이탈 청산 |

새 전략은 `upbit_trader/strategies.py`에서 `Strategy`를 상속하고 `positions(df)`(0/1 시리즈)만 구현하면 백테스트·봇 모두에서 동작합니다. `STRATEGIES` 딕셔너리에 등록하세요.

## 리스크 관리 (봇)

- `--krw` 종목당 매수 금액 (최소 주문 5,000원)
- `--stop-loss` 손절 비율 (기본 3%), `--take-profit` 익절 비율
- `--max-daily-loss` 당일 실현손실 한도 → 도달 시 신규 진입 중단
- 거래 내역 `trades.csv`, 로그 `bot.log`

## 백테스트 가정

- 수수료 0.05% + 슬리피지 0.05% (양방향 각각)
- 종가 신호 → 다음 봉 시가 체결 (미래 참조 없음, 테스트로 검증)
- 변동성 돌파는 목표가(갭 상승 시 시가) 체결, 당일 종가 청산

## 테스트

```bash
python -m pytest -q tests
```

## ⚠️ 주의

과거 성과는 미래 수익을 보장하지 않습니다. `optimize` 상위 결과는 과최적화되었을 가능성이 높으니 **워크포워드 결과**를 기준으로 판단하고, 반드시 모의투자로 충분히 검증한 뒤 소액으로 시작하세요.

"""실시간 트레이딩 봇 (기본: 모의투자 paper 모드).

리스크 관리
- 종목당 투입금액(krw_per_trade) 상한
- 손절(stop_loss) / 익절(take_profit) — 전략 신호와 무관하게 우선 적용
- 일일 손실 한도(max_daily_loss) 도달 시 당일 신규 진입 중단
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .client import UpbitClient
from .strategies import Strategy, VolatilityBreakout

KST = timezone(timedelta(hours=9))
MIN_ORDER_KRW = 5000
log = logging.getLogger("upbit_trader")


def trading_day(now: datetime) -> str:
    """업비트 일봉 기준일 (09:00 KST 에 날짜가 바뀜)."""
    return (now - timedelta(hours=9)).strftime("%Y-%m-%d")


@dataclass
class Position:
    volume: float
    entry_price: float
    entry_time: str


@dataclass
class RiskConfig:
    krw_per_trade: float = 100_000
    stop_loss: float = 0.03        # -3% 손절 (0 이면 비활성)
    take_profit: float = 0.0       # 익절 (0 이면 비활성)
    max_daily_loss: float = 50_000  # 당일 실현손실 한도 (KRW)


# ---------------------------------------------------------------- brokers
class PaperBroker:
    """잔고·체결을 시뮬레이션. 상태는 JSON 파일에 저장."""

    def __init__(self, client: UpbitClient, krw: float = 1_000_000, fee: float = 0.0005,
                 state_file: str = "paper_state.json"):
        self.client, self.fee, self.path = client, fee, Path(state_file)
        if self.path.exists():
            s = json.loads(self.path.read_text())
            self.krw = s["krw"]
            self.positions = {m: Position(**p) for m, p in s["positions"].items()}
        else:
            self.krw, self.positions = krw, {}

    def _save(self):
        self.path.write_text(json.dumps(
            {"krw": self.krw, "positions": {m: asdict(p) for m, p in self.positions.items()}},
            ensure_ascii=False, indent=2))

    def cash(self) -> float:
        return self.krw

    def position(self, market: str) -> Position | None:
        return self.positions.get(market)

    def buy(self, market: str, krw: float, price: float) -> Position:
        vol = krw * (1 - self.fee) / price
        self.krw -= krw
        self.positions[market] = Position(vol, price, datetime.now(KST).isoformat())
        self._save()
        return self.positions[market]

    def sell(self, market: str, price: float) -> float:
        p = self.positions.pop(market)
        proceeds = p.volume * price * (1 - self.fee)
        self.krw += proceeds
        self._save()
        return proceeds


class LiveBroker:
    """실제 업비트 주문. 진입 정보는 JSON 에 보관(재시작 대비), 수량은 실제 잔고 기준."""

    def __init__(self, client: UpbitClient, state_file: str = "live_state.json"):
        self.client, self.path = client, Path(state_file)
        self.meta = json.loads(self.path.read_text()) if self.path.exists() else {}

    def _save(self):
        self.path.write_text(json.dumps(self.meta, ensure_ascii=False, indent=2))

    def cash(self) -> float:
        return self.client.balance("KRW")

    def position(self, market: str) -> Position | None:
        cur = market.split("-")[1]
        vol = self.client.balance(cur)
        price = self.client.avg_buy_price(cur)
        if vol * max(price, 1e-12) < MIN_ORDER_KRW:  # 먼지 잔고는 무시
            return None
        t = self.meta.get(market, {}).get("entry_time", "")
        return Position(vol, price, t)

    def _wait(self, order: dict, timeout: float = 10) -> dict:
        end = time.time() + timeout
        while time.time() < end:
            o = self.client.get_order(order["uuid"])
            if o["state"] in ("done", "cancel"):
                return o
            time.sleep(0.5)
        return o

    def buy(self, market: str, krw: float, price: float) -> Position:
        o = self._wait(self.client.buy_market(market, krw))
        log.info("LIVE BUY  %s %s", market, o.get("state"))
        self.meta[market] = {"entry_time": datetime.now(KST).isoformat()}
        self._save()
        return self.position(market)

    def sell(self, market: str, price: float) -> float:
        p = self.position(market)
        if not p:
            return 0.0
        before = self.cash()
        o = self._wait(self.client.sell_market(market, p.volume))
        log.info("LIVE SELL %s %s", market, o.get("state"))
        self.meta.pop(market, None)
        self._save()
        return self.cash() - before


# ---------------------------------------------------------------- bot
@dataclass
class Bot:
    client: UpbitClient
    broker: PaperBroker | LiveBroker
    strategy: Strategy
    markets: list[str]
    interval: str = "day"
    risk: RiskConfig = field(default_factory=RiskConfig)
    poll_seconds: float = 10
    trade_log: str = "trades.csv"

    def __post_init__(self):
        self._daily_pnl: dict[str, float] = {}
        self._last_bar: dict[str, object] = {}

    # -- helpers
    def _record(self, market, side, price, amount, reason):
        line = f"{datetime.now(KST).isoformat()},{market},{side},{price},{amount:.0f},{reason}\n"
        p = Path(self.trade_log)
        if not p.exists():
            p.write_text("time,market,side,price,krw,reason\n")
        with p.open("a") as f:
            f.write(line)
        log.info("%s %s @ %s (%s, %.0f KRW)", side.upper(), market, price, reason, amount)

    def _sell(self, market, price, reason):
        pos = self.broker.position(market)
        proceeds = self.broker.sell(market, price)
        pnl = proceeds - pos.volume * pos.entry_price
        day = trading_day(datetime.now(KST))
        self._daily_pnl[day] = self._daily_pnl.get(day, 0) + pnl
        self._record(market, "sell", price, proceeds, f"{reason} pnl={pnl:+.0f}")

    def _halted(self) -> bool:
        day = trading_day(datetime.now(KST))
        return self._daily_pnl.get(day, 0) <= -abs(self.risk.max_daily_loss)

    # -- main step
    def step(self, market: str):
        now = datetime.now(KST)
        price = self.client.current_price(market)
        pos = self.broker.position(market)

        # 1) 손절 / 익절
        if pos and pos.entry_price > 0:
            chg = price / pos.entry_price - 1
            if self.risk.stop_loss and chg <= -self.risk.stop_loss:
                return self._sell(market, price, f"stop_loss {chg:.2%}")
            if self.risk.take_profit and chg >= self.risk.take_profit:
                return self._sell(market, price, f"take_profit {chg:.2%}")

        # 2) 변동성 돌파: 다음 거래일(09:00 KST 이후) 시가 청산
        if isinstance(self.strategy, VolatilityBreakout):
            if pos and pos.entry_time and \
                    trading_day(datetime.fromisoformat(pos.entry_time)) != trading_day(now):
                return self._sell(market, price, "vb_day_close")
            df = self.client.candles(market, "day", count=max(30, self.strategy.ma_filter + 5))
            signal = self.strategy.live_signal(df, price, holding=pos is not None)
        else:
            # 3) 일반 전략: 마감된 봉 기준으로, 새 봉이 마감될 때만 판단
            df = self.client.candles(market, self.interval, count=200).iloc[:-1]
            if self._last_bar.get(market) == df.index[-1]:
                return
            self._last_bar[market] = df.index[-1]
            signal = self.strategy.live_signal(df, price, holding=pos is not None)

        if signal == "buy" and not pos:
            if self._halted():
                log.warning("일일 손실 한도 도달 — 신규 진입 중단")
                return
            krw = min(self.risk.krw_per_trade, self.broker.cash() * 0.9995)
            if krw < MIN_ORDER_KRW:
                log.warning("잔고 부족 (%.0f KRW)", krw)
                return
            self.broker.buy(market, krw, price)
            self._record(market, "buy", price, krw, self.strategy.name)
        elif signal == "sell" and pos:
            self._sell(market, price, self.strategy.name)

    def run_forever(self):
        log.info("봇 시작: %s %s markets=%s mode=%s", self.strategy, self.interval,
                 self.markets, type(self.broker).__name__)
        while True:
            for m in self.markets:
                try:
                    self.step(m)
                except Exception:
                    log.exception("step 실패: %s", m)
                time.sleep(0.2)
            time.sleep(self.poll_seconds)

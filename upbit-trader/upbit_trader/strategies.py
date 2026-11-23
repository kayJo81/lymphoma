"""매매 전략.

모든 전략은 두 가지를 구현한다.
- bar_returns(df, fee): 백테스트용 바(bar)별 전략 수익률 (수수료 반영, 미래 정보 사용 금지)
- live_signal(df, price, holding): 실시간 판단 'buy' | 'sell' | 'hold'
  df 는 '마감된' 캔들만 포함, price 는 현재가.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import indicators as ind


class Strategy:
    name = "base"

    def positions(self, df: pd.DataFrame) -> pd.Series:
        """각 바 종가 시점에 원하는 포지션(0/1). 다음 바 시가에 체결된다고 가정."""
        raise NotImplementedError

    def bar_returns(self, df: pd.DataFrame, fee: float) -> pd.DataFrame:
        pos = self.positions(df).fillna(0).astype(float)
        held = pos.shift(1).fillna(0)          # 직전 바 종가 신호 → 이번 바에 보유
        # 체결가는 이번 바 시가: 진입 바는 open→close, 보유 지속 바는 prev close→close
        prev_close = df["close"].shift(1)
        entering = (held == 1) & (held.shift(1).fillna(0) == 0)
        base = np.where(entering, df["open"], prev_close)
        ret = np.where(held == 1, df["close"] / base - 1, 0.0)
        # 청산: 이전 바 보유 → 이번 바 미보유이면 시가에 매도 (prev close → open)
        exiting = (held == 0) & (held.shift(1).fillna(0) == 1)
        ret = np.where(exiting, df["open"] / prev_close - 1, ret)
        trades = entering.astype(int) + exiting.astype(int)
        ret = (1 + ret) * (1 - fee) ** trades - 1
        return pd.DataFrame({"ret": ret, "in_market": held, "entry": entering.astype(int),
                             "exit": exiting.astype(int)}, index=df.index)

    def live_signal(self, df: pd.DataFrame, price: float, holding: bool) -> str:
        want = int(self.positions(df).iloc[-1])
        if want and not holding:
            return "buy"
        if not want and holding:
            return "sell"
        return "hold"


@dataclass
class VolatilityBreakout(Strategy):
    """래리 윌리엄스 변동성 돌파 (일봉 기준).

    목표가 = 당일 시가 + 전일 변동폭(고가-저가) * k
    당일 가격이 목표가 돌파 시 매수, 다음 날 시가(09:00 KST)에 매도.
    ma_filter > 0 이면 전일 종가가 N일 이동평균 위일 때만 진입 (하락장 회피).
    """
    k: float = 0.5
    ma_filter: int = 5
    name: str = "volatility_breakout"

    def target(self, df: pd.DataFrame) -> pd.Series:
        rng = (df["high"] - df["low"]).shift(1)
        return df["open"] + rng * self.k

    def _filter(self, df: pd.DataFrame) -> pd.Series:
        if self.ma_filter <= 0:
            return pd.Series(True, index=df.index)
        return (df["close"].shift(1) > ind.sma(df["close"], self.ma_filter).shift(1))

    def bar_returns(self, df: pd.DataFrame, fee: float) -> pd.DataFrame:
        tgt = self.target(df)
        # 갭 상승으로 시가가 목표가 이상이면 시가에 체결
        entry_px = np.maximum(tgt, df["open"])
        hit = (df["high"] >= tgt) & self._filter(df) & tgt.notna()
        ret = np.where(hit, (df["close"] / entry_px) * (1 - fee) ** 2 - 1, 0.0)
        return pd.DataFrame({"ret": ret, "in_market": hit.astype(float),
                             "entry": hit.astype(int), "exit": hit.astype(int)},
                            index=df.index)

    def live_signal(self, df: pd.DataFrame, price: float, holding: bool) -> str:
        """df: 마감된 일봉 + 진행 중인 오늘 봉(마지막 행). 매도는 봇이 09:00에 처리."""
        if holding:
            return "hold"
        tgt = self.target(df).iloc[-1]
        ok = bool(self._filter(df).iloc[-1])
        return "buy" if ok and price >= tgt else "hold"


@dataclass
class MACrossover(Strategy):
    """단기 이평이 장기 이평 위에 있으면 보유."""
    short: int = 10
    long: int = 30
    use_ema: bool = True
    name: str = "ma_crossover"

    def positions(self, df):
        f = ind.ema if self.use_ema else ind.sma
        s, l = f(df["close"], self.short), f(df["close"], self.long)
        pos = (s > l).astype(int)
        pos[l.isna() | df["close"].rolling(self.long).count().lt(self.long)] = 0
        return pos


@dataclass
class RSIMeanReversion(Strategy):
    """RSI 과매도(<lower) 진입, 과매수(>upper) 청산. 추세 필터(장기 이평 위)."""
    period: int = 14
    lower: float = 30
    upper: float = 70
    trend_ma: int = 100
    name: str = "rsi_reversion"

    def positions(self, df):
        r = ind.rsi(df["close"], self.period)
        trend = df["close"] > ind.sma(df["close"], self.trend_ma) if self.trend_ma else True
        pos = np.zeros(len(df), dtype=int)
        holding = 0
        for i, (rv, tr) in enumerate(zip(r.values, np.broadcast_to(trend, len(df)))):
            if not holding and rv < self.lower and tr:
                holding = 1
            elif holding and rv > self.upper:
                holding = 0
            pos[i] = holding
        return pd.Series(pos, index=df.index)

    def live_signal(self, df, price, holding):
        # 실시간은 상태 기반: 보유 여부를 실제 잔고로 판단
        r = ind.rsi(df["close"], self.period).iloc[-1]
        trend = (df["close"].iloc[-1] > ind.sma(df["close"], self.trend_ma).iloc[-1]) \
            if self.trend_ma else True
        if not holding and r < self.lower and trend:
            return "buy"
        if holding and r > self.upper:
            return "sell"
        return "hold"


@dataclass
class BollingerBreakout(Strategy):
    """종가가 상단 밴드 돌파 시 진입, 중심선 하회 시 청산 (추세 추종)."""
    period: int = 20
    k: float = 2.0
    name: str = "bollinger_breakout"

    def positions(self, df):
        lo, mid, up = ind.bollinger(df["close"], self.period, self.k)
        pos = np.zeros(len(df), dtype=int)
        holding = 0
        for i in range(len(df)):
            c = df["close"].iat[i]
            if not holding and c > up.iat[i]:
                holding = 1
            elif holding and c < mid.iat[i]:
                holding = 0
            pos[i] = holding
        return pd.Series(pos, index=df.index)

    def live_signal(self, df, price, holding):
        lo, mid, up = ind.bollinger(df["close"], self.period, self.k)
        c = df["close"].iloc[-1]
        if not holding and c > up.iloc[-1]:
            return "buy"
        if holding and c < mid.iloc[-1]:
            return "sell"
        return "hold"


STRATEGIES = {
    "vb": VolatilityBreakout,
    "ma": MACrossover,
    "rsi": RSIMeanReversion,
    "bb": BollingerBreakout,
}

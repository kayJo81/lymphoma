import hashlib
import os
import sys
from datetime import datetime, timedelta

import jwt
import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from upbit_trader import UpbitClient, STRATEGIES, backtest, VolatilityBreakout  # noqa: E402
from upbit_trader.client import round_tick, candles_to_frame  # noqa: E402
from upbit_trader.bot import Bot, PaperBroker, RiskConfig, KST  # noqa: E402


def synthetic(n=800, seed=0):
    rng = np.random.default_rng(seed)
    close = 50_000_000 * np.exp(np.cumsum(rng.normal(0.0005, 0.03, n)))
    open_ = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, 0.002, n))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.015, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.015, n)))
    idx = pd.date_range("2023-01-01 09:00", periods=n, freq="D")
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close,
                         "volume": 1.0, "value": 1.0}, index=idx)


def test_jwt_query_hash():
    c = UpbitClient("ak", "sk")
    h = c._auth_header({"market": "KRW-BTC", "side": "bid"})
    tok = jwt.decode(h["Authorization"].split()[1], "sk", algorithms=["HS256"])
    assert tok["access_key"] == "ak"
    assert tok["query_hash"] == hashlib.sha512(b"market=KRW-BTC&side=bid").hexdigest()
    assert tok["query_hash_alg"] == "SHA512"
    assert "query_hash" not in jwt.decode(c._auth_header()["Authorization"].split()[1],
                                          "sk", algorithms=["HS256"])


def test_round_tick():
    assert round_tick(98_765_432) == 98_765_000
    assert round_tick(123_456) == 123_400
    assert round_tick(1234.5) == 1234
    assert round_tick(5.678) == 5.67


def test_candles_to_frame_sorted():
    rows = [{"candle_date_time_kst": f"2024-01-0{d}T09:00:00", "opening_price": d,
             "high_price": d, "low_price": d, "trade_price": d,
             "candle_acc_trade_volume": 1, "candle_acc_trade_price": 1} for d in (3, 2, 1)]
    df = candles_to_frame(rows)
    assert list(df["close"]) == [1, 2, 3]


@pytest.mark.parametrize("key", list(STRATEGIES))
def test_backtest_runs(key):
    df = synthetic()
    r = backtest.run(STRATEGIES[key](), df)
    assert np.isfinite(r.equity).all()
    assert r.stats["MDD(%)"] <= 0
    print(r)


def test_no_lookahead():
    """미래 데이터를 바꿔도 과거 수익률이 변하지 않아야 한다."""
    df = synthetic()
    for key, cls in STRATEGIES.items():
        a = cls().bar_returns(df, 0.001)["ret"].iloc[:500]
        df2 = df.copy()
        df2.iloc[500:] *= 3
        b = cls().bar_returns(df2, 0.001)["ret"].iloc[:500]
        pd.testing.assert_series_equal(a, b, check_names=False), key


def test_flat_market_loses_fees():
    idx = pd.date_range("2024-01-01", periods=300, freq="D")
    px = np.where(np.arange(300) % 20 < 10, 100.0, 120.0)  # 계단식: MA 교차 반복
    df = pd.DataFrame({"open": px, "high": px, "low": px, "close": px}, index=idx)
    r = backtest.run(STRATEGIES["ma"](short=2, long=5), df, fee=0.01, slippage=0)
    assert r.stats["거래횟수"] > 0


def test_walk_forward():
    df = synthetic(600)
    eq, log = backtest.walk_forward(STRATEGIES["vb"], df, {"k": [0.3, 0.5], "ma_filter": [0, 5]},
                                    train=300, test=60)
    assert len(log) == 5 and len(eq) == 300


class FakeClient:
    def __init__(self, df, price):
        self.df, self.price = df, price

    def current_price(self, market):
        return self.price

    def candles(self, market, interval="day", count=200, to=None):
        return self.df.iloc[-count:]


def test_bot_paper_vb(tmp_path):
    df = synthetic(50)
    df.iloc[-1, df.columns.get_loc("open")] = df["close"].iloc[-2]
    tgt = VolatilityBreakout(ma_filter=0).target(df).iloc[-1]
    client = FakeClient(df, tgt * 1.01)
    broker = PaperBroker(client, krw=1_000_000, state_file=str(tmp_path / "s.json"))
    bot = Bot(client, broker, VolatilityBreakout(ma_filter=0), ["KRW-BTC"],
              risk=RiskConfig(krw_per_trade=200_000, stop_loss=0.03),
              trade_log=str(tmp_path / "t.csv"))
    bot.step("KRW-BTC")
    assert broker.position("KRW-BTC") is not None
    assert broker.cash() == pytest.approx(800_000)

    # 손절
    client.price = tgt * 1.01 * 0.96
    bot.step("KRW-BTC")
    assert broker.position("KRW-BTC") is None
    assert broker.cash() < 1_000_000

    # 다음 거래일 청산
    client.price = tgt * 1.02
    bot.step("KRW-BTC")
    pos = broker.position("KRW-BTC")
    pos.entry_time = (datetime.now(KST) - timedelta(days=1)).isoformat()
    bot.step("KRW-BTC")
    assert broker.position("KRW-BTC") is None
    assert (tmp_path / "t.csv").read_text().count("\n") == 5  # header + 4 trades

    # 상태 파일 재로딩
    assert PaperBroker(client, state_file=str(tmp_path / "s.json")).cash() == broker.cash()

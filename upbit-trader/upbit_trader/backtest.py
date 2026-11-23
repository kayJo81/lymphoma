"""백테스트 엔진 + 성과 지표 + 파라미터 그리드 서치."""
from __future__ import annotations

import itertools
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .strategies import Strategy

UPBIT_KRW_FEE = 0.0005  # KRW 마켓 기본 수수료 0.05%


@dataclass
class Result:
    strategy: str
    equity: pd.Series
    stats: dict

    def __str__(self):
        lines = [f"[{self.strategy}]"]
        for k, v in self.stats.items():
            lines.append(f"  {k:<16}: {v:,.2f}" if isinstance(v, float) else f"  {k:<16}: {v}")
        return "\n".join(lines)


def periods_per_year(index: pd.DatetimeIndex) -> float:
    if len(index) < 2:
        return 365
    step = pd.Series(index).diff().median().total_seconds()
    return 365 * 24 * 3600 / step


def run(strategy: Strategy, df: pd.DataFrame, fee: float = UPBIT_KRW_FEE,
        slippage: float = 0.0005, initial: float = 1_000_000) -> Result:
    br = strategy.bar_returns(df, fee + slippage)
    equity = initial * (1 + br["ret"]).cumprod()
    return Result(strategy.name, equity, stats(br, equity, df, initial))


def stats(br: pd.DataFrame, equity: pd.Series, df: pd.DataFrame, initial: float) -> dict:
    ret = br["ret"]
    ppy = periods_per_year(df.index)
    years = max(len(df) / ppy, 1e-9)
    total = equity.iloc[-1] / initial - 1
    cagr = (equity.iloc[-1] / initial) ** (1 / years) - 1
    dd = equity / equity.cummax() - 1
    sharpe = ret.mean() / ret.std() * np.sqrt(ppy) if ret.std() > 0 else 0.0

    # 트레이드 단위 승률: 진입~청산 구간 누적수익률
    trade_id = br["entry"].cumsum().where(br["in_market"] + br["exit"] > 0)
    trade_rets = (1 + ret).groupby(trade_id).prod() - 1 if trade_id.notna().any() else pd.Series()
    bh = df["close"].iloc[-1] / df["close"].iloc[0] - 1
    bh_mdd = (df["close"] / df["close"].cummax() - 1).min()
    return {
        "총수익률(%)": total * 100,
        "CAGR(%)": cagr * 100,
        "MDD(%)": dd.min() * 100,
        "샤프지수": float(sharpe),
        "거래횟수": int(len(trade_rets)),
        "승률(%)": float((trade_rets > 0).mean() * 100) if len(trade_rets) else 0.0,
        "시장노출(%)": float(br["in_market"].mean() * 100),
        "단순보유(%)": bh * 100,
        "단순보유MDD(%)": bh_mdd * 100,
    }


def grid_search(cls, df: pd.DataFrame, grid: dict, metric: str = "샤프지수",
                **run_kw) -> pd.DataFrame:
    """파라미터 조합별 성과표. 과최적화 주의 → walk_forward 로 검증할 것."""
    rows = []
    keys = list(grid)
    for combo in itertools.product(*grid.values()):
        params = dict(zip(keys, combo))
        try:
            r = run(cls(**params), df, **run_kw)
        except Exception as e:  # 잘못된 조합(short>=long 등) 건너뜀
            continue
        rows.append({**params, **r.stats})
    return pd.DataFrame(rows).sort_values(metric, ascending=False).reset_index(drop=True)


def walk_forward(cls, df: pd.DataFrame, grid: dict, train: int, test: int,
                 metric: str = "샤프지수", **run_kw) -> tuple[pd.Series, list[dict]]:
    """학습 구간에서 최적 파라미터 → 다음 테스트 구간에 적용 (아웃오브샘플 성과)."""
    rets, log = [], []
    start = 0
    while start + train + test <= len(df):
        tr = df.iloc[start:start + train]
        best = grid_search(cls, tr, grid, metric, **run_kw).iloc[0]
        params = {k: (type(grid[k][0])(best[k])) for k in grid}
        # 지표 워밍업을 위해 학습 구간 포함해서 계산 후 테스트 구간만 잘라냄
        window = df.iloc[start:start + train + test]
        fee = run_kw.get("fee", UPBIT_KRW_FEE) + run_kw.get("slippage", 0.0005)
        br = cls(**params).bar_returns(window, fee).iloc[train:]
        rets.append(br["ret"])
        log.append({"test_start": str(window.index[train]), **params})
        start += test
    oos = pd.concat(rets) if rets else pd.Series(dtype=float)
    return (1 + oos).cumprod(), log

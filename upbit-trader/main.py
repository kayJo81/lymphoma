"""업비트 트레이딩 CLI.

예시
  python main.py backtest --market KRW-BTC --strategy vb --days 730
  python main.py optimize --market KRW-ETH --strategy ma --days 1000
  python main.py paper    --markets KRW-BTC,KRW-ETH --strategy vb
  python main.py live     --markets KRW-BTC --strategy vb --krw 50000   # 실거래 (주의)
  python main.py balance
"""
import argparse
import logging
import os
import sys

from upbit_trader import UpbitClient, STRATEGIES, backtest
from upbit_trader.bot import Bot, PaperBroker, LiveBroker, RiskConfig

GRIDS = {
    "vb": {"k": [0.3, 0.4, 0.5, 0.6, 0.7], "ma_filter": [0, 3, 5, 10]},
    "ma": {"short": [5, 10, 20], "long": [30, 50, 100]},
    "rsi": {"lower": [20, 25, 30, 35], "upper": [60, 70, 80], "trend_ma": [0, 50, 100]},
    "bb": {"period": [10, 20, 30], "k": [1.5, 2.0, 2.5]},
}


def load_env(path=".env"):
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def make_client():
    load_env()
    return UpbitClient(os.getenv("UPBIT_ACCESS_KEY"), os.getenv("UPBIT_SECRET_KEY"))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("backtest", "optimize"):
        s = sub.add_parser(name)
        s.add_argument("--market", default="KRW-BTC")
        s.add_argument("--strategy", choices=STRATEGIES, default="vb")
        s.add_argument("--interval", default="day")
        s.add_argument("--days", type=int, default=730, help="캔들 개수")
        s.add_argument("--fee", type=float, default=0.0005)
        s.add_argument("--slippage", type=float, default=0.0005)
    for name in ("paper", "live"):
        s = sub.add_parser(name)
        s.add_argument("--markets", default="KRW-BTC")
        s.add_argument("--strategy", choices=STRATEGIES, default="vb")
        s.add_argument("--interval", default="day")
        s.add_argument("--krw", type=float, default=100_000, help="종목당 매수 금액")
        s.add_argument("--stop-loss", type=float, default=0.03)
        s.add_argument("--take-profit", type=float, default=0.0)
        s.add_argument("--max-daily-loss", type=float, default=50_000)
        s.add_argument("--poll", type=float, default=10)
    sub.add_parser("balance")
    a = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler("bot.log")])
    client = make_client()

    if a.cmd == "balance":
        for acc in client.accounts():
            print(f"{acc['currency']:>6}  {float(acc['balance']):>18,.8f}  "
                  f"평단 {float(acc['avg_buy_price']):,.2f}")
        return

    if a.cmd in ("backtest", "optimize"):
        df = client.candles(a.market, a.interval, count=a.days)
        print(f"{a.market} {a.interval} {len(df)}개 캔들: {df.index[0]} ~ {df.index[-1]}")
        cls = STRATEGIES[a.strategy]
        kw = dict(fee=a.fee, slippage=a.slippage)
        if a.cmd == "backtest":
            print(backtest.run(cls(), df, **kw))
        else:
            table = backtest.grid_search(cls, df, GRIDS[a.strategy], **kw)
            print(table.head(10).to_string(float_format=lambda x: f"{x:,.2f}"))
            train, test = int(len(df) * 0.5), int(len(df) * 0.1)
            eq, log = backtest.walk_forward(cls, df, GRIDS[a.strategy], train, test, **kw)
            if len(eq):
                print(f"\n워크포워드(아웃오브샘플) 누적수익률: {(eq.iloc[-1] - 1) * 100:.2f}%")
                for row in log:
                    print("  ", row)
        return

    risk = RiskConfig(a.krw, a.stop_loss, a.take_profit, a.max_daily_loss)
    if a.cmd == "live":
        if not (client.access_key and client.secret_key):
            sys.exit("실거래에는 .env 에 API 키가 필요합니다.")
        ok = input(f"⚠️  실제 주문이 나갑니다 ({a.markets}, 종목당 {a.krw:,.0f}원). "
                   "계속하려면 'YES' 입력: ")
        if ok != "YES":
            sys.exit("취소됨")
        broker = LiveBroker(client)
    else:
        broker = PaperBroker(client)
    bot = Bot(client, broker, STRATEGIES[a.strategy](), a.markets.split(","), a.interval,
              risk, a.poll)
    bot.run_forever()


if __name__ == "__main__":
    main()

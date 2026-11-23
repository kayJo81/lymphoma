"""업비트 REST API 클라이언트 (시세 조회 + 인증 주문).

공식 문서: https://docs.upbit.com
- 시세(Quotation) API: 인증 불필요
- 거래(Exchange) API: JWT(HS256) 인증, 파라미터가 있으면 SHA512 query_hash 포함
"""
from __future__ import annotations

import hashlib
import time
import uuid
from urllib.parse import unquote, urlencode

import jwt
import pandas as pd
import requests

BASE_URL = "https://api.upbit.com/v1"


class UpbitError(RuntimeError):
    def __init__(self, status: int, payload):
        self.status = status
        self.payload = payload
        super().__init__(f"Upbit API error {status}: {payload}")


class UpbitClient:
    def __init__(self, access_key: str | None = None, secret_key: str | None = None,
                 timeout: float = 10.0, max_retries: int = 3):
        self.access_key = access_key
        self.secret_key = secret_key
        self.timeout = timeout
        self.max_retries = max_retries
        self.session = requests.Session()

    # ------------------------------------------------------------------ core
    def _auth_header(self, params: dict | None = None) -> dict:
        if not (self.access_key and self.secret_key):
            raise RuntimeError("거래 API는 UPBIT_ACCESS_KEY / UPBIT_SECRET_KEY 가 필요합니다.")
        payload = {"access_key": self.access_key, "nonce": str(uuid.uuid4())}
        if params:
            query = unquote(urlencode(params, doseq=True)).encode()
            payload["query_hash"] = hashlib.sha512(query).hexdigest()
            payload["query_hash_alg"] = "SHA512"
        token = jwt.encode(payload, self.secret_key, algorithm="HS256")
        return {"Authorization": f"Bearer {token}"}

    def _request(self, method: str, path: str, params: dict | None = None,
                 auth: bool = False):
        url = BASE_URL + path
        for attempt in range(self.max_retries):
            headers = self._auth_header(params) if auth else {}
            if method == "POST":
                resp = self.session.post(url, json=params, headers=headers, timeout=self.timeout)
            else:
                resp = self.session.request(method, url, params=params, headers=headers,
                                            timeout=self.timeout)
            if resp.status_code == 429:  # rate limit → 백오프 후 재시도
                time.sleep(0.5 * (attempt + 1))
                continue
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                except ValueError:
                    err = resp.text
                raise UpbitError(resp.status_code, err)
            return resp.json()
        raise UpbitError(429, "rate limit exceeded after retries")

    # ------------------------------------------------------- quotation (public)
    def markets(self, quote: str = "KRW") -> list[str]:
        data = self._request("GET", "/market/all", {"isDetails": "false"})
        return [m["market"] for m in data if m["market"].startswith(quote + "-")]

    def ticker(self, markets: str | list[str]) -> list[dict]:
        if isinstance(markets, (list, tuple)):
            markets = ",".join(markets)
        return self._request("GET", "/ticker", {"markets": markets})

    def current_price(self, market: str) -> float:
        return float(self.ticker(market)[0]["trade_price"])

    def orderbook(self, market: str) -> dict:
        return self._request("GET", "/orderbook", {"markets": market})[0]

    def candles(self, market: str, interval: str = "day", count: int = 200,
                to: str | None = None) -> pd.DataFrame:
        """캔들 조회. interval: 'minute1|3|5|10|15|30|60|240', 'day', 'week', 'month'.

        count > 200 이면 자동으로 페이지네이션한다. 결과는 시간 오름차순.
        """
        if interval.startswith("minute"):
            path = f"/candles/minutes/{int(interval[6:])}"
        elif interval in ("day", "week", "month"):
            path = f"/candles/{interval}s"
        else:
            raise ValueError(f"unknown interval: {interval}")

        rows: list[dict] = []
        remaining = count
        cursor = to
        while remaining > 0:
            params = {"market": market, "count": min(200, remaining)}
            if cursor:
                params["to"] = cursor
            batch = self._request("GET", path, params)
            if not batch:
                break
            rows.extend(batch)
            remaining -= len(batch)
            # 가장 오래된 캔들의 UTC 시각을 다음 페이지 기준으로 사용
            cursor = batch[-1]["candle_date_time_utc"].replace("T", " ")
            if len(batch) < params["count"]:
                break
            time.sleep(0.11)  # 시세 API 초당 ~10회 제한
        return candles_to_frame(rows)

    # ------------------------------------------------------- exchange (private)
    def accounts(self) -> list[dict]:
        return self._request("GET", "/accounts", auth=True)

    def balance(self, currency: str = "KRW") -> float:
        for acc in self.accounts():
            if acc["currency"] == currency:
                return float(acc["balance"])
        return 0.0

    def avg_buy_price(self, currency: str) -> float:
        for acc in self.accounts():
            if acc["currency"] == currency:
                return float(acc["avg_buy_price"])
        return 0.0

    def order_chance(self, market: str) -> dict:
        return self._request("GET", "/orders/chance", {"market": market}, auth=True)

    def get_order(self, order_uuid: str) -> dict:
        return self._request("GET", "/order", {"uuid": order_uuid}, auth=True)

    def cancel_order(self, order_uuid: str) -> dict:
        return self._request("DELETE", "/order", {"uuid": order_uuid}, auth=True)

    def buy_market(self, market: str, krw_amount: float) -> dict:
        """시장가 매수: 지정 KRW 금액만큼 매수 (ord_type=price)."""
        params = {"market": market, "side": "bid", "price": _fmt(krw_amount, 0),
                  "ord_type": "price"}
        return self._request("POST", "/orders", params, auth=True)

    def sell_market(self, market: str, volume: float) -> dict:
        """시장가 매도: 지정 수량 매도 (ord_type=market)."""
        params = {"market": market, "side": "ask", "volume": _fmt(volume, 8),
                  "ord_type": "market"}
        return self._request("POST", "/orders", params, auth=True)

    def limit_order(self, market: str, side: str, price: float, volume: float) -> dict:
        params = {"market": market, "side": side, "ord_type": "limit",
                  "price": _fmt(round_tick(price), 8), "volume": _fmt(volume, 8)}
        return self._request("POST", "/orders", params, auth=True)


# ---------------------------------------------------------------- helpers
def _fmt(x: float, decimals: int) -> str:
    s = f"{x:.{decimals}f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def round_tick(price: float) -> float:
    """KRW 마켓 호가 단위로 내림 (지정가 주문용, 업비트 호가단위표 기준)."""
    table = [
        (2_000_000, 1000), (1_000_000, 1000), (500_000, 500), (100_000, 100),
        (50_000, 50), (10_000, 10), (5_000, 5), (1_000, 1), (100, 1),
        (10, 0.1), (1, 0.01), (0.1, 0.001), (0.01, 0.0001), (0.001, 0.00001),
        (0.0001, 0.000001), (0.00001, 0.0000001),
    ]
    tick = 0.00000001
    for threshold, t in table:
        if price >= threshold:
            tick = t
            break
    return round((price // tick) * tick, 8)


def candles_to_frame(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume", "value"])
    df = pd.DataFrame(rows)
    df = df.rename(columns={
        "opening_price": "open", "high_price": "high", "low_price": "low",
        "trade_price": "close", "candle_acc_trade_volume": "volume",
        "candle_acc_trade_price": "value",
    })
    df.index = pd.to_datetime(df["candle_date_time_kst"])
    df.index.name = "time_kst"
    df = df[["open", "high", "low", "close", "volume", "value"]].astype(float)
    return df[~df.index.duplicated()].sort_index()

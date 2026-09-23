"""RSI-сигналы и простой бэктест без коротких позиций."""

import math

import pandas as pd
from ta.momentum import RSIIndicator


def _validate_prices(df: pd.DataFrame, columns: tuple[str, ...]) -> None:
    if not df.index.is_monotonic_increasing or not df.index.is_unique:
        raise ValueError("Индекс должен быть уникальным и отсортированным по времени")
    for column in columns:
        if column not in df:
            raise ValueError(f"Нет столбца {column!r}")
        if not pd.api.types.is_numeric_dtype(df[column]):
            raise ValueError(f"{column}: нужны числовые цены")
        if not df[column].map(lambda x: pd.notna(x) and math.isfinite(x) and x > 0).all():
            raise ValueError(f"{column}: цены должны быть конечными и положительными")


def rsi_signals(
    df: pd.DataFrame,
    window: int = 14,
    lower: float = 30,
    upper: float = 70,
) -> pd.DataFrame:
    """Копия OHLCV с rsi и signal; используется столбец close.

    RSI < lower: buy; RSI > upper: sell; иначе hold.
    Пока RSI не определён, сигнал hold. Названия столбцов в нижнем регистре.
    """
    if isinstance(window, bool) or not isinstance(window, int) or window < 2:
        raise ValueError("window должен быть целым числом >= 2")
    if not 0 <= lower < upper <= 100:
        raise ValueError("Ожидается 0 <= lower < upper <= 100")
    _validate_prices(df, ("close",))
    result = df.copy()
    result["rsi"] = RSIIndicator(result["close"], window=window, fillna=False).rsi()
    result["signal"] = "hold"
    result.loc[result["rsi"] < lower, "signal"] = "buy"
    result.loc[result["rsi"] > upper, "signal"] = "sell"
    return result


def backtest(
    df: pd.DataFrame,
    initial_balance: float = 1000.0,
    fee: float = 0.0,
) -> dict:
    """Исполнение вчерашнего сигнала по open текущей свечи.

    buy покупает на все деньги, sell закрывает всю позицию, hold ничего
    не делает. Повторные buy в позиции и sell без позиции игнорируются.
    Дробные единицы разрешены. fee — доля комиссии на каждую сделку.
    Баланс = деньги + количество * close. Открытая позиция в конце
    оценивается по последнему close, без принудительной продажи.
    Пустой DataFrame возвращает начальный баланс и пустую историю.
    """
    if not math.isfinite(initial_balance) or initial_balance <= 0:
        raise ValueError("initial_balance должен быть конечным и > 0")
    if not 0 <= fee < 1:
        raise ValueError("fee должен быть в диапазоне [0, 1)")
    _validate_prices(df, ("open", "close"))
    if "signal" not in df or not df["signal"].isin(["buy", "sell", "hold"]).all():
        raise ValueError("Нужен столбец signal со значениями buy/sell/hold")

    cash, units = float(initial_balance), 0.0
    rows = []
    pending = df["signal"].shift(1, fill_value="hold")
    for open_price, close_price, signal in zip(df["open"], df["close"], pending):
        action = "hold"
        if signal == "buy" and units == 0:
            units = cash / (open_price * (1 + fee))
            cash = 0.0
            action = "buy"
        elif signal == "sell" and units > 0:
            cash = units * open_price * (1 - fee)
            units = 0.0
            action = "sell"
        rows.append((cash, units, cash + units * close_price, action))

    history = pd.DataFrame(
        rows, index=df.index, columns=["cash", "units", "balance", "action"]
    )
    final_balance = float(history["balance"].iloc[-1]) if rows else float(initial_balance)
    return {
        "initial_balance": float(initial_balance),
        "final_balance": final_balance,
        "return_pct": (final_balance / initial_balance - 1) * 100,
        "history": history,
    }

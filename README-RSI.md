## RSI и простой бэктест

Установка: `python -m pip install -r requirements-rsi.txt`.

```python
import pandas as pd
from rsi_backtest import rsi_signals, backtest

# CSV: timestamp, open, high, low, close, volume; строки по времени.
df = pd.read_csv("ohlcv.csv", parse_dates=["timestamp"]).set_index("timestamp")
signals = rsi_signals(df, window=14, lower=30, upper=70)
result = backtest(signals, initial_balance=1000, fee=0.001)

print(signals[["rsi", "signal"]].tail())
print(f"Итоговый баланс: ${result['final_balance']:.2f}")
print(f"Доходность: {result['return_pct']:.2f}%")
print(result["history"])
```

RSI ниже 30 даёт `buy`, выше 70 — `sell`, иначе `hold`.
Во время прогрева индикатора сигнал `hold`.
Сигнал исполняется на открытии следующей свечи: последний сигнал
не исполняется, если следующей свечи нет.
Покупка на весь доступный баланс, продажа всей позиции, без шортов.
Повторная покупка при открытой позиции игнорируется.

`history` содержит деньги (`cash`), количество актива (`units`),
стоимость портфеля на закрытии (`balance`) и исполненное действие (`action`).
Начальный баланс возвращается отдельно в `initial_balance`.
Итоговая доходность включает переоценку незакрытой позиции по последнему close.
Комиссия задаётся долей на каждую сделку (0.001 = 0.1%), по умолчанию 0.
Проскальзывание не моделируется.

Индикатор: [ta.momentum.RSIIndicator](https://technical-analysis-library-in-python.readthedocs.io/en/latest/ta.html#ta.momentum.RSIIndicator).


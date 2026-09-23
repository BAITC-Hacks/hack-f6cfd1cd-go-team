import unittest

import pandas as pd

from rsi_backtest import backtest, rsi_signals


class BacktestTests(unittest.TestCase):
    def test_next_open_and_repeated_signals(self):
        df = pd.DataFrame({
            "open": [50., 100., 150., 200., 300.],
            "close": [80., 120., 160., 210., 310.],
            "signal": ["buy", "buy", "sell", "sell", "buy"],
        })
        result = backtest(df)
        self.assertEqual(result["history"]["balance"].tolist(),
                         [1000., 1200., 1600., 2000., 2000.])
        self.assertEqual(result["history"]["action"].tolist(),
                         ["hold", "buy", "hold", "sell", "hold"])
        self.assertEqual(result["return_pct"], 100.)

    def test_fees_and_open_position(self):
        df = pd.DataFrame({"open": [100., 100., 100.],
                           "close": [100., 120., 100.],
                           "signal": ["buy", "sell", "hold"]})
        self.assertAlmostEqual(backtest(df, fee=.01)["final_balance"],
                               1000 / 1.01 * .99)
        self.assertEqual(backtest(df.iloc[:2])["final_balance"], 1200.)

    def test_rsi_warmup_and_directions(self):
        for closes, expected in [(range(1, 21), "sell"), (range(20, 0, -1), "buy")]:
            df = pd.DataFrame({"close": list(closes)})
            result = rsi_signals(df)
            self.assertTrue(result["signal"].iloc[:13].eq("hold").all())
            self.assertEqual(result["signal"].iloc[-1], expected)
            self.assertNotIn("signal", df)

    def test_empty_and_invalid_prices(self):
        df = pd.DataFrame({"open": pd.Series(dtype=float),
                           "close": pd.Series(dtype=float)})
        result = backtest(rsi_signals(df))
        self.assertEqual(result["final_balance"], 1000.)
        self.assertTrue(result["history"].empty)
        with self.assertRaises(ValueError):
            backtest(pd.DataFrame({"open": [0.], "close": [1.], "signal": ["buy"]}))


if __name__ == "__main__":
    unittest.main()

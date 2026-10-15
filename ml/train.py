"""
Offline trainer for the GhostFxPro exit model.

Consumes the labeled dataset exported by the bot (JSONL, one decision row per
line: {features, label, ts}) and trains a logistic-regression model that predicts
P(close now is correct). It emits a small JSON blob of coefficients, which the
TypeScript side loads for inference — so Python is only used for training, never
on the live trading path.

Honesty notes:
  * Splits are TIME-ORDERED (60% train / 20% validation / 20% test), so the
    reported test metrics are genuine out-of-sample. The decision threshold is
    chosen on the validation slice, never on the test slice.
  * Classes are rebalanced (class_weight="balanced") because CLOSE/HOLD are not
    equally frequent; accuracy alone would be misleading, so AUC is reported
    alongside precision/recall/F1.
  * A gradient-boosting model is also fit and scored on the test slice purely as
    a reference point, so we can see whether the linear model is leaving signal
    on the table. It is not exported (its trees are not TS-consumable yet).
  * If the data contains a single class, training is refused with a clear error
    rather than returning a meaningless model.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Iterable

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.preprocessing import StandardScaler

# Canonical feature order — MUST match packages/bot/src/backtest/features.ts.
FEATURE_NAMES = [
    "returnPct",
    "peakReturnPct",
    "drawdownFromPeak",
    "barsHeld",
    "momentum",
    "volatility",
    "peakAge",
    "momentumLong",
    "volatilityRatio",
    "smaDeviation",
    "rsi",
]

DEFAULT_THRESHOLD = 0.5
TRAIN_FRACTION = 0.6
VAL_FRACTION = 0.2  # remaining 0.2 is the test slice


def train(dataset_jsonl: str, threshold: float | None = None) -> dict[str, Any]:
    features, labels, timestamps = _load(dataset_jsonl)
    if len(labels) < 10:
        raise ValueError("need at least 10 decision rows to train")

    x = np.asarray(features, dtype=float)
    y = np.asarray(labels, dtype=int)
    order = np.argsort(np.asarray(timestamps, dtype=float), kind="stable")
    x, y = x[order], y[order]

    classes = set(y.tolist())
    if len(classes) < 2:
        raise ValueError(
            "dataset has a single class (%s); both CLOSE and HOLD are required"
            % ("CLOSE" if 1 in classes else "HOLD")
        )

    n = len(y)
    train_end = max(1, min(int(n * TRAIN_FRACTION), n - 2))
    val_end = max(train_end + 1, min(int(n * (TRAIN_FRACTION + VAL_FRACTION)), n - 1))
    x_train, y_train = x[:train_end], y[:train_end]
    x_val, y_val = x[train_end:val_end], y[train_end:val_end]
    x_test, y_test = x[val_end:], y[val_end:]

    if len(set(y_train.tolist())) < 2:
        raise ValueError("training slice has a single class; need more data")

    scaler = StandardScaler()
    x_train_std = scaler.fit_transform(x_train)
    clf = LogisticRegression(
        max_iter=2000, class_weight="balanced", random_state=0
    )
    clf.fit(x_train_std, y_train)

    # Choose the decision threshold on the validation slice (never on test).
    chosen = float(threshold) if threshold is not None else _best_threshold(
        clf, scaler, x_val, y_val
    )

    model: dict[str, Any] = {
        "type": "logistic",
        "features": FEATURE_NAMES,
        "means": scaler.mean_.tolist(),
        "stds": scaler.scale_.tolist(),
        "coefficients": clf.coef_[0].tolist(),
        "intercept": float(clf.intercept_[0]),
        "threshold": chosen,
        "metrics": _metrics(clf, scaler, x_test, y_test, chosen),
        "validation": _metrics(clf, scaler, x_val, y_val, chosen),
        "comparison": _gbm_reference(x_train, y_train, x_test, y_test),
        "samples": {
            "train": int(len(y_train)),
            "validation": int(len(y_val)),
            "test": int(len(y_test)),
            "total": int(n),
            "close_rate": float(y.mean()),
        },
    }
    return model


def _best_threshold(
    clf: LogisticRegression,
    scaler: StandardScaler,
    x_val: np.ndarray,
    y_val: np.ndarray,
) -> float:
    if len(y_val) == 0 or len(set(y_val.tolist())) < 2:
        return DEFAULT_THRESHOLD
    proba = clf.predict_proba(scaler.transform(x_val))[:, 1]
    best_t, best_f1 = DEFAULT_THRESHOLD, -1.0
    for t in np.linspace(0.2, 0.8, 25):
        preds = (proba >= t).astype(int)
        f1 = f1_score(y_val, preds, zero_division=0)
        if f1 > best_f1:
            best_f1, best_t = f1, float(t)
    return best_t


def _metrics(
    clf: LogisticRegression,
    scaler: StandardScaler,
    x: np.ndarray,
    y: np.ndarray,
    threshold: float,
) -> dict[str, Any]:
    if len(y) == 0:
        return {}
    proba = clf.predict_proba(scaler.transform(x))[:, 1]
    preds = (proba >= threshold).astype(int)
    m: dict[str, Any] = {
        "accuracy": float(accuracy_score(y, preds)),
        "precision": float(precision_score(y, preds, zero_division=0)),
        "recall": float(recall_score(y, preds, zero_division=0)),
        "f1": float(f1_score(y, preds, zero_division=0)),
        "close_rate": float(np.mean(preds)),
    }
    if len(set(y.tolist())) > 1:
        m["auc"] = float(roc_auc_score(y, proba))
    return m


def _gbm_reference(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_test: np.ndarray,
    y_test: np.ndarray,
) -> dict[str, Any]:
    """Non-exported reference: is a non-linear model meaningfully better?"""
    try:
        gbm = HistGradientBoostingClassifier(
            max_iter=200, learning_rate=0.05, max_depth=3, random_state=0
        )
        gbm.fit(x_train, y_train)
        if len(y_test) == 0 or len(set(y_test.tolist())) < 2:
            return {}
        proba = gbm.predict_proba(x_test)[:, 1]
        preds = (proba >= 0.5).astype(int)
        return {
            "auc": float(roc_auc_score(y_test, proba)),
            "f1": float(f1_score(y_test, preds, zero_division=0)),
            "accuracy": float(accuracy_score(y_test, preds)),
        }
    except Exception as exc:  # pragma: no cover - defensive, reference only
        return {"error": str(exc)}


def _load(dataset_jsonl: str) -> tuple[list[list[float]], list[int], list[float]]:
    features: list[list[float]] = []
    labels: list[int] = []
    timestamps: list[float] = []
    for line_no, line in enumerate(dataset_jsonl.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        feats = row.get("features")
        if not isinstance(feats, dict):
            raise ValueError(f"line {line_no}: missing features object")
        features.append([float(feats.get(name, 0.0)) for name in FEATURE_NAMES])
        labels.append(1 if str(row.get("label", "HOLD")).upper() == "CLOSE" else 0)
        timestamps.append(float(row.get("ts", 0.0)))
    return features, labels, timestamps


def _iter_lines() -> Iterable[str]:
    yield from sys.stdin


def _read_input(path: str | None) -> str:
    if path:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    return sys.stdin.read()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Train the GhostFxPro exit model.")
    parser.add_argument("--in", dest="infile", help="dataset JSONL path (default stdin)")
    parser.add_argument("--out", dest="outfile", help="model JSON path (default stdout)")
    parser.add_argument("--threshold", type=float, default=None)
    args = parser.parse_args()

    payload = _read_input(args.infile)
    if not payload.strip():
        print("no dataset provided (use --in or pipe JSONL on stdin)", file=sys.stderr)
        raise SystemExit(2)

    trained = train(payload, threshold=args.threshold)
    text = json.dumps(trained, indent=2)
    if args.outfile:
        with open(args.outfile, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        metrics = trained.get("metrics", {})
        samples = trained.get("samples", {})
        comparison = trained.get("comparison", {})
        print(
            "[train] wrote %s | train=%s val=%s test=%s thr=%.2f "
            "acc=%.4f auc=%s f1=%.4f | gbm_auc=%s"
            % (
                args.outfile,
                samples.get("train"),
                samples.get("validation"),
                samples.get("test"),
                trained.get("threshold", 0.5),
                metrics.get("accuracy", float("nan")),
                ("%.4f" % metrics["auc"]) if "auc" in metrics else "n/a",
                metrics.get("f1", float("nan")),
                ("%.4f" % comparison["auc"]) if "auc" in comparison else "n/a",
            ),
            file=sys.stderr,
        )
    else:
        print(text)

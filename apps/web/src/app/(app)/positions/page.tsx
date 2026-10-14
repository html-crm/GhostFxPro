import { Placeholder } from "@/components/Placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Open Positions"
      phase="Phase 6"
      description="One row per trade with its own immutable trade ID, entry price, quantity, live value, and per-trade realized and unrealized P&L."
      bullets={[
        "Same-token trades never share entry price, quantity, fills, or P&L.",
        "Fresh price events update only the affected trade and portfolio totals.",
        "Market-price estimates are distinguished from executable proceeds.",
      ]}
    />
  );
}

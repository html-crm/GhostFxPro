import { Placeholder } from "@/components/Placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Trade History"
      phase="Phase 7"
      description="Closed and open trades with independent P&L, fees, duration, and reconciliation status."
      bullets={[
        "Realized P&L derives from reconciled fills and fees, not UI state.",
        "Ambiguous legacy records remain flagged for reconciliation.",
      ]}
    />
  );
}

import { Placeholder } from "@/components/Placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Markets"
      phase="Phase 5"
      description="Cross-chain market overview with price change, liquidity, and volume, backed by validated market data."
      bullets={[
        "Prices are observations, never execution guarantees.",
        "Stale or disconnected feeds are surfaced explicitly.",
      ]}
    />
  );
}

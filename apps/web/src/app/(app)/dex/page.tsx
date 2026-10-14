import { Placeholder } from "@/components/Placeholder";

export default function Page() {
  return (
    <Placeholder
      title="DEX Screener"
      phase="Phase 5"
      description="Token and pair discovery via the DEX Screener API, with search, chain filters, liquidity, volume, and freshness indicators."
      bullets={[
        "Market discovery is a separate system from execution.",
        "A token appearing here does not mean it is safe or executable.",
        "Data-source and freshness are shown for every value.",
      ]}
    />
  );
}

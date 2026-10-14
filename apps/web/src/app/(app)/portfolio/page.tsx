import { Placeholder } from "@/components/Placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Portfolio & P&L"
      phase="Phase 7"
      description="Aggregate performance with filters by date, chain, wallet, token, strategy, and status."
      bullets={[
        "No double-counting across orders, fills, positions, and strategy cycles.",
        "All money uses exact decimal arithmetic.",
      ]}
    />
  );
}

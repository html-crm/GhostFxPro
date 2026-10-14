import { Placeholder } from "@/components/Placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Exchange"
      phase="Phase 10"
      description="A separate exchange integration layer using only official, authorized interfaces (for example Robinhood, when eligibility is verified)."
      bullets={[
        "USDT and USDC are treated as distinct assets — never substituted.",
        "Unavailable pairs or regions are shown as limitations, not bypassed.",
      ]}
    />
  );
}

import { Placeholder } from "@/components/Placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Wallets"
      phase="Phase 5"
      description="Non-custodial wallet connections, token balances, and network-fee balances across supported chains."
      bullets={[
        "Seed phrases and private keys are never stored in plaintext or returned by the API.",
        "Supported chains: Solana, BNB Smart Chain (Robinhood only if officially available).",
      ]}
    />
  );
}

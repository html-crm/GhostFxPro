import { Placeholder } from "@/components/Placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Strategies"
      phase="Phase 8"
      description="Versioned strategy configuration with explicit precedence, activation, and rollback."
      bullets={[
        "Every trade records the exact strategy version it ran under.",
        "Changing a strategy produces a comparison report before activation.",
        "No silent rule conflicts: precedence is explicit.",
      ]}
    />
  );
}

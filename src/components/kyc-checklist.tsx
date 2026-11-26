import { Check, Circle } from "lucide-react";
import { KYC_STEPS, type KycStep } from "@/lib/kyc";

export function KycChecklist({ steps }: { steps?: KycStep[] | undefined }) {
  const items: KycStep[] =
    steps?.length === KYC_STEPS.length
      ? steps
      : KYC_STEPS.map((step) => ({ ...step, complete: false }));
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {items.map((step, index) => (
        <div
          key={step.key}
          className={`flex items-center gap-3 rounded-lg border px-3 py-3 ${
            step.complete ? "border-primary/40 bg-primary/5" : "bg-card"
          }`}
        >
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold ${
              step.complete
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            {step.complete ? <Check className="h-3.5 w-3.5" /> : index + 1}
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold">{step.label}</span>
          {!step.complete && <Circle className="h-3 w-3 text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}

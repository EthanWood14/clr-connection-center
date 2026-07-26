import { cn } from "@/lib/utils";

type LapBrandProps = {
  compact?: boolean;
  inverse?: boolean;
  className?: string;
};

export function LapBrand({ compact = false, inverse = false, className }: LapBrandProps) {
  if (compact) {
    return (
      <img
        src="/lap-icon.svg"
        alt="LAP"
        className={cn("h-10 w-10 shrink-0", className)}
      />
    );
  }

  return (
    <img
      src={inverse ? "/lap-wordmark-light.svg" : "/lap-wordmark.svg"}
      alt="LAP — LO Assistant Portal"
      className={cn("h-11 w-auto", className)}
    />
  );
}

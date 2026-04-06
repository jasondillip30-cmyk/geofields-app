import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, description, action, className }: SectionHeaderProps) {
  const compactDescription = description ? compactHeaderDescription(description) : null;

  return (
    <div className={cn("gf-section-heading", className)}>
      <div className="gf-section-heading-block">
        <h2 className="gf-section-title">{title}</h2>
        {compactDescription ? (
          <p
            className="gf-section-subtitle"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden"
            }}
          >
            {compactDescription}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function compactHeaderDescription(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= 110) {
    return normalized;
  }
  return `${normalized.slice(0, 107).trimEnd()}...`;
}

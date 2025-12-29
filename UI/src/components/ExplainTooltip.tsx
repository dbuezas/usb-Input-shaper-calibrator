import type { ReactNode } from 'react';

import { ConfiguredTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type ExplainTooltipProps = {
  title: ReactNode;
  accurate: ReactNode;
  intuition: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
};

export function ExplainTooltip({
  title,
  accurate,
  intuition,
  children,
  side = 'top',
  sideOffset = 6,
}: ExplainTooltipProps) {
  return (
    <ConfiguredTooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={sideOffset}>
        <div className="max-w-90 leading-snug">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="mt-2">{accurate}</div>
          <div className="text-muted-foreground mt-2">{intuition}</div>
        </div>
      </TooltipContent>
    </ConfiguredTooltip>
  );
}

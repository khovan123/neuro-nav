/* ============================================================
   TOOLTIP — Uses native title attribute for reliable display
   Chrome extension popups have a hard viewport boundary that
   clips ALL positioned elements (even fixed/portal). The native
   title attribute is rendered by the browser outside the popup.
   ============================================================ */

import { type ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  /** @deprecated Kept for API compat — native titles are browser-positioned */
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <div className="relative inline-flex" title={content}>
      {children}
    </div>
  );
}

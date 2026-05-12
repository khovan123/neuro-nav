/* ============================================================
   TOOLTIP — Hover tooltip with viewport-aware clamping
   Chrome extension popups have a hard viewport boundary that
   clips all content. Tooltips must stay within bounds.
   ============================================================ */

import { type ReactNode, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const gap = 6;

    // We need to measure the tooltip after render, but for initial positioning
    // we estimate. The actual clamping happens via a second pass.
    let top = 0;
    let left = 0;

    switch (position) {
      case 'bottom':
        top = triggerRect.bottom + gap;
        left = triggerRect.left + triggerRect.width / 2;
        break;
      case 'top':
        top = triggerRect.top - gap;
        left = triggerRect.left + triggerRect.width / 2;
        break;
      case 'left':
        top = triggerRect.top + triggerRect.height / 2;
        left = triggerRect.left - gap;
        break;
      case 'right':
        top = triggerRect.top + triggerRect.height / 2;
        left = triggerRect.right + gap;
        break;
    }

    setStyle({ top, left });

    // Second pass: clamp after the tooltip is rendered and measurable
    requestAnimationFrame(() => {
      if (!tooltipRef.current) return;
      const tipRect = tooltipRef.current.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const pad = 4; // min distance from viewport edge

      let adjTop = top;
      let adjLeft = left;

      // Horizontal clamping
      const halfW = tipRect.width / 2;
      if (position === 'top' || position === 'bottom') {
        // Centered horizontally — clamp so tooltip doesn't escape left/right
        if (left - halfW < pad) adjLeft = halfW + pad;
        if (left + halfW > vw - pad) adjLeft = vw - halfW - pad;
      }
      if (position === 'left') {
        if (left - tipRect.width < pad) adjLeft = triggerRect.right + gap; // flip to right
      }
      if (position === 'right') {
        if (left + tipRect.width > vw - pad) adjLeft = triggerRect.left - gap - tipRect.width;
      }

      // Vertical clamping
      if (position === 'top') {
        if (top - tipRect.height < pad) {
          adjTop = triggerRect.bottom + gap; // flip to bottom
        }
      }
      if (position === 'bottom') {
        if (top + tipRect.height > vh - pad) {
          adjTop = triggerRect.top - gap - tipRect.height; // flip to top
        }
      }

      if (adjTop !== top || adjLeft !== left) {
        setStyle({ top: adjTop, left: adjLeft });
      }
    });
  }, [position]);

  const transformMap: Record<string, string> = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  };

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => { setVisible(true); updatePosition(); }}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && createPortal(
        <div
          ref={tooltipRef}
          className={[
            'fixed z-9999 px-2 py-1',
            'text-[11px] font-medium text-text-primary whitespace-nowrap',
            'bg-surface-overlay border border-border-default rounded-md',
            'shadow-md pointer-events-none',
            'animate-fade-in',
          ].join(' ')}
          style={{
            ...style,
            transform: transformMap[position],
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </div>
  );
}

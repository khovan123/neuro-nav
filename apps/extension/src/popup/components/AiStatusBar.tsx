/* ============================================================
   AI STATUS BAR — Compact progress indicator for model loading
   Shows in the popup header area during model download.
   Briefly flashes when popup opens if model is already ready.
   ============================================================ */

import { useState, useEffect, useRef } from 'react';
import { IconBrain } from '@/shared/ui/Icons';
import type { AiModelStatus } from '@/store';

export function AiStatusBar() {
  const [status, setStatus] = useState<AiModelStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState('');
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Query initial status from background
    chrome.runtime.sendMessage({ type: 'GET_AI_STATUS' }, (response) => {
      if (chrome.runtime.lastError) return; // popup closed
      if (response?.status) {
        setStatus(response.status);

        if (response.status === 'loading') {
          setVisible(true);
        } else if (response.status === 'ready') {
          // Flash briefly so user sees the model is ready
          setProgress(100);
          setVisible(true);
          hideTimer.current = setTimeout(() => setVisible(false), 3000);
        }
      }
    });

    // Listen for status and progress updates
    const listener = (message: any) => {
      if (message.type === 'AI_STATUS_CHANGED') {
        setStatus(message.status);

        if (message.status === 'loading') {
          setVisible(true);
          if (hideTimer.current) clearTimeout(hideTimer.current);
        } else if (message.status === 'ready') {
          setProgress(100);
          setVisible(true);
          hideTimer.current = setTimeout(() => setVisible(false), 3000);
        } else if (message.status === 'error') {
          setVisible(true);
          hideTimer.current = setTimeout(() => setVisible(false), 5000);
        }
      }

      if (message.type === 'AI_PROGRESS') {
        setProgress(message.progress ?? 0);
        if (message.file) setFileName(message.file);
        setVisible(true);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!visible) return null;

  const isReady = status === 'ready';
  const isError = status === 'error';

  return (
    <div className="px-3 py-1.5 border-b border-border-subtle bg-surface-raised/60 animate-fade-in">
      <div className="flex items-center gap-2">
        <IconBrain
          size={14}
          className={
            isReady
              ? 'text-emerald-400'
              : isError
              ? 'text-red-400'
              : 'text-accent-primary animate-pulse'
          }
        />
        <span className="text-[10px] text-text-secondary flex-1 truncate">
          {isReady
            ? 'Ready'
            : isError
            ? 'Set up failed'
            : fileName
            ? `Loading config: ${fileName.split('/').pop()}`
            : 'Setup ...'}
        </span>
        <span className="text-[10px] font-mono text-text-tertiary w-8 text-right">
          {Math.round(progress)}%
        </span>
      </div>

      {/* Progress bar */}
      {!isReady && !isError && (
        <div className="mt-1 h-1 bg-surface-overlay rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Compact AI status dot for the header bar.
 * Always visible — shows AI model readiness at a glance.
 */
export function AiStatusDot() {
  const [status, setStatus] = useState<AiModelStatus>('idle');

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_AI_STATUS' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.status) setStatus(response.status);
    });

    const listener = (message: any) => {
      if (message.type === 'AI_STATUS_CHANGED') {
        setStatus(message.status);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const label =
    status === 'ready'
      ? 'AI: Ready'
      : status === 'loading'
      ? 'AI: Loading…'
      : status === 'error'
      ? 'AI: Error'
      : 'AI: Idle';

  const dotClass =
    status === 'ready'
      ? 'bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.5)]'
      : status === 'loading'
      ? 'bg-amber-400 animate-pulse'
      : status === 'error'
      ? 'bg-red-400'
      : 'bg-zinc-600';

  return (
    <span title={label} className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
  );
}

/* ============================================================
   CONTENT SCRIPT — DOM Text Extractor with 15s dwell timer
   Extracts main text content from pages after the user dwells
   for 15 seconds, sending it to the background SW for indexing.
   ============================================================ */

(() => {
  const DWELL_TIME_MS = 15_000;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let extracted = false;

  /** Strip noise elements and extract readable text. */
  function extractPageText(): string {
    // Clone body to avoid modifying the live DOM
    const clone = document.body.cloneNode(true) as HTMLElement;

    // Remove noise elements
    const noiseSelectors = [
      'nav', 'footer', 'header', 'aside',
      'script', 'style', 'noscript', 'iframe',
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      '.cookie-banner', '.modal', '.popup', '.ad', '.sidebar',
      '#cookie-consent', '#nav', '#footer', '#sidebar',
    ];
    noiseSelectors.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });

    // Get text from main content areas, or fall back to body
    const mainContent = clone.querySelector('main, article, [role="main"], .content, #content');
    const target = mainContent ?? clone;

    // Extract and clean text
    const raw = target.textContent ?? '';
    return raw
      .replace(/\s+/g, ' ')           // Collapse whitespace
      .replace(/\n{3,}/g, '\n\n')     // Max 2 newlines
      .trim()
      .slice(0, 10_000);              // Cap at 10k chars for embedding
  }

  /** Extract metadata from the page. */
  function extractMetadata(): { title: string; url: string; description: string; favicon: string } {
    const meta = document.querySelector('meta[name="description"]');
    return {
      title: document.title || '',
      url: window.location.href,
      description: (meta as HTMLMetaElement)?.content ?? '',
      favicon: (document.querySelector('link[rel*="icon"]') as HTMLLinkElement)?.href ?? '',
    };
  }

  /** Send extracted content to background for indexing. */
  function handleDwellComplete() {
    if (extracted) return;
    extracted = true;

    // Use requestIdleCallback so DOM extraction doesn't block main thread animations/scrolling
    const runExtraction = () => {
      try {
        const text = extractPageText();
        if (text.length < 50) return; // Skip near-empty pages

        const metadata = extractMetadata();

        // Guard: chrome.runtime becomes undefined when extension context is invalidated
        // (e.g. after extension reload/update). Fail silently — the new content script
        // will be injected on next navigation.
        if (!chrome.runtime?.id) return;

        chrome.runtime.sendMessage({
          type: 'PAGE_CONTENT_EXTRACTED',
          payload: {
            ...metadata,
            text,
            extractedAt: Date.now(),
          },
        }).catch(() => {
          // Background may not be listening yet — that's OK
        });
      } catch (err) {
        // Silently ignore if extension context invalidated
        if (String(err).includes('Extension context invalidated')) return;
        console.error('[Neuro-Nav] Extraction failed:', err);
      }
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(runExtraction, { timeout: 2000 });
    } else {
      setTimeout(runExtraction, 100);
    }
  }

  /** Start the dwell timer. */
  function startDwellTimer() {
    if (dwellTimer || extracted) return;
    dwellTimer = setTimeout(handleDwellComplete, DWELL_TIME_MS);
  }

  /** Reset the dwell timer (e.g. on visibility change). */
  function resetDwellTimer() {
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
  }

  // ---- Lifecycle ----

  // Skip non-http pages
  if (!window.location.href.startsWith('http')) return;

  // Start timer on page load
  startDwellTimer();

  // Pause when tab is hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resetDwellTimer();
    } else if (!extracted) {
      startDwellTimer();
    }
  });
})();

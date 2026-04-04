const STYLE_ID = 'rsvp-page-highlight-style';
const ACTIVE_CLASS = 'rsvp-active-block';

export function ensurePageHighlightStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${ACTIVE_CLASS} {
      position: relative;
      background: linear-gradient(90deg, rgba(255, 241, 118, 0.34), rgba(255, 241, 118, 0.18)) !important;
      outline: 2px solid rgba(255, 241, 118, 0.88) !important;
      box-shadow:
        inset 4px 0 0 rgba(255, 193, 7, 0.92),
        0 0 0 5px rgba(255, 241, 118, 0.18) !important;
      transition: background 0.18s ease, box-shadow 0.18s ease;
      border-radius: 6px;
      scroll-margin-top: 18vh;
      scroll-margin-bottom: 24vh;
    }
  `;
  document.head.appendChild(style);
}

export function setHighlightedBlocks(blockIds: string[], scrollIntoView = false): void {
  clearHighlightedBlocks();
  let firstHighlighted: HTMLElement | null = null;
  blockIds.forEach(blockId => {
    document
      .querySelectorAll<HTMLElement>(`[data-rsvp-block-id="${CSS.escape(blockId)}"]`)
      .forEach(element => {
        firstHighlighted ??= element;
        element.classList.add(ACTIVE_CLASS);
      });
  });

  if (scrollIntoView && firstHighlighted) {
    scrollHighlightedIntoView(firstHighlighted);
  }
}

export function clearHighlightedBlocks(): void {
  document.querySelectorAll(`.${ACTIVE_CLASS}`).forEach(element => {
    element.classList.remove(ACTIVE_CLASS);
  });
}

function scrollHighlightedIntoView(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const topComfortZone = viewportHeight * 0.16;
  const bottomComfortZone = viewportHeight * 0.58;

  if (rect.top >= topComfortZone && rect.bottom <= bottomComfortZone) {
    return;
  }

  const targetTop = Math.max(
    0,
    window.scrollY + rect.top - viewportHeight * 0.22,
  );

  window.scrollTo({
    top: targetTop,
    behavior: 'auto',
  });
}

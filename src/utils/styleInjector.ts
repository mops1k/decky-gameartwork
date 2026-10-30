import { findSP } from '@decky/ui';

// Steam's document is gone during its own restarts and while the UI boots; an
// unguarded findSP() then throws "Cannot read properties of undefined (reading 'document')".
const getDocument = (): Document | undefined => {
  try {
    return findSP()?.window?.document;
  } catch {
    return undefined;
  }
};

export const addStyle = (id: string, css: string) => {
  const doc = getDocument();
  if (!doc) return;

  // inject css if it isn't there already
  const existingStyleEl = doc.getElementById(id);
  if (!existingStyleEl) {
    const styleEl = doc.createElement('style');
    styleEl.id = id;
    styleEl.textContent = css;
    doc.head.append(styleEl);
  }
};

export const removeStyle = (id: string) => {
  const existingStyleEl = getDocument()?.getElementById(id);
  existingStyleEl?.remove();
};

/**
  Updates the style if it exists, creates the style if not.
 */
export const updateStyle = (id: string, css: string) => {
  const existingStyleEl = getDocument()?.getElementById(id);
  if (existingStyleEl) {
    existingStyleEl.textContent = css;
  } else {
    addStyle(id, css);
  }
};

export const removeStyles = (...ids: string[]) => {
  for (let i = 0; i < ids.length; i++) {
    const elId = ids[i];
    removeStyle(elId);
  }
};

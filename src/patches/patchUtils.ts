import { Navigation } from '@decky/ui';

/**
 * A class component cannot be patched with `afterPatch(node, 'type', ...)`:
 * the patcher replaces it with a plain function that calls the original with
 * `.call()`, which throws "Class constructor X cannot be invoked without 'new'"
 * and takes Steam's UI down. Other plugins put their own class components into
 * the routes we patch (PS5 Dashboard wraps Steam's home in `class Fallback`).
 */
export function isClassComponent(node: any): boolean {
  return typeof node?.type === 'function' && !!node.type.prototype?.isReactComponent;
}

export function rerenderAfterPatchUpdate(): void {
  if (window.location.pathname.startsWith('/routes/library/home')) {
    Navigation.Navigate('/library/home');
    // ? We need to navigate back to not clog up the nav.
    Navigation.NavigateBack();
  } else if (window.location.pathname.startsWith('/routes/library')) {
    Navigation.Navigate('/library');
    // ? We need to navigate back to not clog up the nav.
    Navigation.NavigateBack();
  }
}
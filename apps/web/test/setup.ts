import '@testing-library/jest-dom/vitest';

/*
 * Browser APIs jsdom does not implement, which the Radix primitives behind Select, DropdownMenu,
 * Sheet, Dialog and Checkbox call while opening. Without these stubs those components throw on the
 * first interaction in a test, which reads as a component bug rather than a missing browser API.
 *
 * Each is a no-op: what they gate — pointer tracking during a drag, keeping the active option in
 * view, measuring an element that has no layout in jsdom — has nothing to assert headlessly.
 */
const stub = <Name extends keyof Element>(name: Name, implementation: Element[Name]): void => {
  if (typeof Element === 'undefined' || name in Element.prototype) return;
  Element.prototype[name] = implementation;
};

stub('hasPointerCapture', () => false);
stub('setPointerCapture', () => undefined);
stub('releasePointerCapture', () => undefined);
stub('scrollIntoView', () => undefined);

// Radix measures a few controls (the checkbox indicator, for one) with a ResizeObserver. jsdom
// elements never resize, so an observer that reports nothing is a faithful stand-in.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

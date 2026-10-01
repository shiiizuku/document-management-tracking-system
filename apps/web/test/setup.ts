import '@testing-library/jest-dom/vitest';

/*
 * jsdom implements neither the Pointer Capture API nor `scrollIntoView`, and the Radix primitives
 * behind Select, DropdownMenu and Sheet call both while opening. Without these stubs those
 * components throw on the first click in a test, which looks like a component bug rather than a
 * missing browser API. Each is a no-op: the behaviour they gate (pointer tracking during a drag,
 * keeping the active option in view) has nothing to assert in a headless DOM.
 */
const stub = <Name extends keyof Element>(name: Name, implementation: Element[Name]): void => {
  if (typeof Element === 'undefined' || name in Element.prototype) return;
  Element.prototype[name] = implementation;
};

stub('hasPointerCapture', () => false);
stub('setPointerCapture', () => undefined);
stub('releasePointerCapture', () => undefined);
stub('scrollIntoView', () => undefined);

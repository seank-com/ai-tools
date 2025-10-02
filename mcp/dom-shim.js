// Make the global look a bit browser-y up front.
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
if (typeof globalThis.self === "undefined") globalThis.self = globalThis;

// Minimal DOMMatrix shim for pdfjs-dist v4 when running in the extension host.
// Harmless for text extraction (we don't render or use canvas).
if (typeof globalThis.DOMMatrix === "undefined") {
  class FakeDOMMatrix {
    static fromFloat32Array() { return new FakeDOMMatrix(); }
    multiplySelf() { return this; }
    translateSelf() { return this; }
    scaleSelf() { return this; }
    rotateSelf() { return this; }
  }
  globalThis.DOMMatrix = FakeDOMMatrix;
  if (typeof globalThis.WebKitCSSMatrix === "undefined") {
    globalThis.WebKitCSSMatrix = FakeDOMMatrix;
  }
}

if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      platform: process.platform === "win32" ? "Win32" : process.platform,
      userAgent: `Node/${process.versions.node} Electron/${process.versions.electron || "ext-host"}`,
      language: "en-US",
      languages: ["en-US"],
      maxTouchPoints: 0,
    },
    configurable: true,
    enumerable: false,
    writable: false
  });
}

console.log("ai-tools: dom-shim loaded", {
  hasDOMMatrix: typeof globalThis.DOMMatrix,
  navigatorType: typeof globalThis.navigator,
  navDesc: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
});


/**
 * Ambient module declarations for the Wasm/browser boundary.
 *
 * Declaration-only module: no runtime code lives here. Only wildcard module
 * declarations for asset URL imports are provided; DOM globals come from
 * `lib: ["DOM", "DOM.Iterable"]` and must not be redeclared.
 */

/** Raw WebAssembly binary imported as a URL string (e.g. `?url` suffix). */
declare module "*.wasm?url" {
  const url: string;
  export default url;
}

/** Raw WebAssembly binary imported directly. */
declare module "*.wasm" {
  const url: string;
  export default url;
}

/** Generic asset imported as a URL string (e.g. `?url` suffix). */
declare module "*?url" {
  const url: string;
  export default url;
}

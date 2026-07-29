// Vite turns `?url` imports into emitted asset URLs; tsc only needs their shape.
declare module "*?url" {
  const assetUrl: string;

  export default assetUrl;
}

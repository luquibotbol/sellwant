/** Metro resolves .ttf imports to an asset module; TS needs to be told. */
declare module '*.ttf' {
  const asset: number;
  export default asset;
}

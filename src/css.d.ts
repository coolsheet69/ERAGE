/* CSS module declarations — silences TS side-effect import warnings */
declare module '*.css' {
  const content: { [className: string]: string }
  export default content
}

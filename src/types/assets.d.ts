/* Vite serves these; TypeScript needs to be told they exist. */
declare module '*.css';
declare module '*.png' {
  const src: string;
  export default src;
}

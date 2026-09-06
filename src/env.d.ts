/// <reference path="../.astro/types.d.ts" />

declare module '*.jsonl?raw' {
  const content: string;
  export default content;
}

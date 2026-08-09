export const source = import.meta.url;
export const tokens = async () =>
  (await fetch(new URL('./tokens.json', import.meta.url))).json();

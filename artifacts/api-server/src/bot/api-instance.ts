import type { Api } from "grammy";

let _api: Api | null = null;

export function setApi(api: Api): void {
  _api = api;
}

export function getApi(): Api {
  if (!_api) throw new Error("Bot API not initialized yet");
  return _api;
}

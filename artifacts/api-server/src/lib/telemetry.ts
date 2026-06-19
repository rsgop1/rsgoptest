import { EventEmitter } from "events";

export const telemetryEmitter = new EventEmitter();
telemetryEmitter.setMaxListeners(200);

const eventBuffer: string[] = [];
const MAX_BUFFER = 500;

export function emitTelemetry(message: string): void {
  const ts = new Date().toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const line = `[${ts}] ${message}`;
  eventBuffer.push(line);
  if (eventBuffer.length > MAX_BUFFER) eventBuffer.shift();
  telemetryEmitter.emit("event", line);
}

export function getRecentEvents(n = 150): string[] {
  return eventBuffer.slice(-n);
}

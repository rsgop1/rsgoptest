import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Terminal, Circle, Trash2 } from "lucide-react";

export default function Telemetry() {
  const [logs, setLogs] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const connect = () => {
      const es = new EventSource("/api/admin/telemetry/stream", { withCredentials: true });
      esRef.current = es;

      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es.close();
        setTimeout(connect, 3000);
      };
      es.onmessage = (e) => {
        try {
          const line = JSON.parse(e.data) as string;
          setLogs(prev => [...prev.slice(-500), line]);
        } catch {}
      };
    };

    connect();
    return () => {
      esRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  function colorize(line: string): { text: string; color: string } {
    const lower = line.toLowerCase();
    if (lower.includes("error") || lower.includes("fail") || lower.includes("reject")) return { text: line, color: "#ff5f57" };
    if (lower.includes("paid") || lower.includes("approved") || lower.includes("premium")) return { text: line, color: "#5af78e" };
    if (lower.includes("joined") || lower.includes("new user")) return { text: line, color: "#57c7ff" };
    if (lower.includes("started test") || lower.includes("completed")) return { text: line, color: "#f3f99d" };
    if (lower.includes("broadcast") || lower.includes("cleanup") || lower.includes("ad")) return { text: line, color: "#ff9f0a" };
    return { text: line, color: "#c0c0c0" };
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Terminal className="h-8 w-8 text-green-500" />
            Live Server Terminal
          </h1>
          <p className="text-muted-foreground mt-1">Real-time bot activity log.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className={connected ? "border-green-500 text-green-500" : "border-red-500 text-red-500"}
          >
            <Circle className={`h-2 w-2 mr-1.5 fill-current ${connected ? "text-green-500" : "text-red-500"}`} />
            {connected ? "Connected" : "Reconnecting..."}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoScroll(v => !v)}
            className={autoScroll ? "border-green-500 text-green-500" : ""}
          >
            Auto-scroll: {autoScroll ? "ON" : "OFF"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLogs([])}
            className="text-muted-foreground"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Clear
          </Button>
        </div>
      </div>

      <Card className="border-0 bg-black rounded-xl overflow-hidden shadow-2xl">
        <CardHeader className="bg-zinc-900 py-2 px-4 flex flex-row items-center gap-2 border-b border-zinc-800">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-xs text-zinc-500 font-mono ml-2">series-testpro — bot telemetry</span>
          <div className="ml-auto">
            <Badge variant="outline" className="text-xs font-mono border-zinc-700 text-zinc-400">
              {logs.length} events
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div
            className="h-[600px] overflow-y-auto p-4 font-mono text-sm"
            style={{ background: "#0d1117" }}
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
              setAutoScroll(atBottom);
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: "#666" }} className="text-center mt-20">
                <Terminal className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="opacity-50">Waiting for bot events...</p>
                <p className="text-xs opacity-30 mt-1">Activity will appear here in real-time</p>
              </div>
            ) : (
              logs.map((line, i) => {
                const { color } = colorize(line);
                const parts = line.match(/^(\[\d{2}:\d{2}:\d{2}\])\s(.*)$/);
                return (
                  <div key={i} className="mb-0.5 leading-5">
                    {parts ? (
                      <>
                        <span style={{ color: "#666" }}>{parts[1]} </span>
                        <span style={{ color }}>{"▸"} </span>
                        <span style={{ color }}>{parts[2]}</span>
                      </>
                    ) : (
                      <span style={{ color }}>{line}</span>
                    )}
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

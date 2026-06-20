import { useState, useEffect } from "react";
import { 
  useAdminGetSettings, 
  useAdminUpdateSettings, 
  useAdminBroadcast,
  getAdminGetSettingsQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Save, Send, Megaphone, Settings as SettingsIcon, Users, Download, Upload, Plus, Trash2 } from "lucide-react";
import { useRef } from "react";

interface BotGroup {
  id: string;
  name: string;
}

export default function Settings() {
  const { data: settings, isLoading } = useAdminGetSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    admin_upi_vpa: "",
    force_sub_enabled: "false",
    force_sub_channel: "",
    leaderboard_channel: "",
    anon_doubt_group: "",
    bot_groups: "[]",
  });

  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastTarget, setBroadcastTarget] = useState("all");
  const [botGroups, setBotGroups] = useState<BotGroup[]>([]);
  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");

  useEffect(() => {
    if (settings) {
      const s = settings as any;
      setFormData({
        admin_upi_vpa: s.admin_upi_vpa || "",
        force_sub_enabled: s.force_sub_enabled || "false",
        force_sub_channel: s.force_sub_channel || "",
        leaderboard_channel: s.leaderboard_channel || "",
        anon_doubt_group: s.anon_doubt_group || "",
        bot_groups: s.bot_groups || "[]",
      });
      try {
        setBotGroups(JSON.parse(s.bot_groups || "[]"));
      } catch { setBotGroups([]); }
    }
  }, [settings]);

  const updateMutation = useAdminUpdateSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminGetSettingsQueryKey() });
        toast({ title: "Settings updated" });
      }
    }
  });

  const broadcastMutation = useAdminBroadcast({
    mutation: {
      onSuccess: (res) => {
        toast({ 
          title: "Broadcast complete", 
          description: `Successfully sent: ${res.sent}, Failed: ${res.failed}` 
        });
        setBroadcastMsg("");
      }
    }
  });

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const saveData = {
      ...formData,
      bot_groups: JSON.stringify(botGroups),
    };
    updateMutation.mutate({ data: saveData });
  };

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMsg) return;
    if (confirm(`Send this broadcast to ${broadcastTarget}?`)) {
      broadcastMutation.mutate({ data: { message: broadcastMsg, target: broadcastTarget } });
    }
  };

  const addGroup = () => {
    if (!newGroupId.trim()) return;
    const group: BotGroup = { id: newGroupId.trim(), name: newGroupName.trim() || newGroupId.trim() };
    setBotGroups((g) => [...g, group]);
    setNewGroupId("");
    setNewGroupName("");
  };

  const removeGroup = (id: string) => {
    setBotGroups((g) => g.filter((x) => x.id !== id));
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleExportAll = () => {
    window.open("/api/admin/export/all", "_blank");
  };

  const handleImportAll = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch("/api/admin/import/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const result = await res.json() as { success?: boolean; imported?: Record<string, number>; error?: string };
      if (result.success) {
        toast({
          title: "✅ Import Successful",
          description: `Users: ${result.imported?.users ?? 0}, Tests: ${result.imported?.tests ?? 0}, Payments: ${result.imported?.payments ?? 0}`,
        });
      } else {
        toast({ title: "❌ Import Failed", description: result.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "❌ Import Failed", description: "Invalid JSON file", variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>
        <p className="text-muted-foreground mt-1">Configure bot behavior, payments, groups, and exports.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Global Config */}
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5 text-primary" />
              <CardTitle>Global Configuration</CardTitle>
            </div>
            <CardDescription>Payment, force-sub, and channel settings</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveSettings} className="space-y-5">
              <div className="space-y-2">
                <Label>Admin UPI ID (VPA)</Label>
                <Input 
                  value={formData.admin_upi_vpa} 
                  onChange={e => setFormData({...formData, admin_upi_vpa: e.target.value})}
                  placeholder="8102289714@ptyes"
                />
                <p className="text-xs text-muted-foreground">Used for manual UPI payments by users.</p>
              </div>

              <div className="space-y-2">
                <Label>Leaderboard Channel ID/Username</Label>
                <Input
                  value={formData.leaderboard_channel}
                  onChange={e => setFormData({...formData, leaderboard_channel: e.target.value})}
                  placeholder="@testbook_leaderboard or -1001234567"
                />
              </div>

              <div className="space-y-2">
                <Label>Anonymous Doubts Group ID</Label>
                <Input
                  value={formData.anon_doubt_group}
                  onChange={e => setFormData({...formData, anon_doubt_group: e.target.value})}
                  placeholder="-1001234567890"
                />
                <p className="text-xs text-muted-foreground">Group where /anon doubts are posted anonymously.</p>
              </div>

              <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-base">Force Subscription</Label>
                    <p className="text-xs text-muted-foreground">Require joining a channel to use the bot</p>
                  </div>
                  <Switch 
                    checked={formData.force_sub_enabled === "true"}
                    onCheckedChange={(checked) => setFormData({...formData, force_sub_enabled: checked ? "true" : "false"})}
                  />
                </div>
                
                {formData.force_sub_enabled === "true" && (
                  <div className="space-y-2 pt-2">
                    <Label>Channel Username / ID</Label>
                    <Input 
                      value={formData.force_sub_channel} 
                      onChange={e => setFormData({...formData, force_sub_channel: e.target.value})}
                      placeholder="@testbook_plus or -1001234567890"
                    />
                    <p className="text-xs text-muted-foreground">
                      Bot must be admin of this channel with "Read Messages" permission.
                    </p>
                  </div>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />
                {updateMutation.isPending ? "Saving..." : "Save Configuration"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Broadcast */}
        <Card className="shadow-sm border-t-4 border-t-primary">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              <CardTitle>Broadcast Engine</CardTitle>
            </div>
            <CardDescription>Send mass messages to bot users</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleBroadcast} className="space-y-5">
              <div className="space-y-2">
                <Label>Target Audience</Label>
                <Select value={broadcastTarget} onValueChange={setBroadcastTarget}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    <SelectItem value="premium">Premium Users Only</SelectItem>
                    <SelectItem value="free">Free Users Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Message Content</Label>
                <Textarea 
                  value={broadcastMsg} 
                  onChange={e => setBroadcastMsg(e.target.value)}
                  placeholder="Enter broadcast message here... Plain text (no MarkdownV2 needed)."
                  className="min-h-[120px] resize-none"
                />
              </div>

              <Button 
                type="submit" 
                className="w-full bg-primary hover:bg-primary/90" 
                disabled={broadcastMutation.isPending || !broadcastMsg}
              >
                <Send className="h-4 w-4 mr-2" />
                {broadcastMutation.isPending ? "Sending Broadcast..." : "Fire Broadcast"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Bot Groups for Achievement Titles */}
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle>Achievement Title Groups</CardTitle>
          </div>
          <CardDescription>
            Bot will set custom Telegram titles for users with achievements in these groups.
            Bot must be admin with "Add New Admins" permission in each group.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {botGroups.length > 0 && (
            <div className="space-y-2">
              {botGroups.map((g) => (
                <div key={g.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                  <div>
                    <p className="font-medium text-sm">{g.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{g.id}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeGroup(g.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <div className="flex-1 space-y-2">
              <Input
                placeholder="Group ID (e.g. -1001234567890)"
                value={newGroupId}
                onChange={e => setNewGroupId(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-2">
              <Input
                placeholder="Group Name (optional)"
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
              />
            </div>
            <Button type="button" onClick={addGroup} disabled={!newGroupId.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-xs text-muted-foreground space-y-1 bg-muted/30 rounded-lg p-3">
            <p className="font-medium">Achievement titles awarded:</p>
            <p>🎯 Accuracy God • ⚡ The Flash • 🧠 Iron Brain • 👑 Comeback King • 🦉 Night Owl • 🏃 Marathon Runner</p>
          </div>

          <Button
            onClick={() => {
              const saveData = { ...formData, bot_groups: JSON.stringify(botGroups) };
              updateMutation.mutate({ data: saveData });
            }}
            disabled={updateMutation.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            Save Groups
          </Button>
        </CardContent>
      </Card>

      {/* Export / Import */}
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            <CardTitle>Backup & Restore</CardTitle>
          </div>
          <CardDescription>Export all bot data as JSON or restore from a backup file</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg space-y-3">
              <div>
                <p className="font-medium text-sm">Export All Data</p>
                <p className="text-xs text-muted-foreground">Downloads full backup — users, tests, payments, history, achievements, settings</p>
              </div>
              <Button className="w-full" onClick={handleExportAll}>
                <Download className="h-4 w-4 mr-2" />
                Download Backup (.json)
              </Button>
            </div>

            <div className="p-4 border rounded-lg space-y-3">
              <div>
                <p className="font-medium text-sm">Import Data</p>
                <p className="text-xs text-muted-foreground">Restore from a backup JSON file — existing records are kept, new ones are added</p>
              </div>
              <input
                type="file"
                accept=".json"
                ref={fileInputRef}
                className="hidden"
                onChange={handleImportAll}
              />
              <Button
                variant="outline"
                className="w-full"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                {importing ? "Importing…" : "Import Backup (.json)"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

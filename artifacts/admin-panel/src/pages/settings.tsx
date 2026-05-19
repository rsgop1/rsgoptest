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
import { Save, Send, Megaphone, Settings as SettingsIcon } from "lucide-react";

export default function Settings() {
  const { data: settings, isLoading } = useAdminGetSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    admin_upi_vpa: "",
    force_sub_enabled: "false",
    force_sub_channel: ""
  });

  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastTarget, setBroadcastTarget] = useState("all");

  useEffect(() => {
    if (settings) {
      setFormData({
        admin_upi_vpa: settings.admin_upi_vpa || "",
        force_sub_enabled: settings.force_sub_enabled || "false",
        force_sub_channel: settings.force_sub_channel || ""
      });
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
    updateMutation.mutate({ data: formData });
  };

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMsg) return;
    if (confirm(`Send this broadcast to ${broadcastTarget}?`)) {
      broadcastMutation.mutate({ data: { message: broadcastMsg, target: broadcastTarget } });
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
        <p className="text-muted-foreground mt-1">Configure bot behavior, payments, and send broadcasts.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5 text-primary" />
              <CardTitle>Global Configuration</CardTitle>
            </div>
            <CardDescription>Payment and access settings</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveSettings} className="space-y-6">
              <div className="space-y-2">
                <Label>Admin UPI ID (VPA)</Label>
                <Input 
                  value={formData.admin_upi_vpa} 
                  onChange={e => setFormData({...formData, admin_upi_vpa: e.target.value})}
                  placeholder="name@upi"
                />
                <p className="text-xs text-muted-foreground">Used for manual payment approvals.</p>
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
                      placeholder="@testbook_plus"
                    />
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

        <Card className="shadow-sm border-t-4 border-t-primary">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              <CardTitle>Broadcast Engine</CardTitle>
            </div>
            <CardDescription>Send mass messages to bot users</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleBroadcast} className="space-y-6">
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
                  placeholder="Enter broadcast message here... Telegram markdown is supported."
                  className="min-h-[150px] resize-none"
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
    </div>
  );
}

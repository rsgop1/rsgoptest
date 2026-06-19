import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Megaphone, Info } from "lucide-react";

const BASE = "/api/admin";

interface Ad {
  id: number;
  title: string;
  mediaType: string;
  telegramFileId: string | null;
  adText: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  isActive: boolean;
  frequencyEvery: number;
  createdAt: string;
}

export default function Ads() {
  const { toast } = useToast();
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    mediaType: "image",
    telegramFileId: "",
    adText: "",
    buttonText: "",
    buttonUrl: "",
    frequencyEvery: "1",
  });

  const fetchAds = async () => {
    setLoading(true);
    const r = await fetch(`${BASE}/ads`, { credentials: "include" });
    if (r.ok) setAds(await r.json());
    setLoading(false);
  };

  useEffect(() => { fetchAds(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch(`${BASE}/ads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(form),
    });
    if (r.ok) {
      toast({ title: "✅ Ad created" });
      setCreateOpen(false);
      setForm({ title: "", mediaType: "image", telegramFileId: "", adText: "", buttonText: "", buttonUrl: "", frequencyEvery: "1" });
      fetchAds();
    } else {
      const err = await r.json();
      toast({ title: "Error", description: err.error, variant: "destructive" });
    }
  };

  const handleToggle = async (id: number, isActive: boolean) => {
    await fetch(`${BASE}/ads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isActive: !isActive }),
    });
    fetchAds();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this ad?")) return;
    await fetch(`${BASE}/ads/${id}`, { method: "DELETE", credentials: "include" });
    toast({ title: "Ad deleted" });
    fetchAds();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Megaphone className="h-8 w-8 text-orange-500" />
            Ad Gateway
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage sponsored ads shown to free users before tests.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-orange-500 hover:bg-orange-600">
              <Plus className="h-4 w-4 mr-2" /> New Ad
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Ad</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Ad Title (internal)</Label>
                <Input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Summer Coaching Promo" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Media Type</Label>
                  <Select value={form.mediaType} onValueChange={v => setForm({ ...form, mediaType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="image">🖼️ Image</SelectItem>
                      <SelectItem value="gif">🎞️ GIF / Animation</SelectItem>
                      <SelectItem value="video">🎬 Video</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Show every N tests</Label>
                  <Input type="number" min={1} value={form.frequencyEvery} onChange={e => setForm({ ...form, frequencyEvery: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Telegram File ID</Label>
                <Input value={form.telegramFileId} onChange={e => setForm({ ...form, telegramFileId: e.target.value })} placeholder="AgACAgIAAxk..." />
                <p className="text-xs text-muted-foreground">Forward the image/gif/video to @userinfobot to get the File ID</p>
              </div>
              <div className="space-y-2">
                <Label>Ad Text / Caption</Label>
                <Textarea value={form.adText} onChange={e => setForm({ ...form, adText: e.target.value })} placeholder="Join our coaching now! Limited seats." rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Button Text</Label>
                  <Input value={form.buttonText} onChange={e => setForm({ ...form, buttonText: e.target.value })} placeholder="Visit Now →" />
                </div>
                <div className="space-y-2">
                  <Label>Button URL</Label>
                  <Input value={form.buttonUrl} onChange={e => setForm({ ...form, buttonUrl: e.target.value })} placeholder="https://..." />
                </div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex gap-2">
                <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Free users see this ad for 15 seconds before starting a test. After 15s, a "Skip" button appears. Premium users never see ads.
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-orange-500 hover:bg-orange-600">Create Ad</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading ads...</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center h-32 text-muted-foreground">
                      No ads created yet. Create your first ad above.
                    </TableCell>
                  </TableRow>
                ) : ads.map((ad) => (
                  <TableRow key={ad.id}>
                    <TableCell>
                      <div className="font-semibold">{ad.title}</div>
                      {ad.adText && <div className="text-xs text-muted-foreground truncate max-w-xs">{ad.adText}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {ad.mediaType === "video" ? "🎬 Video" : ad.mediaType === "gif" ? "🎞️ GIF" : "🖼️ Image"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">Every {ad.frequencyEvery} test(s)</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={ad.isActive}
                          onCheckedChange={() => handleToggle(ad.id, ad.isActive)}
                        />
                        <span className="text-sm text-muted-foreground">{ad.isActive ? "Active" : "Paused"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(ad.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

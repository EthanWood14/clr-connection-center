import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2 } from "lucide-react";

export default function InviteAccept() {
  const [, params] = useRoute<{ token: string }>("/invite/:token");
  const token = params?.token ?? "";
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) { setError("Invalid invite link"); setLoading(false); return; }
    apiRequest("GET", `/api/invite/${token}`)
      .then((data) => setInvite(data))
      .catch((e) => setError(e.message ?? "Invite not valid"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setSubmitting(true);
    try {
      await apiRequest("POST", `/api/invite/${token}/accept`, { name, password });
      setSuccess(true);
      setTimeout(() => { window.location.hash = "#/login"; }, 2000);
    } catch (err: any) {
      setError(err.message ?? "Failed to accept invite");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <Card className="max-w-md w-full">
          <CardHeader><CardTitle>Invite Not Valid</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button className="mt-4" onClick={() => (window.location.hash = "#/login")}>Go to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-600" />
            <h2 className="text-xl font-semibold mb-2">Account created!</h2>
            <p className="text-sm text-muted-foreground">Redirecting to login…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Join {invite?.orgName}</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            You've been invited to join <strong>{invite?.orgName}</strong> on CLR Connection Center as {invite?.role}.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input value={invite?.email ?? ""} disabled />
            </div>
            <div>
              <Label>Full Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-name" />
            </div>
            <div>
              <Label>Password (min 8 characters)</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="input-password" />
            </div>
            <div>
              <Label>Confirm Password</Label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required data-testid="input-confirm" />
            </div>
            {error && <div className="text-sm text-destructive">{error}</div>}
            <Button type="submit" disabled={submitting} className="w-full" data-testid="button-accept">
              {submitting ? "Creating account…" : "Accept Invite"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

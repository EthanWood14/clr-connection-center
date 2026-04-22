import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Users, Phone, Mail, X } from "lucide-react";
import { InfoBanner } from "@/components/info-banner";

type Contact = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  bonzo_prospect_id: string | null;
  bonzo_pipeline: string | null;
  bonzo_stage: string | null;
  bonzo_assigned_user: string | null;
  mojo_contact_id: string | null;
  mojo_group: string | null;
  mojo_status: string | null;
  clr_user_id: number | null;
  clr_user_name: string | null;
  lo_id: number | null;
  lo_name: string | null;
  total_calls: number;
  total_transfers: number;
  total_appointments: number;
  last_outcome_type: string | null;
  last_outcome_date: string | null;
  last_call_date: string | null;
  source: string;
  updated_at: string;
};

type ContactDetail = Contact & {
  outcomes: any[];
  bonzoProspect: any | null;
  mojoContact: any | null;
  mojoSessions: any[];
};

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    bonzo: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    mojo: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    manual: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
    csv: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  };
  return <Badge className={`${map[source] || map.manual} capitalize`}>{source}</Badge>;
}

function formatPhone(p: string | null) {
  if (!p) return "—";
  const d = String(p).replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return p;
}

export default function ContactsPage() {
  useEffect(() => { document.title = "Contact Hub · WCLCC"; }, []);

  const [search, setSearch] = useState("");
  const [clrFilter, setClrFilter] = useState<string>("all");
  const [loFilter, setLoFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("search", search.trim());
    if (clrFilter !== "all") p.set("clrUserId", clrFilter);
    if (loFilter !== "all") p.set("loId", loFilter);
    if (sourceFilter !== "all") p.set("source", sourceFilter);
    p.set("limit", "200");
    return p.toString();
  }, [search, clrFilter, loFilter, sourceFilter]);

  const { data, isLoading } = useQuery<{ rows: Contact[]; total: number }>({
    queryKey: [`/api/contacts?${qs}`],
  });

  const { data: users } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const { data: los } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  const rows = data?.rows ?? [];
  const clrUsers = (users ?? []).filter((u: any) => u.isActive && (u.role === "assistant" || u.role === "admin"));

  return (
    <div className="p-4 md:p-6 space-y-4 w-full max-w-full">
      <InfoBanner storageKey="contacts_hub_info" variant="info" title="Contact Hub">
        Contacts are automatically populated from Bonzo webhooks, Mojo webhooks, and CSV imports. To see your full contact list, connect Bonzo (via API token in Integrations) and set up Mojo webhooks. Contacts are matched across platforms by phone number.
      </InfoBanner>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> Contact Hub</CardTitle>
              <CardDescription>Unified view of every prospect from Bonzo, Mojo, CSV imports, and manual entries.</CardDescription>
            </div>
            <Badge variant="outline">{data?.total ?? 0} contacts</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, email…" className="pl-9" />
            </div>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="bonzo">Bonzo</SelectItem>
                <SelectItem value="mojo">Mojo</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
            <Select value={clrFilter} onValueChange={setClrFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="CLR" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All CLRs</SelectItem>
                {clrUsers.map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={loFilter} onValueChange={setLoFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="LO" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All LOs</SelectItem>
                {(los ?? []).map((lo: any) => <SelectItem key={lo.id} value={String(lo.id)}>{lo.fullName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">Name</th>
                  <th className="p-2">Phone</th>
                  <th className="p-2">Email</th>
                  <th className="p-2">Bonzo Stage</th>
                  <th className="p-2">Mojo Status</th>
                  <th className="p-2">Last Outcome</th>
                  <th className="p-2">Last Call</th>
                  <th className="p-2">CLR</th>
                  <th className="p-2">LO</th>
                  <th className="p-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">
                    No contacts yet. Import from Bonzo or Mojo, or they'll appear automatically via webhooks.
                  </td></tr>
                )}
                {rows.map(c => (
                  <tr key={c.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedId(c.id)}>
                    <td className="p-2 font-medium">{c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}</td>
                    <td className="p-2 font-mono text-xs">{formatPhone(c.phone)}</td>
                    <td className="p-2 text-xs">{c.email || "—"}</td>
                    <td className="p-2">{c.bonzo_stage ? <Badge variant="outline" className="text-xs">{c.bonzo_stage}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-2 text-xs">{c.mojo_status || "—"}</td>
                    <td className="p-2 text-xs">{c.last_outcome_type ? <span className="capitalize">{c.last_outcome_type.replace("_", " ")}</span> : "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{c.last_call_date || c.last_outcome_date || "—"}</td>
                    <td className="p-2 text-xs">{c.clr_user_name || "—"}</td>
                    <td className="p-2 text-xs">{c.lo_name || "—"}</td>
                    <td className="p-2"><SourceBadge source={c.source} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ContactDetailDialog id={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function ContactDetailDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data } = useQuery<ContactDetail>({
    queryKey: [`/api/contacts/${id}`],
    enabled: !!id,
  });
  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {data?.full_name || [data?.first_name, data?.last_name].filter(Boolean).join(" ") || "Contact"}
            {data && <SourceBadge source={data.source} />}
          </DialogTitle>
        </DialogHeader>
        {!data && <div className="text-muted-foreground text-sm">Loading…</div>}
        {data && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Contact Info</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Phone</div><div className="flex items-center gap-1"><Phone className="w-3 h-3" />{formatPhone(data.phone)}</div></div>
                <div><div className="text-xs text-muted-foreground">Email</div><div className="flex items-center gap-1"><Mail className="w-3 h-3" />{data.email || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Assigned CLR</div><div>{data.clr_user_name || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Assigned LO</div><div>{data.lo_name || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Total Transfers</div><div>{data.total_transfers}</div></div>
                <div><div className="text-xs text-muted-foreground">Total Appointments</div><div>{data.total_appointments}</div></div>
              </CardContent>
            </Card>

            {data.bonzoProspect && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Bonzo Pipeline</CardTitle></CardHeader>
                <CardContent className="text-sm grid grid-cols-2 gap-3">
                  <div><div className="text-xs text-muted-foreground">Pipeline</div><div>{data.bonzo_pipeline || "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Stage</div><Badge variant="outline">{data.bonzo_stage || "—"}</Badge></div>
                  <div><div className="text-xs text-muted-foreground">Assigned User (Bonzo)</div><div>{data.bonzo_assigned_user || "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Last Bonzo Activity</div><div>{(data.bonzoProspect as any).last_activity_at || "—"}</div></div>
                </CardContent>
              </Card>
            )}

            {(data.mojoContact || data.mojoSessions.length > 0) && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Mojo Activity</CardTitle></CardHeader>
                <CardContent className="text-sm">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div><div className="text-xs text-muted-foreground">Group</div><div>{data.mojo_group || "—"}</div></div>
                    <div><div className="text-xs text-muted-foreground">Status</div><div>{data.mojo_status || "—"}</div></div>
                  </div>
                  {data.mojoSessions.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold mb-1">Recent Sessions</div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {data.mojoSessions.slice(0, 10).map((s: any) => (
                          <div key={s.id} className="text-xs flex justify-between border-b py-1">
                            <span>{s.session_date}</span>
                            <span className="text-muted-foreground">{s.total_calls} calls, {s.transfers} transfers, {s.appointments} appts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {data.outcomes.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">C3 Outcome History</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {data.outcomes.map((o: any) => (
                      <div key={o.id} className="border-l-2 border-primary pl-3 py-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium capitalize">{o.outcome_type.replace("_", " ")}</span>
                          <span className="text-muted-foreground">{o.date}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">by {o.assistant_name} · LO: {o.lo_full_name}</div>
                        {o.notes && <div className="text-xs mt-1">{o.notes}</div>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format, parseISO } from "date-fns";
import { Shield } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type AuditLog = {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  entityLabel: string | null;
  details: string | null;
  createdAt: string;
};

// ── Badge config ──────────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { label: string; className: string }> = {
  create:   { label: "Create",   className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-0" },
  update:   { label: "Update",   className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0" },
  delete:   { label: "Delete",   className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0" },
  generate: { label: "Generate", className: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 border-0" },
  login:    { label: "Login",    className: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-0" },
};

const ENTITY_CONFIG: Record<string, { label: string; className: string }> = {
  loan_officer: { label: "Loan Officer", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-0" },
  assignment:   { label: "Assignment",   className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 border-0" },
  outcome:      { label: "Outcome",      className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 border-0" },
  user:         { label: "User",         className: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300 border-0" },
  settings:     { label: "Settings",     className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 border-0" },
  auth:         { label: "Auth",         className: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 border-0" },
};

const ENTITY_TYPE_OPTIONS = [
  { value: "all",          label: "All Types" },
  { value: "loan_officer", label: "Loan Officer" },
  { value: "assignment",   label: "Assignment" },
  { value: "outcome",      label: "Outcome" },
  { value: "user",         label: "User" },
  { value: "settings",     label: "Settings" },
  { value: "auth",         label: "Auth" },
];

const LIMIT_OPTIONS = [
  { value: "25",  label: "25" },
  { value: "50",  label: "50" },
  { value: "100", label: "100" },
  { value: "all", label: "All" },
];

// ── Detail summary ────────────────────────────────────────────────────────────
function detailsSummary(details: string | null): string | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details);
    if (parsed.count !== undefined && parsed.date) {
      return `${parsed.count} LOs for ${parsed.date}`;
    }
    if (parsed.outcomeType) {
      return parsed.outcomeType.replace(/_/g, " ");
    }
    if (parsed.status) {
      return `→ ${parsed.status}`;
    }
    const keys = Object.keys(parsed).slice(0, 2);
    return keys.map(k => `${k}: ${String(parsed[k]).substring(0, 20)}`).join(", ");
  } catch {
    return null;
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AuditLog() {
  const [entityType, setEntityType] = useState("all");
  const [limit, setLimit] = useState("100");

  const params = new URLSearchParams();
  if (entityType !== "all") params.set("entityType", entityType);
  params.set("limit", limit);

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: [`/api/audit-logs?${params.toString()}`],
    refetchInterval: 30000,
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Track all system actions and mutations
        </p>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Entity Type
              </label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger className="w-40 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Show
              </label>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger className="w-24 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMIT_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">entries</span>
            </div>

            {logs.length > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                {logs.length} record{logs.length !== 1 ? "s" : ""} · auto-refreshes every 30s
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              Loading audit log…
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Shield className="w-10 h-10 opacity-30" />
              <p className="text-sm">No audit events found</p>
              <p className="text-xs opacity-60">Actions on loan officers, assignments, and outcomes will appear here</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Time</TableHead>
                  <TableHead className="w-32">User</TableHead>
                  <TableHead className="w-28">Action</TableHead>
                  <TableHead className="w-36">Entity Type</TableHead>
                  <TableHead>What</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const actionCfg = ACTION_CONFIG[log.action] ?? { label: log.action, className: "border" };
                  const entityCfg = ENTITY_CONFIG[log.entityType] ?? { label: log.entityType, className: "border" };
                  const summary = detailsSummary(log.details);

                  let parsedDate: Date | null = null;
                  let relativeTime = "";
                  let fullDate = "";
                  try {
                    parsedDate = parseISO(log.createdAt);
                    relativeTime = formatDistanceToNow(parsedDate, { addSuffix: true });
                    fullDate = format(parsedDate, "MMM d, yyyy 'at' h:mm:ss a");
                  } catch {
                    relativeTime = log.createdAt;
                    fullDate = log.createdAt;
                  }

                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default underline decoration-dotted decoration-muted-foreground/40">
                              {relativeTime}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="text-xs">
                            {fullDate}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>

                      <TableCell className="text-sm">
                        {log.userName ?? (
                          <span className="text-muted-foreground italic">system</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge className={`text-xs font-medium ${actionCfg.className}`}>
                          {actionCfg.label}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className={`text-xs font-medium ${entityCfg.className}`}>
                          {entityCfg.label}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-sm">
                        <span className="font-medium">
                          {log.entityLabel ?? (log.entityId ? `#${log.entityId}` : "—")}
                        </span>
                        {summary && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            · {summary}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

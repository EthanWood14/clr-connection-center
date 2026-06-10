import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { copyToClipboard } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users, UserPlus, Pencil, Trash2, KeyRound, ShieldAlert, Mail, Copy, Archive } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";

const CURRENT_USER_ID = 1;

type UserRole = "admin" | "assistant" | "viewer";

interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  isClr: boolean;
  inDailyAssignments: boolean;
  createdAt: string;
}

const userFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "assistant", "viewer"]),
  newPassword: z.string().optional(),
});

type UserFormValues = z.infer<typeof userFormSchema>;

const roleBadgeStyles: Record<UserRole, string> = {
  admin: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700",
  assistant: "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700",
  viewer: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600",
};

function UserDialog({
  open,
  onOpenChange,
  editUser,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editUser: User | null;
}) {
  const { toast } = useToast();
  const isEditing = editUser !== null;
  const [sendWelcome, setSendWelcome] = useState(true);
  const [isClr, setIsClr] = useState(editUser?.isClr ?? true);
  // false = this CLR is skipped by daily assignment generation (still does EODs,
  // dashboards, reports, and can receive manually reassigned leads).
  const [inAssignments, setInAssignments] = useState(editUser?.inDailyAssignments ?? true);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    values: isEditing
      ? { name: editUser.name, email: editUser.email, role: editUser.role, newPassword: "" }
      : { name: "", email: "", role: "assistant", newPassword: "" },
  });

  // Sync isClr when editUser changes
  const watchedRole = form.watch("role");

  const createMutation = useMutation({
    mutationFn: (data: UserFormValues) => apiRequest("POST", "/api/users", { ...data, isClr, inDailyAssignments: inAssignments, sendWelcome }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      if (res?.emailRequested) {
        if (res.emailSent) {
          toast({ title: "User created. Welcome email sent." });
        } else {
          toast({
            title: "User created. Welcome email failed",
            description: res.emailError || "Unknown error",
            variant: "destructive",
          });
        }
      } else {
        toast({ title: "User created." });
      }
      onOpenChange(false);
      form.reset();
      setSendWelcome(true);
      setIsClr(true);
      setInAssignments(true);
    },
    onError: (err: Error) =>
      toast({ title: "Failed to add team member", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (data: UserFormValues) => {
      const payload: any = { name: data.name, email: data.email, role: data.role, isClr, inDailyAssignments: inAssignments };
      if (data.newPassword?.trim()) payload.newPassword = data.newPassword.trim();
      return apiRequest("PATCH", `/api/users/${editUser!.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Team member updated" });
      onOpenChange(false);
    },
    onError: (err: Error) =>
      toast({ title: "Failed to update", description: err.message, variant: "destructive" }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onSubmit(values: UserFormValues) {
    if (isEditing) updateMutation.mutate(values);
    else createMutation.mutate(values);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Team Member" : "Add Team Member"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Jane Smith" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="jane@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="assistant">Assistant</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isEditing && (
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5" /> Reset Password
                    </FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Leave blank to keep current password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {/* CLR toggle — only relevant for admin role */}
            {watchedRole === "admin" && (
              <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/40">
                <div>
                  <p className="text-sm font-medium">Also a CLR</p>
                  <p className="text-xs text-muted-foreground">Include this admin in daily assignment generation</p>
                </div>
                <Switch checked={isClr} onCheckedChange={setIsClr} />
              </div>
            )}
            {/* Daily assignment opt-out — any CLR (assistant, or admin marked as CLR) */}
            {(watchedRole === "assistant" || (watchedRole === "admin" && isClr)) && (
              <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/40">
                <div>
                  <p className="text-sm font-medium">Daily Assignments</p>
                  <p className="text-xs text-muted-foreground">
                    Include in daily assignment generation. When off, this CLR still submits EODs and appears in dashboards, reports, and leaderboards.
                  </p>
                </div>
                <Switch checked={inAssignments} onCheckedChange={setInAssignments} data-testid="switch-in-daily-assignments" />
              </div>
            )}
            {!isEditing && (
              <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/40">
                <div>
                  <p className="text-sm font-medium">Send Welcome Email</p>
                  <p className="text-xs text-muted-foreground">Email login details to this user on creation</p>
                </div>
                <Switch checked={sendWelcome} onCheckedChange={setSendWelcome} />
              </div>
            )}
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (isEditing ? "Saving…" : "Adding…") : isEditing ? "Save Changes" : "Add Member"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function TeamManagement() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const { toast } = useToast();
  const { user: authUser } = useAuth();

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/users/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to update status", description: err.message, variant: "destructive" }),
  });

  const toggleManagerMutation = useMutation({
    mutationFn: ({ id, is_manager }: { id: number; is_manager: boolean }) =>
      apiRequest("PATCH", `/api/users/${id}/manager`, { is_manager }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/report-schedules"] });
      toast({
        title: vars.is_manager ? "Manager enabled" : "Manager disabled",
        description: vars.is_manager
          ? "User added to daily/weekly/monthly report recipients."
          : "User removed from scheduled report recipients.",
      });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to update manager flag", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Account archived",
        description: `${deleteTarget?.name}'s account has been archived. Their reports, outcomes, and call history are preserved.`,
      });
      setDeleteTarget(null);
    },
    onError: (err: Error) =>
      toast({ title: "Archive failed", description: err.message, variant: "destructive" }),
  });

  function openAddDialog() {
    setEditUser(null);
    setDialogOpen(true);
  }

  function openEditDialog(user: User) {
    setEditUser(user);
    setDialogOpen(true);
  }

  function handleToggleActive(user: User) {
    if (user.id === CURRENT_USER_ID) return;
    toggleActiveMutation.mutate({ id: user.id, isActive: !user.isActive });
  }

  const isAdmin = authUser?.role === "admin";

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4" />
              Team Management
            </CardTitle>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)} data-testid="button-invite-user">
                  <Mail className="w-4 h-4 mr-2" />
                  Invite User
                </Button>
              )}
              <Button size="sm" onClick={openAddDialog} data-testid="button-add-team-member">
                <UserPlus className="w-4 h-4 mr-2" />
                Add Team Member
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading team…</div>
          ) : users.length === 0 ? (
            <div className="py-10 text-center space-y-1">
              <Users className="w-8 h-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No team members yet.</p>
              <p className="text-xs text-muted-foreground/70">Add your first team member to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  {isAdmin && <TableHead className="text-center">Manager</TableHead>}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary flex-shrink-0">
                          {user.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <span className="text-sm font-medium">
                          {user.name}
                          {user.id === CURRENT_USER_ID && (
                            <span className="ml-1.5 text-xs text-muted-foreground font-normal">(you)</span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`text-xs font-medium ${roleBadgeStyles[user.role]}`}
                          data-testid={`badge-role-${user.id}`}
                        >
                          {user.role === "admin" ? (user.isClr ? "Admin (CLR)" : "Admin") : user.role}
                        </Badge>
                        {(user.role === "assistant" || (user.role === "admin" && user.isClr)) &&
                          user.inDailyAssignments === false && (
                            <Badge
                              variant="outline"
                              className="text-xs font-medium bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"
                              data-testid={`badge-no-assignments-${user.id}`}
                            >
                              No daily assignments
                            </Badge>
                          )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={user.isActive}
                        onCheckedChange={() => handleToggleActive(user)}
                        disabled={
                          user.id === CURRENT_USER_ID ||
                          toggleActiveMutation.isPending
                        }
                        aria-label={`Toggle active for ${user.name}`}
                        data-testid={`switch-active-${user.id}`}
                      />
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-center">
                        <Switch
                          checked={!!(user as any).isManager}
                          onCheckedChange={(checked) =>
                            toggleManagerMutation.mutate({ id: user.id, is_manager: checked })
                          }
                          disabled={toggleManagerMutation.isPending}
                          aria-label={`Toggle manager for ${user.name}`}
                          data-testid={`switch-manager-${user.id}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => openEditDialog(user)}
                          data-testid={`button-edit-user-${user.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" />
                          Edit
                        </Button>
                        {isAdmin && user.id !== authUser?.id && user.id !== 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(user)}
                            data-testid={`button-delete-user-${user.id}`}
                          >
                            <Archive className="w-3.5 h-3.5 mr-1" />
                            Archive
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <UserDialog
        key={editUser?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditUser(null);
        }}
        editUser={editUser}
      />

      {/* Archive confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Archive className="w-5 h-5" /> Archive Account
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                <strong>{deleteTarget?.name}</strong>
                (<span className="font-mono text-xs">{deleteTarget?.email}</span>)
                will be deactivated and removed from the team list.
              </span>
              <span className="block text-muted-foreground">
                Their EOD reports, lead outcomes, call logs, and audit history are kept
                so historical reporting stays accurate. You can restore them later, and
                the email address can be reused for a new invite.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Archiving…" : "Archive account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} orgId={(authUser as any)?.orgId ?? 1} />
    </>
  );
}

function InviteUserDialog({ open, onOpenChange, orgId }: { open: boolean; onOpenChange: (v: boolean) => void; orgId: number }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("clr");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => apiRequest("POST", `/api/orgs/${orgId}/invite`, { email, role }),
    onSuccess: (data: any) => {
      setInviteLink(data.inviteLink);
      toast({ title: "Invite created", description: "Invite link ready. Email sent if Resend is configured." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function close() {
    setEmail(""); setRole("clr"); setInviteLink(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite User</DialogTitle></DialogHeader>
        {!inviteLink ? (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-invite-email" />
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger data-testid="select-invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="clr">CLR</SelectItem>
                  <SelectItem value="assistant">Assistant</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p>Invite created. Share this link with the user:</p>
            <div className="font-mono text-xs break-all rounded-md border bg-muted/40 p-3">{inviteLink}</div>
            <Button variant="outline" size="sm" onClick={() => {
              copyToClipboard(inviteLink);
              toast({ title: "Copied" });
            }}>
              <Copy className="w-4 h-4 mr-2" /> Copy Link
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>{inviteLink ? "Close" : "Cancel"}</Button>
          {!inviteLink && (
            <Button onClick={() => send.mutate()} disabled={!email || send.isPending} data-testid="button-send-invite">
              {send.isPending ? "Sending…" : "Send Invite"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

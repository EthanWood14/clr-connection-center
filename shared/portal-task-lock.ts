export type PortalTaskLock = {
  id: number; userId: number; taskId: number; createdAt: string;
  title: string; description: string; dueAt: string;
  userName: string; managerName: string; compAmountCents: number | null;
};

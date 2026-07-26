import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "c3-portal-communications-"));
process.env.DATABASE_PATH = join(tempDir, "portal-communications.db");

const communications = await import("../server/storage");
const sqlite = communications.getRawSqlite();
const notificationStore = communications.storage;

after(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function insertOrganization(label: string): number {
  const id = Number(
    (sqlite.prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM organizations`).get() as any).id,
  );
  sqlite.prepare(`
    INSERT INTO organizations (id, name, slug, company_name, plan)
    VALUES (?, ?, ?, ?, 'active')
  `).run(id, label, `portal-communications-${label.toLowerCase().replace(/\s+/g, "-")}-${id}`, label);
  return id;
}

function insertUser(name: string, orgId: number): number {
  return Number(sqlite.prepare(`
    INSERT INTO users (name, email, role, is_active, org_id, is_clr)
    VALUES (?, ?, 'assistant', 1, ?, 1)
  `).run(name, `${name.toLowerCase().replace(/\s+/g, ".")}-${orgId}@example.test`, orgId).lastInsertRowid);
}

function ids(rows: Array<{ id: number }>): number[] {
  return rows.map((row) => Number(row.id)).sort((a, b) => a - b);
}

test("portal communications isolate C3 and LAP within each organization", async (t) => {
  const orgA = insertOrganization("Communications Org A");
  const orgB = insertOrganization("Communications Org B");
  const userA = insertUser("Communications User A", orgA);
  const userB = insertUser("Communications User B", orgB);

  await t.test("chat reads and ID-based mutations require the matching portal and org", () => {
    const c3A = communications.postChatMessage(
      userA,
      "Communications User A",
      "org-a c3 chat",
      null,
      null,
      true,
      "c3",
      orgA,
    );
    const lapA = communications.postChatMessage(
      userA,
      "Communications User A",
      "org-a lap chat",
      Buffer.from("lap-image").toString("base64"),
      "image/png",
      false,
      "lap",
      orgA,
    );
    const c3B = communications.postChatMessage(
      userB,
      "Communications User B",
      "org-b c3 chat",
      null,
      null,
      false,
      "c3",
      orgB,
    );
    const lapB = communications.postChatMessage(
      userB,
      "Communications User B",
      "org-b lap chat",
      null,
      null,
      false,
      "lap",
      orgB,
    );

    assert.deepEqual(ids(communications.getChatMessages(100, undefined, "c3", orgA)), [c3A.id]);
    assert.deepEqual(ids(communications.getChatMessages(100, undefined, "lap", orgA)), [lapA.id]);
    assert.deepEqual(ids(communications.getChatMessages(100, undefined, "c3", orgB)), [c3B.id]);
    assert.deepEqual(ids(communications.getChatMessages(100, undefined, "lap", orgB)), [lapB.id]);

    assert.equal(communications.getChatMessageById(c3A.id, "lap", orgA), undefined);
    assert.equal(communications.getChatMessageById(c3A.id, "c3", orgB), undefined);
    assert.equal(communications.getChatImage(lapA.id, "c3", orgA), undefined);
    assert.equal(communications.getChatImage(lapA.id, "lap", orgB), undefined);
    assert.equal(
      Buffer.from(communications.getChatImage(lapA.id, "lap", orgA)!.image_data!, "base64").toString(),
      "lap-image",
    );

    assert.deepEqual(
      communications.toggleChatReaction(c3A.id, userA, "👍", "lap", orgA),
      { added: false, notFound: true },
    );
    assert.deepEqual(
      communications.toggleChatReaction(c3A.id, userA, "👍", "c3", orgB),
      { added: false, notFound: true },
    );
    assert.deepEqual(
      communications.toggleChatReaction(c3A.id, userA, "👍", "c3", orgA),
      { added: true },
    );

    const wrongClaim = communications.claimChatMessage(
      c3A.id,
      userA,
      "Communications User A",
      "lap",
      orgA,
    );
    assert.equal(wrongClaim.claimed, false);
    assert.equal(wrongClaim.row, undefined);
    assert.equal(
      communications.claimChatMessage(c3A.id, userA, "Communications User A", "c3", orgA).claimed,
      true,
    );
    assert.equal(
      communications.releaseChatMessage(c3A.id, userA, false, "lap", orgA).released,
      false,
    );
    assert.equal(
      communications.releaseChatMessage(c3A.id, userA, false, "c3", orgA).released,
      true,
    );

    communications.deleteChatMessage(c3A.id, "lap", orgA);
    communications.deleteChatMessage(c3A.id, "c3", orgB);
    assert.ok(communications.getChatMessageById(c3A.id, "c3", orgA));
  });

  await t.test("forum parents, children, votes, subscriptions, and acceptance stay scoped", () => {
    const c3A = communications.createForumPost({
      title: "Org A C3",
      body: "C3 forum post",
      authorId: userA,
      authorName: "Communications User A",
      orgId: orgA,
      portal: "c3",
    });
    const lapA = communications.createForumPost({
      title: "Org A LAP",
      body: "LAP forum post",
      authorId: userA,
      authorName: "Communications User A",
      orgId: orgA,
      portal: "lap",
    });
    const c3B = communications.createForumPost({
      title: "Org B C3",
      body: "C3 forum post",
      authorId: userB,
      authorName: "Communications User B",
      orgId: orgB,
      portal: "c3",
    });
    const lapB = communications.createForumPost({
      title: "Org B LAP",
      body: "LAP forum post",
      authorId: userB,
      authorName: "Communications User B",
      orgId: orgB,
      portal: "lap",
    });

    assert.deepEqual(ids(communications.listForumPosts(userA, undefined, "c3", orgA)), [c3A.id]);
    assert.deepEqual(ids(communications.listForumPosts(userA, undefined, "lap", orgA)), [lapA.id]);
    assert.deepEqual(ids(communications.listForumPosts(userB, undefined, "c3", orgB)), [c3B.id]);
    assert.deepEqual(ids(communications.listForumPosts(userB, undefined, "lap", orgB)), [lapB.id]);

    assert.equal(communications.getForumPostById(c3A.id, userA, "lap", orgA), null);
    assert.equal(communications.getForumPostById(c3A.id, userB, "c3", orgB), null);
    assert.equal(
      communications.createForumAnswer({
        postId: c3A.id,
        body: "Wrong portal answer",
        authorId: userA,
        authorName: "Communications User A",
        orgId: orgA,
        portal: "lap",
      }),
      null,
    );

    const lapAnswer = communications.createForumAnswer({
      postId: lapA.id,
      body: "Scoped LAP answer",
      authorId: userA,
      authorName: "Communications User A",
      orgId: orgA,
      portal: "lap",
    });
    assert.ok(lapAnswer);
    assert.equal(communications.getForumAnswerById(lapAnswer.id, "c3", orgA), undefined);
    assert.equal(communications.getForumAnswerById(lapAnswer.id, "lap", orgB), undefined);
    assert.equal(communications.getForumAnswerById(lapAnswer.id, "lap", orgA)?.body, "Scoped LAP answer");

    assert.equal(
      communications.updateForumPost(lapA.id, { title: "Cross-portal edit" }, "c3", orgA),
      undefined,
    );
    assert.equal(
      communications.updateForumAnswer(lapAnswer.id, { body: "Cross-org edit" }, "lap", orgB),
      undefined,
    );
    assert.deepEqual(
      communications.toggleForumVote("post", lapA.id, userA, "c3", orgA),
      { upvoted: false, notFound: true },
    );
    assert.deepEqual(
      communications.toggleForumVote("answer", lapAnswer.id, userA, "lap", orgB),
      { upvoted: false, notFound: true },
    );
    assert.deepEqual(
      communications.toggleForumSubscription(lapA.id, userA, "c3", orgA),
      { subscribed: false, notFound: true },
    );
    assert.deepEqual(communications.getForumSubscribers(lapA.id, "c3", orgA), []);
    assert.equal(communications.acceptForumAnswer(c3A.id, lapAnswer.id, "c3", orgA), false);
    assert.equal(communications.acceptForumAnswer(lapA.id, lapAnswer.id, "lap", orgA), true);

    communications.deleteForumPost(lapA.id, "c3", orgA);
    communications.deleteForumPost(lapA.id, "lap", orgB);
    assert.ok(communications.getForumPostById(lapA.id, userA, "lap", orgA));
  });

  await t.test("notification reads, unread counts, and mark-all operations are portal-filtered", () => {
    const c3 = notificationStore.createNotification({
      userId: userA,
      type: "chat",
      title: "C3 chat",
      message: "C3 only",
      isRead: false,
      portal: "c3",
    });
    const lap = notificationStore.createNotification({
      userId: userA,
      type: "chat",
      title: "LAP chat",
      message: "LAP only",
      isRead: false,
      portal: "lap",
    });
    const shared = notificationStore.createNotification({
      userId: userA,
      type: "schedule",
      title: "Shared schedule",
      message: "Visible in both portals",
      isRead: false,
      portal: null,
    });
    const otherOrg = notificationStore.createNotification({
      userId: userB,
      type: "forum",
      title: "Other org LAP forum",
      message: "Other user only",
      isRead: false,
      portal: "lap",
    });
    const createdIds = new Set([c3.id, lap.id, shared.id, otherOrg.id].map(Number));

    const c3Rows = notificationStore
      .getNotifications(userA, "c3")
      .filter((row) => createdIds.has(Number(row.id)));
    const lapRows = notificationStore
      .getNotifications(userA, "lap")
      .filter((row) => createdIds.has(Number(row.id)));
    assert.deepEqual(ids(c3Rows), ids([c3, shared]));
    assert.deepEqual(ids(lapRows), ids([lap, shared]));
    assert.equal(c3Rows.some((row) => row.id === otherOrg.id), false);
    assert.equal(lapRows.some((row) => row.id === otherOrg.id), false);
    assert.equal(notificationStore.getUnreadCount(userA, "c3"), 2);
    assert.equal(notificationStore.getUnreadCount(userA, "lap"), 2);

    notificationStore.markNotificationRead(lap.id, userA, "c3");
    assert.equal(
      Number((sqlite.prepare(`SELECT is_read FROM notifications WHERE id = ?`).get(lap.id) as any).is_read),
      0,
    );

    notificationStore.markAllNotificationsRead(userA, "c3");
    const readState = new Map<number, number>(
      (sqlite.prepare(`
        SELECT id, is_read FROM notifications WHERE id IN (?, ?, ?, ?)
      `).all(c3.id, lap.id, shared.id, otherOrg.id) as Array<{ id: number; is_read: number }>)
        .map((row) => [Number(row.id), Number(row.is_read)]),
    );
    assert.equal(readState.get(Number(c3.id)), 1);
    assert.equal(readState.get(Number(shared.id)), 1);
    assert.equal(readState.get(Number(lap.id)), 0);
    assert.equal(readState.get(Number(otherOrg.id)), 0);
    assert.equal(notificationStore.getUnreadCount(userA, "c3"), 0);
    assert.equal(notificationStore.getUnreadCount(userA, "lap"), 1);
  });
});

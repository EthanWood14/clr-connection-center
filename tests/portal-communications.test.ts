import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "c3-portal-communications-"));
process.env.DATABASE_PATH = join(tempDir, "portal-communications.db");

const communications = await import("../server/storage");
const { runWithOrg } = await import("../server/orgContext");
const push = await import("../server/push");
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
  const userA2 = insertUser("Communications User A2", orgA);
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
    const shared = runWithOrg(
      { orgId: orgA, superAdmin: false },
      () => notificationStore.createNotification({
        userId: null,
        type: "schedule",
        title: "Shared schedule",
        message: "Visible to this organization in both portals",
        isRead: false,
        portal: null,
      }),
    );
    const legacyReadBroadcast = runWithOrg(
      { orgId: orgA, superAdmin: false },
      () => notificationStore.createNotification({
        userId: null,
        type: "announcement",
        title: "Previously read C3 announcement",
        message: "Legacy broadcast read state must remain read after receipt migration",
        isRead: true,
        portal: "c3",
      }),
    );
    const otherOrg = notificationStore.createNotification({
      userId: userB,
      type: "forum",
      title: "Other org LAP forum",
      message: "Other user only",
      isRead: false,
      portal: "lap",
    });
    const createdIds = new Set(
      [c3.id, lap.id, shared.id, legacyReadBroadcast.id, otherOrg.id].map(Number),
    );

    const c3Rows = notificationStore
      .getNotifications(userA, "c3")
      .filter((row) => createdIds.has(Number(row.id)));
    const lapRows = notificationStore
      .getNotifications(userA, "lap")
      .filter((row) => createdIds.has(Number(row.id)));
    assert.deepEqual(ids(c3Rows), ids([c3, shared, legacyReadBroadcast]));
    assert.deepEqual(ids(lapRows), ids([lap, shared]));
    assert.equal(c3Rows.some((row) => row.id === otherOrg.id), false);
    assert.equal(lapRows.some((row) => row.id === otherOrg.id), false);
    assert.equal(notificationStore.getUnreadCount(userA, "c3"), 2);
    assert.equal(notificationStore.getUnreadCount(userA, "lap"), 2);
    assert.equal(notificationStore.getUnreadCount(userA2, "c3"), 1);
    assert.equal(notificationStore.getUnreadCount(userA2, "lap"), 1);
    assert.equal(
      notificationStore.getNotifications(userA2, "c3")
        .find((row) => Number(row.id) === Number(legacyReadBroadcast.id))?.isRead,
      true,
      "legacy globally-read broadcasts stay read after per-user receipts are introduced",
    );
    assert.throws(
      () => runWithOrg(
        { orgId: orgA, superAdmin: false },
        () => notificationStore.createNotification({
          userId: userB,
          type: "announcement",
          title: "Cross-organization notification",
          message: "Must be rejected",
          isRead: false,
          portal: "lap",
        }),
      ),
      /outside the active organization/,
    );

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
    assert.equal(
      readState.get(Number(shared.id)),
      0,
      "broadcast rows remain unread globally and use per-user receipts",
    );
    assert.equal(readState.get(Number(lap.id)), 0);
    assert.equal(readState.get(Number(otherOrg.id)), 0);
    assert.equal(
      Number(
        (sqlite.prepare(`
          SELECT COUNT(*) AS count
          FROM notification_reads
          WHERE notification_id = ? AND user_id = ?
        `).get(shared.id, userA) as any).count,
      ),
      1,
    );
    assert.equal(notificationStore.getUnreadCount(userA, "c3"), 0);
    assert.equal(notificationStore.getUnreadCount(userA, "lap"), 1);
    assert.equal(notificationStore.getUnreadCount(userA2, "c3"), 1);
    assert.equal(notificationStore.getUnreadCount(userA2, "lap"), 1);
    assert.equal(
      notificationStore.getNotifications(userA2, "c3")
        .find((row) => Number(row.id) === Number(shared.id))?.isRead,
      false,
    );
  });

  await t.test("LOA records and browser push endpoints cannot cross organization boundaries", () => {
    const loA = Number(sqlite.prepare(`
      INSERT INTO loan_officers
        (full_name, nmls_id, licensed_states, internal_status, org_id)
      VALUES (?, ?, '[]', 'active', ?)
    `).run("Communications LO A", `COMM-A-${orgA}`, orgA).lastInsertRowid);
    const loB = Number(sqlite.prepare(`
      INSERT INTO loan_officers
        (full_name, nmls_id, licensed_states, internal_status, org_id)
      VALUES (?, ?, '[]', 'active', ?)
    `).run("Communications LO B", `COMM-B-${orgB}`, orgB).lastInsertRowid);

    const loaA = runWithOrg(
      { orgId: orgA, superAdmin: false },
      () => communications.createLoanOfficerAssistant({
        loId: loA,
        fullName: "Organization A Assistant",
      }),
    );
    const loaB = runWithOrg(
      { orgId: orgB, superAdmin: false },
      () => communications.createLoanOfficerAssistant({
        loId: loB,
        fullName: "Organization B Assistant",
      }),
    );

    assert.equal(
      runWithOrg(
        { orgId: orgB, superAdmin: false },
        () => communications.getLoanOfficerAssistant(loaA.id),
      ),
      undefined,
    );
    assert.equal(
      runWithOrg(
        { orgId: orgA, superAdmin: false },
        () => communications.getLoanOfficerAssistant(loaB.id),
      ),
      undefined,
    );
    assert.throws(
      () => runWithOrg(
        { orgId: orgA, superAdmin: false },
        () => communications.createLoanOfficerAssistant({
          loId: loB,
          fullName: "Cross-organization Assistant",
        }),
      ),
      /not found in your organization/,
    );
    assert.equal(
      runWithOrg(
        { orgId: orgB, superAdmin: false },
        () => communications.deleteLoanOfficerAssistant(loaA.id),
      ),
      false,
    );
    assert.ok(
      runWithOrg(
        { orgId: orgA, superAdmin: false },
        () => communications.getLoanOfficerAssistant(loaA.id),
      ),
    );

    const endpoint = "https://push.example.test/shared-browser-endpoint";
    const keys = { p256dh: "test-p256dh", auth: "test-auth" };
    push.saveSubscription(userA, orgA, { endpoint, keys });
    push.saveSubscription(userB, orgB, { endpoint, keys });
    const owners = sqlite.prepare(`
      SELECT user_id, org_id
      FROM push_subscriptions
      WHERE endpoint = ?
    `).all(endpoint) as Array<{ user_id: number; org_id: number }>;
    assert.deepEqual(owners, [{ user_id: userB, org_id: orgB }]);
  });
});

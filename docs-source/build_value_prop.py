"""Build the 'Why CLR Connection Center?' PDF for West Capital Lending."""
import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Image, Table, TableStyle, KeepTogether, FrameBreak
)
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics

NAVY = HexColor("#0F182D")
GOLD = HexColor("#C9A24A")
GOLD_LIGHT = HexColor("#F5ECD2")
GRAY = HexColor("#6B7280")
LIGHT_GRAY = HexColor("#E5E7EB")
BLACK = HexColor("#111111")

PAGE_W, PAGE_H = LETTER
MARGIN = 1 * inch

LOGO_PATH = "/home/user/workspace/clr-connection-center/docs-source/logo-badge.png"
OUT_PATH_1 = "/home/user/workspace/clr-connection-center/client/public/docs/value-prop.pdf"
OUT_PATH_2 = "/home/user/workspace/clr-connection-center/dist/public/docs/value-prop.pdf"

# -------------------- Styles --------------------

BASE_FONT = "Helvetica"
BOLD_FONT = "Helvetica-Bold"
OBL_FONT  = "Helvetica-Oblique"

styles = {
    "H1": ParagraphStyle(
        "H1", fontName=BOLD_FONT, fontSize=22, leading=28,
        textColor=NAVY, spaceBefore=0, spaceAfter=10,
    ),
    "H2": ParagraphStyle(
        "H2", fontName=BOLD_FONT, fontSize=15, leading=20,
        textColor=NAVY, spaceBefore=14, spaceAfter=6, keepWithNext=1,
    ),
    "H3": ParagraphStyle(
        "H3", fontName=BOLD_FONT, fontSize=11.5, leading=15,
        textColor=NAVY, spaceBefore=8, spaceAfter=3, keepWithNext=1,
    ),
    "body": ParagraphStyle(
        "body", fontName=BASE_FONT, fontSize=10.5, leading=15,
        textColor=BLACK, alignment=TA_LEFT, spaceAfter=6,
    ),
    "bodyJ": ParagraphStyle(
        "bodyJ", fontName=BASE_FONT, fontSize=10.5, leading=15,
        textColor=BLACK, alignment=TA_JUSTIFY, spaceAfter=6,
    ),
    "bullet": ParagraphStyle(
        "bullet", fontName=BASE_FONT, fontSize=10.5, leading=15,
        textColor=BLACK, alignment=TA_LEFT, leftIndent=16,
        bulletIndent=4, spaceAfter=3,
    ),
    "callHead": ParagraphStyle(
        "callHead", fontName=BOLD_FONT, fontSize=10.5, leading=14,
        textColor=NAVY, spaceAfter=3,
    ),
    "callBody": ParagraphStyle(
        "callBody", fontName=BASE_FONT, fontSize=10, leading=14,
        textColor=BLACK,
    ),
    "small": ParagraphStyle(
        "small", fontName=BASE_FONT, fontSize=9, leading=12, textColor=GRAY,
    ),
    "coverTitle": ParagraphStyle(
        "coverTitle", fontName=BOLD_FONT, fontSize=34, leading=40,
        textColor=white, alignment=TA_LEFT,
    ),
    "coverSub": ParagraphStyle(
        "coverSub", fontName=BASE_FONT, fontSize=16, leading=22,
        textColor=GOLD, alignment=TA_LEFT,
    ),
    "coverDate": ParagraphStyle(
        "coverDate", fontName=BASE_FONT, fontSize=12, leading=16,
        textColor=white, alignment=TA_LEFT,
    ),
    "coverSmall": ParagraphStyle(
        "coverSmall", fontName=BASE_FONT, fontSize=9, leading=12,
        textColor=HexColor("#BFC4D1"), alignment=TA_LEFT,
    ),
}

# -------------------- Custom flowables --------------------

from reportlab.platypus import Flowable

class GoldRule(Flowable):
    def __init__(self, width, height=1.5, color=GOLD):
        super().__init__()
        self.width = width
        self.height = height
        self.color = color
    def wrap(self, *_):
        return (self.width, self.height)
    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, 0, self.width, self.height, stroke=0, fill=1)


def callout(title, body_html):
    """Gold-tinted key takeaway box."""
    inner = [
        Paragraph(f"<b>{title}</b>", styles["callHead"]),
        Paragraph(body_html, styles["callBody"]),
    ]
    tbl = Table([[inner]], colWidths=[6.5 * inch])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GOLD_LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.75, GOLD),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return tbl


def bullets(items):
    return [Paragraph(f"• {t}", styles["bullet"]) for t in items]


# -------------------- Page decorations --------------------

def cover_page(canv, doc):
    canv.saveState()
    # Full navy background
    canv.setFillColor(NAVY)
    canv.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    # Gold accent vertical bar on left
    canv.setFillColor(GOLD)
    canv.rect(0, 0, 0.35 * inch, PAGE_H, stroke=0, fill=1)
    # Gold horizontal accent under title
    canv.rect(1.1 * inch, PAGE_H - 4.2 * inch, 2.0 * inch, 4, stroke=0, fill=1)

    # Actual W-mark logo, flattened on a white badge so the navy W reads clearly over the navy cover
    logo_w = 2.4 * inch
    logo_h = logo_w * (98 / 290)
    try:
        canv.drawImage(LOGO_PATH, 1.1 * inch, PAGE_H - 1.0 * inch - logo_h,
                       width=logo_w, height=logo_h,
                       mask="auto", preserveAspectRatio=True)
    except Exception:
        pass
    # Thin gold underline beneath logo
    canv.setFillColor(GOLD)
    canv.rect(1.1 * inch, PAGE_H - 1.25 * inch - logo_h, 0.9 * inch, 1.2, stroke=0, fill=1)

    # Title
    canv.setFillColor(white)
    canv.setFont(BOLD_FONT, 36)
    canv.drawString(1.1 * inch, PAGE_H - 3.6 * inch, "Why CLR")
    canv.drawString(1.1 * inch, PAGE_H - 4.1 * inch, "Connection Center?")

    # Subtitle in gold
    canv.setFillColor(GOLD)
    canv.setFont(BASE_FONT, 16)
    canv.drawString(1.1 * inch, PAGE_H - 4.75 * inch,
                    "The Business Case for West Capital Lending")

    # Date
    canv.setFillColor(white)
    canv.setFont(BASE_FONT, 12)
    canv.drawString(1.1 * inch, PAGE_H - 5.2 * inch, "April 2026")

    # Footer block on cover
    canv.setFillColor(GOLD)
    canv.rect(1.1 * inch, 1.1 * inch, 1.3 * inch, 2, stroke=0, fill=1)
    canv.setFillColor(white)
    canv.setFont(BOLD_FONT, 11)
    canv.drawString(1.1 * inch, 0.85 * inch, "West Capital Lending")
    canv.setFillColor(HexColor("#BFC4D1"))
    canv.setFont(BASE_FONT, 9)
    canv.drawString(1.1 * inch, 0.65 * inch, "Internal Document  ·  Prepared for Executives, Managers, and Team")
    canv.drawString(1.1 * inch, 0.50 * inch, "Irvine, California  ·  www.wlc.it.com")

    canv.restoreState()


def body_page(canv, doc):
    canv.saveState()
    # Header: thin gold rule + tiny section mark
    canv.setFillColor(GOLD)
    canv.rect(MARGIN, PAGE_H - 0.55 * inch, 1.1 * inch, 2, stroke=0, fill=1)
    canv.setFillColor(NAVY)
    canv.setFont(BOLD_FONT, 8.5)
    canv.drawString(MARGIN, PAGE_H - 0.75 * inch, "WHY CLR CONNECTION CENTER?")
    canv.setFillColor(GRAY)
    canv.setFont(BASE_FONT, 8.5)
    canv.drawRightString(PAGE_W - MARGIN, PAGE_H - 0.75 * inch, "West Capital Lending")

    # Footer
    canv.setFillColor(GRAY)
    canv.setFont(BASE_FONT, 8.5)
    canv.drawString(MARGIN, 0.55 * inch,
                    "CLR Connection Center — West Capital Lending")
    canv.setFillColor(NAVY)
    canv.setFont(BOLD_FONT, 9)
    canv.drawCentredString(PAGE_W / 2, 0.55 * inch, f"{doc.page - 1}")
    canv.setFillColor(GRAY)
    canv.setFont(BASE_FONT, 8.5)
    canv.drawRightString(PAGE_W - MARGIN, 0.55 * inch, "April 2026")

    # Footer rule
    canv.setStrokeColor(LIGHT_GRAY)
    canv.setLineWidth(0.4)
    canv.line(MARGIN, 0.75 * inch, PAGE_W - MARGIN, 0.75 * inch)

    canv.restoreState()


# -------------------- Document build --------------------

def build():
    doc = BaseDocTemplate(
        OUT_PATH_1, pagesize=LETTER,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
        title="Why CLR Connection Center?",
        author="Ethan Wood — West Capital Lending",
        subject="Internal business case for the CLR Connection Center platform",
    )

    cover_frame = Frame(0, 0, PAGE_W, PAGE_H, id="cover",
                        leftPadding=0, rightPadding=0,
                        topPadding=0, bottomPadding=0,
                        showBoundary=0)
    body_frame = Frame(MARGIN, MARGIN,
                       PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN - 0.1 * inch,
                       id="body", leftPadding=0, rightPadding=0,
                       topPadding=0.2 * inch, bottomPadding=0.2 * inch,
                       showBoundary=0)

    doc.addPageTemplates([
        PageTemplate(id="Cover", frames=[cover_frame], onPage=cover_page),
        PageTemplate(id="Body",  frames=[body_frame],  onPage=body_page),
    ])

    story = []

    # Cover page is drawn by onPage; we just need a page break to move to body.
    story.append(Spacer(1, 0.1 * inch))  # tiny filler, cover is all canvas-drawn
    story.append(PageBreak())
    # Switch template
    from reportlab.platypus.doctemplate import NextPageTemplate
    # Need NextPageTemplate before first page break
    story = [NextPageTemplate("Body"), Spacer(1, 1), PageBreak()]

    # ---- Section 1: Executive Summary ----
    story.append(Paragraph("Executive Summary", styles["H1"]))
    story.append(GoldRule(1.4 * inch))
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "CLR Connection Center is the internal operations platform built for "
        "West Capital Lending's Client Loan Representative team. It replaces a "
        "patchwork of spreadsheets, chat threads, and screenshots with a single "
        "application that runs the CLR workflow end-to-end — from the outbound "
        "call, through disposition and follow-up, to the signed end-of-day "
        "report that closes the book on the day.", styles["bodyJ"]))
    story.append(Paragraph(
        "The platform is live at <b>www.wlc.it.com</b>, installable as a PWA on "
        "iPhone, Android, and desktop, and is already the daily home screen for "
        "the team. It ingests Mojo dialer activity via webhook, pulls Bonzo "
        "prospects through the CRM's webhook, and serves 184 internal API "
        "endpoints behind role-based access control.", styles["bodyJ"]))

    story.append(Paragraph("The three wins", styles["H2"]))
    story.append(Paragraph(
        "<b>1. Visibility.</b> Managers and admins see the whole team in real "
        "time — calls made, transfers, appointments, EOD submission status, "
        "and LO coverage — without asking anyone to paste numbers into a chat.",
        styles["body"]))
    story.append(Paragraph(
        "<b>2. Consistency.</b> Every outcome is captured against a fixed "
        "taxonomy. Every EOD report looks the same, prints the same, and can "
        "be reviewed the same. There is one source of truth, not six.",
        styles["body"]))
    story.append(Paragraph(
        "<b>3. Integration-ready.</b> The webhook ingestion layer for Mojo and "
        "Bonzo is already in production. Adding Encompass, Salesforce, Slack, "
        "or Google Calendar is a configuration exercise, not a rebuild.",
        styles["body"]))

    story.append(Spacer(1, 6))
    story.append(callout(
        "Key Takeaway",
        "CLR Connection Center turns the CLR role from a collection of "
        "personal systems into a repeatable, measurable, auditable workflow — "
        "without asking the team to change how they sell."))

    story.append(PageBreak())

    # ---- Section 2: The Problem Before ----
    story.append(Paragraph("The Problem Before", styles["H1"]))
    story.append(GoldRule(1.4 * inch))
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "Before CLR Connection Center, the CLR team operated on three "
        "disconnected surfaces. The dialer lived in Mojo. The CRM lived in "
        "Bonzo. The daily narrative — who called whom, what happened, which "
        "LOs were covered — lived in whatever tool a given CLR happened to "
        "favor that week. Nothing connected.", styles["bodyJ"]))

    story.append(Paragraph("Scattered manual tracking", styles["H3"]))
    story.append(Paragraph(
        "Call outcomes were logged in spreadsheets, sticky notes, and private "
        "message threads. Two CLRs working the same account could easily "
        "record the same conversation in three different places, or — worse "
        "— in no place at all. There was no enforced disposition vocabulary, "
        "so \"callback\" meant whatever the person typing it meant.",
        styles["bodyJ"]))

    story.append(Paragraph("Missed follow-ups", styles["H3"]))
    story.append(Paragraph(
        "Appointments and callbacks depended on someone remembering to set a "
        "reminder. When a CLR was out, their follow-ups went dark. When a "
        "borrower was promised a call-back next Tuesday, the promise lived "
        "in a notebook, not in a system that could surface it on Tuesday "
        "morning.", styles["bodyJ"]))

    story.append(Paragraph("No single source of truth", styles["H3"]))
    story.append(Paragraph(
        "Mojo knew call volume. Bonzo knew prospect status. Neither knew the "
        "full CLR picture, because the CLR workflow — the specific act of "
        "transferring a qualified borrower to a specific LO, capturing it as "
        "a direct transfer versus an appointment transfer, and noting which "
        "assigned LOs were actually worked — was not a first-class concept "
        "in either tool.", styles["bodyJ"]))

    story.append(Paragraph("Inconsistent end-of-day reporting", styles["H3"]))
    story.append(Paragraph(
        "EOD reports were submitted in whatever format the CLR chose that "
        "day: a Slack message, an email, a text, a screenshot. Rolling them "
        "up required a human to read every message and transcribe numbers. "
        "Week-over-week comparison was nearly impossible.",
        styles["bodyJ"]))

    story.append(Paragraph("LO coverage blind spots", styles["H3"]))
    story.append(Paragraph(
        "When an LO went on vacation, the message sometimes reached the CLR "
        "team and sometimes did not. Transfers got routed to an unavailable "
        "LO. Assignments were duplicated across CLRs. There was no system "
        "that held \"who is working today\" as authoritative data.",
        styles["bodyJ"]))

    story.append(Spacer(1, 4))
    story.append(callout(
        "Key Takeaway",
        "The pre-CCC workflow was not broken because the team was careless. "
        "It was broken because the team was asked to hold a multi-system "
        "process together with memory and goodwill. That only scales so far."))

    story.append(PageBreak())

    # ---- Section 3: What The Platform Does Today (pages 4-6) ----
    story.append(Paragraph("What the Platform Does Today", styles["H1"]))
    story.append(GoldRule(1.8 * inch))
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "CLR Connection Center is organized around the actual daily rhythm "
        "of a CLR: open the app, see the assignment, run the script, log the "
        "outcome, handle follow-ups, close the day with an EOD report. "
        "Everything else — stats, chat, integrations, admin tooling — is "
        "built around that spine.", styles["bodyJ"]))

    story.append(Paragraph("Outbound calling workflow", styles["H2"]))
    story.append(Paragraph(
        "The <b>Script</b> page is the dialer companion. It opens next to "
        "Mojo and walks the CLR through the approved call flow, with the "
        "borrower's context visible at a glance from the <b>Directory</b> "
        "and <b>Assignments</b> pages. The <b>Dashboard</b> shows daily "
        "targets, KPIs, and a live activity-trend chart with a 1D / 1W / 1M "
        "/ All Time toggle — so the CLR can see their own pace without "
        "leaving the app.", styles["bodyJ"]))

    story.append(Paragraph("Outcome capture", styles["H2"]))
    story.append(Paragraph(
        "Every call resolves into one of six outcomes: <b>transfer</b>, "
        "<b>appointment</b>, <b>fell through</b>, <b>callback requested</b>, "
        "<b>future contact</b>, or <b>no answer</b>. Transfers split into "
        "<i>direct transfer</i> and <i>appointment transfer</i>. Each "
        "outcome captures the borrower name, the assigned LO, a follow-up "
        "date, and free-text notes. This fixed taxonomy is what makes every "
        "downstream report possible.", styles["bodyJ"]))

    story.append(Paragraph("Appointments and the 3-day badge", styles["H2"]))
    story.append(Paragraph(
        "The <b>Appointments</b> page surfaces overdue, today, and upcoming "
        "follow-ups in separate lists. The sidebar badge counts only active "
        "appointment-type outcomes — appointment, callback requested, "
        "deferral, future contact — with a follow-up date in the next three "
        "days, and it excludes anything already converted to a transfer or "
        "already overdue. The number on the badge is the number the CLR "
        "actually has to act on.", styles["bodyJ"]))

    story.append(PageBreak())

    story.append(Paragraph("EOD reporting with PDF export", styles["H2"]))
    story.append(Paragraph(
        "The <b>EOD Report</b> is one submission per CLR per day, editable "
        "until submitted and read-only after. It captures calls made, "
        "transfers, appointments, notes, which assigned LOs were actually "
        "called, any additional LOs worked, and other notes. Past submitted "
        "reports export to a dedicated print-ready PDF — not a screenshot "
        "— with CLR identity, submission timestamp, outcome breakdown, "
        "transfer prospects, LO coverage rollup, activity log, and CLR plus "
        "Manager signature lines.", styles["bodyJ"]))

    story.append(Paragraph("LO stats and LO Vacation", styles["H2"]))
    story.append(Paragraph(
        "The <b>LO Stats</b> page shows per-loan-officer performance — how "
        "many transfers each LO is receiving, from whom, and at what "
        "conversion rate. <b>LO Vacation</b> lets admins mark LOs "
        "unavailable, and the daily assignment engine automatically skips "
        "them. Coverage is explicit, not assumed.", styles["bodyJ"]))

    story.append(Paragraph("NMLS license tracking", styles["H2"]))
    story.append(Paragraph(
        "A dedicated <b>NMLS</b> queue flags pending license checks with a "
        "sidebar badge, and a separate <b>NMLS License</b> reference page "
        "gives the team license-status context at a glance. Regulatory "
        "hygiene stops depending on anyone's memory.",
        styles["bodyJ"]))

    story.append(Paragraph("Team chat and forum", styles["H2"]))
    story.append(Paragraph(
        "Real-time <b>Chat</b> with an unread badge handles the quick "
        "\"who's covering this?\" conversation. The <b>Forum</b> handles "
        "long-form discussion — playbooks, post-mortems, FAQs — that would "
        "otherwise scroll away in a chat channel.", styles["bodyJ"]))

    story.append(PageBreak())

    story.append(Paragraph("Daily assignment generation", styles["H2"]))
    story.append(Paragraph(
        "From <b>Settings</b>, an admin generates one assignment per CLR per "
        "day. Once generated, the day is locked. An admin can unlock with a "
        "reason, and the unlock is written to the audit log. No CLR wakes "
        "up to a changed queue without a paper trail.", styles["bodyJ"]))

    story.append(Paragraph("Mojo webhook ingestion", styles["H2"]))
    story.append(Paragraph(
        "Mojo dialer sessions — call volume, contacts, DNC hits, transfers, "
        "appointments — flow into the platform through a configured "
        "webhook. A CSV import tool handles historical backfill, and a "
        "public-API sync stub is in place so the moment Mojo ships a public "
        "API, the switch-over is a configuration change. The <b>Mojo "
        "Sessions</b> page rolls up daily dialer activity per CLR.",
        styles["bodyJ"]))

    story.append(Paragraph("Bonzo sync", styles["H2"]))
    story.append(Paragraph(
        "Bonzo prospects sync in via webhook and appear in the <b>Bonzo "
        "Prospects</b> page. The <b>Contact Hub</b> unifies contacts across "
        "Mojo, Bonzo, and direct imports into one directory, so a CLR "
        "searching for a borrower does not need to guess which system they "
        "last lived in.", styles["bodyJ"]))

    story.append(Paragraph("Admin, audit, and super-admin", styles["H2"]))
    story.append(Paragraph(
        "Admins have their own reporting center, personal admin report, and "
        "settings for team goals, daily assignments, and integrations. Every "
        "sensitive action — assignment unlocks, user role changes, LO "
        "archive — writes to the <b>Audit Log</b>. Super admins can manage "
        "multiple organizations from one login, which keeps the platform "
        "ready for growth.", styles["bodyJ"]))

    story.append(Spacer(1, 4))
    story.append(callout(
        "Key Takeaway",
        "The platform already covers the full CLR day — not a slice of it. "
        "Every feature on this page is shipped, in production, and in use."))

    story.append(PageBreak())

    # ---- Section 4: Measurable Impact ----
    story.append(Paragraph("Measurable Impact", styles["H1"]))
    story.append(GoldRule(1.4 * inch))
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "The value of CLR Connection Center is best understood as the "
        "things that can no longer go wrong. Each of the points below "
        "describes a specific failure mode that used to be routine and is "
        "now structurally prevented by the platform.", styles["bodyJ"]))

    story.append(Paragraph("Every call disposition is captured", styles["H3"]))
    story.append(Paragraph(
        "A call cannot be worked through the platform without a disposition. "
        "The six-outcome taxonomy is enforced in the UI, which means the "
        "team no longer has to reconcile three different names for the same "
        "event at the end of the week.", styles["bodyJ"]))

    story.append(Paragraph("No duplicate data entry", styles["H3"]))
    story.append(Paragraph(
        "Mojo activity and Bonzo prospects flow in automatically. A CLR "
        "does not retype what the dialer already knows, and an admin does "
        "not copy-paste prospect lists between tools.", styles["bodyJ"]))

    story.append(Paragraph("Real-time team visibility", styles["H3"]))
    story.append(Paragraph(
        "Managers see the <b>Stats</b> leaderboard, <b>LO Stats</b>, and "
        "individual activity trends as they happen. There is no lag "
        "between \"what the team is doing\" and \"what the manager knows.\"",
        styles["bodyJ"]))

    story.append(Paragraph("Consistent EOD closeouts", styles["H3"]))
    story.append(Paragraph(
        "Every EOD report follows the same structure, prints to the same "
        "PDF layout, and includes CLR and Manager signature lines. Week-"
        "over-week review is now a matter of reading the same document "
        "multiple times — not a matter of interpretation.", styles["bodyJ"]))

    story.append(Paragraph("Full audit trail for admin actions", styles["H3"]))
    story.append(Paragraph(
        "Assignment unlocks, role changes, and LO archives are all logged. "
        "Anyone asking \"who changed this and why?\" has an answer in "
        "seconds.", styles["bodyJ"]))

    story.append(Spacer(1, 4))
    story.append(callout(
        "Key Takeaway",
        "The platform's impact is measured less in new numbers and more in "
        "the disappearance of old problems: missed follow-ups, duplicate "
        "entries, inconsistent reports, and untraceable changes."))

    story.append(PageBreak())

    # ---- Section 5: Future Integrations ----
    story.append(Paragraph("The Future: Integrations", styles["H1"]))
    story.append(GoldRule(1.8 * inch))
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "The single most important architectural choice in CLR Connection "
        "Center is that integrations are not bolt-ons. The webhook "
        "ingestion layer, the per-integration secret storage, and the "
        "unified Contact Hub were built from day one. Adding a new source "
        "or destination is an extension of an existing pattern.",
        styles["bodyJ"]))

    story.append(Paragraph("Mojo public API", styles["H3"]))
    story.append(Paragraph(
        "The Mojo integration is live today via webhook and CSV import, "
        "with a public-API sync stub already in place. When Mojo ships its "
        "public API, the platform is ready to pull richer data on a pull "
        "basis without waiting on a webhook event.", styles["bodyJ"]))

    story.append(Paragraph("Deeper Bonzo sync", styles["H3"]))
    story.append(Paragraph(
        "Bonzo syncs in today. A bidirectional extension — pushing CLR "
        "outcomes and transfer activity back into Bonzo as prospect notes "
        "or status updates — is the natural next step, and slots into the "
        "existing integration surface.", styles["bodyJ"]))

    story.append(Paragraph("Encompass", styles["H3"]))
    story.append(Paragraph(
        "Connecting to Encompass would give the CLR team visibility into "
        "loan-file status without logging into a second system. Transfers "
        "could be enriched with downstream pipeline context.",
        styles["bodyJ"]))

    story.append(Paragraph("Salesforce", styles["H3"]))
    story.append(Paragraph(
        "For any partner or affiliate flow that runs through Salesforce, "
        "the same webhook-plus-secret pattern already used for Mojo and "
        "Bonzo extends cleanly.", styles["bodyJ"]))

    story.append(Paragraph("Slack and Google Calendar", styles["H3"]))
    story.append(Paragraph(
        "Slack notifications for EOD submission, appointment reminders, "
        "and audit events; Google Calendar events for scheduled follow-ups "
        "and LO appointments — both are webhook-natural targets and can be "
        "rolled out incrementally per team request.", styles["bodyJ"]))

    story.append(Spacer(1, 4))
    story.append(callout(
        "Key Takeaway",
        "The integration roadmap is not speculative. The plumbing is "
        "already shipped; the next integrations are configuration work, "
        "not a new product."))

    story.append(PageBreak())

    # ---- Section 6: Technical Foundation ----
    story.append(Paragraph("Technical Foundation", styles["H1"]))
    story.append(GoldRule(1.5 * inch))
    story.append(Spacer(1, 10))

    tech_rows = [
        ["Frontend", "React 19 + Vite 7, TypeScript, Tailwind CSS, shadcn/ui, Wouter"],
        ["Backend",  "Node.js + Express, TypeScript, 184 API endpoints under /api/*"],
        ["Database", "SQLite with prepared statements (better-sqlite3), /data/app.db on Railway volume"],
        ["Auth",     "Session-based with secure cookies, role-based route guards, invite links"],
        ["Hosting",  "Railway (Dockerfile builder), US East, bound to www.wlc.it.com"],
        ["CI/CD",    "Push to main on GitHub → Railway auto-deploy via GitHub App"],
        ["PWA",      "Installable on iPhone, Android, and desktop; service worker wclcc-v2"],
        ["Health",   "GET /api/health returns { status, uptime, db } for monitoring"],
    ]
    tbl = Table(tech_rows, colWidths=[1.2 * inch, 5.3 * inch])
    tbl.setStyle(TableStyle([
        ("FONT", (0, 0), (0, -1), BOLD_FONT, 10),
        ("FONT", (1, 0), (1, -1), BASE_FONT, 10),
        ("TEXTCOLOR", (0, 0), (0, -1), NAVY),
        ("TEXTCOLOR", (1, 0), (1, -1), BLACK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [white, HexColor("#F7F8FB")]),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, LIGHT_GRAY),
        ("BOX", (0, 0), (-1, -1), 0.5, LIGHT_GRAY),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "The stack is deliberately boring. It is the smallest set of "
        "well-understood components that can run the CLR workflow reliably "
        "and be extended by a single engineer without ceremony. The "
        "database file is 52 MB on a 500 MB volume, leaving ample headroom. "
        "Every push to <b>main</b> ships to production automatically.",
        styles["bodyJ"]))

    # ---- Section 7: Closing ----
    story.append(Paragraph("Why This Matters", styles["H2"]))
    story.append(Paragraph(
        "CLR Connection Center is the operational backbone of West Capital "
        "Lending's CLR team. It makes the work visible, makes the reporting "
        "consistent, and makes the next integration — whichever one the "
        "business picks next — an afternoon of configuration rather than "
        "a quarter of engineering. It is shipped, it is stable, and it is "
        "the platform the team will grow on.", styles["bodyJ"]))

    story.append(Spacer(1, 10))
    story.append(callout(
        "The short version",
        "One application. One source of truth. One clean surface to add "
        "the next integration onto. That is the business case."))

    # ---- Section 8: Contact ---- (keep together as a unit)
    contact_rows = [
        ["Product owner / developer", "Ethan Wood — ethan.anthony.wood@gmail.com"],
        ["Secondary contact",         "Chris Redoble"],
        ["Live application",          "https://www.wlc.it.com"],
        ["Repository",                "github.com/EthanWood14/clr-connection-center (private)"],
        ["Health check",              "GET https://www.wlc.it.com/api/health"],
    ]
    ct = Table(contact_rows, colWidths=[2.0 * inch, 4.5 * inch])
    ct.setStyle(TableStyle([
        ("FONT", (0, 0), (0, -1), BOLD_FONT, 10),
        ("FONT", (1, 0), (1, -1), BASE_FONT, 10),
        ("TEXTCOLOR", (0, 0), (0, -1), NAVY),
        ("TEXTCOLOR", (1, 0), (1, -1), BLACK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("BOX", (0, 0), (-1, -1), 0.5, LIGHT_GRAY),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, LIGHT_GRAY),
    ]))
    story.append(KeepTogether([
        Spacer(1, 14),
        Paragraph("Contact", styles["H2"]),
        Paragraph(
            "Questions, feature requests, and access issues should go to the "
            "primary contact. The secondary contact handles escalations and "
            "manager-level coordination.", styles["body"]),
        ct,
    ]))

    # Build — but first insert the cover. BaseDocTemplate starts with first template.
    # We defined Cover first so page 1 uses cover_page. We then used
    # NextPageTemplate("Body") so page 2+ uses body_page.
    doc.build(story)

    # Copy to dist
    import shutil
    shutil.copyfile(OUT_PATH_1, OUT_PATH_2)
    print(f"Wrote {OUT_PATH_1}")
    print(f"Wrote {OUT_PATH_2}")


if __name__ == "__main__":
    build()

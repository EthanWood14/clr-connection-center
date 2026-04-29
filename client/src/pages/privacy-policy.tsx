export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-sm leading-relaxed">
      <div>
        <h1 className="text-2xl font-bold mb-1">Privacy Policy</h1>
        <p className="text-muted-foreground text-xs">Effective Date: January 1, 2026 · Last Updated: April 29, 2026</p>
      </div>

      <p>
        This Privacy Policy describes how West Capital Lending ("Company," "we," "us," or "our") collects,
        uses, and protects information entered into the CLR Connection Center ("the Application"), a proprietary
        internal workforce management platform developed by Chris Redoble and Ethan Wood.
      </p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">1. Scope</h2>
        <p>
          This policy applies solely to authorized employees and contractors of West Capital Lending who have
          been granted access to the Application. The Application is not intended for, and does not knowingly
          collect information from, any person outside of this authorized user base.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">2. Information We Collect</h2>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li><span className="text-foreground font-medium">Account Information:</span> Name, email address, and role assigned by an administrator.</li>
          <li><span className="text-foreground font-medium">Activity Data:</span> Daily call logs, lead outcome records, end-of-day reports, assignment history, and audit trail entries generated in the course of normal use.</li>
          <li><span className="text-foreground font-medium">LO & Lead Data:</span> Loan officer profiles, credentials, licensing information, and contact details entered or imported by authorized users.</li>
          <li><span className="text-foreground font-medium">Session Data:</span> Login timestamps and IP addresses used for security and rate-limiting purposes.</li>
          <li><span className="text-foreground font-medium">Push Notification Tokens:</span> Browser push subscription endpoints stored for in-app notifications (goal-hit alerts, NMLS reminders). These are stored server-side and are never shared.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">3. How We Use Information</h2>
        <p>Information collected within the Application is used exclusively to:</p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Facilitate internal loan officer assignment and call reporting workflows.</li>
          <li>Generate performance analytics and team statistics for internal management use.</li>
          <li>Send end-of-day summary emails and performance notifications to authorized managers and CLRs.</li>
          <li>Maintain audit logs for administrative oversight and accountability.</li>
          <li>Protect the integrity and security of the Application.</li>
        </ul>
        <p>We do not sell, rent, or share any data with third parties for marketing or commercial purposes.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">4. Cookies &amp; Browser Storage</h2>
        <p>
          The Application uses <strong>strictly necessary</strong> cookies and browser storage only. No
          advertising, analytics, or third-party tracking cookies are used.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead className="bg-muted/60">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Name</th>
                <th className="text-left px-3 py-2 font-semibold">Type</th>
                <th className="text-left px-3 py-2 font-semibold">Purpose</th>
                <th className="text-left px-3 py-2 font-semibold">Expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-3 py-2 font-mono font-medium">clr_session</td>
                <td className="px-3 py-2 text-muted-foreground">HTTP Cookie</td>
                <td className="px-3 py-2 text-muted-foreground">Authenticates your login session. httpOnly and signed — not accessible to JavaScript.</td>
                <td className="px-3 py-2 text-muted-foreground">7 days (sliding)</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono font-medium">UI preferences</td>
                <td className="px-3 py-2 text-muted-foreground">localStorage</td>
                <td className="px-3 py-2 text-muted-foreground">Saves your timezone, active settings tab, dashboard period, and team stats filters so they persist across sessions.</td>
                <td className="px-3 py-2 text-muted-foreground">Until cleared</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono font-medium">Chat read state</td>
                <td className="px-3 py-2 text-muted-foreground">localStorage</td>
                <td className="px-3 py-2 text-muted-foreground">Tracks the last chat message ID you've seen, to show an unread badge accurately.</td>
                <td className="px-3 py-2 text-muted-foreground">Until cleared</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono font-medium">Goal celebrations</td>
                <td className="px-3 py-2 text-muted-foreground">localStorage</td>
                <td className="px-3 py-2 text-muted-foreground">Records whether the weekly goal celebration animation has already been shown, so it only appears once per week.</td>
                <td className="px-3 py-2 text-muted-foreground">1 week</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono font-medium">Session UI state</td>
                <td className="px-3 py-2 text-muted-foreground">sessionStorage</td>
                <td className="px-3 py-2 text-muted-foreground">Tracks whether the splash screen and dismissible banners have been shown in the current tab session.</td>
                <td className="px-3 py-2 text-muted-foreground">Tab close</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono font-medium">clr_cookie_notice_v1</td>
                <td className="px-3 py-2 text-muted-foreground">localStorage</td>
                <td className="px-3 py-2 text-muted-foreground">Records that you have dismissed the cookie notice, so it doesn't reappear.</td>
                <td className="px-3 py-2 text-muted-foreground">Until cleared</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-muted-foreground text-xs">
          Because all storage is strictly necessary for the Application to function, no consent opt-in or
          opt-out mechanism is required under California law (CCPA). You may clear browser storage at any time
          via your browser settings — doing so will log you out and reset UI preferences.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">5. California Privacy Rights (CCPA / CPRA)</h2>
        <p>
          The California Consumer Privacy Act (CCPA) and its amendment (CPRA) grant California residents
          certain rights regarding their personal information. As the CLR Connection Center is an internal
          workforce tool, the data collected about authorized users falls under the <strong>employee and
          personnel exemption</strong> (Cal. Civ. Code §1798.145(m)). This means standard consumer-facing
          CCPA opt-out and deletion rights do not apply in the same manner as they would for a consumer-facing
          service.
        </p>
        <p>
          Nonetheless, West Capital Lending is committed to transparency and will honor reasonable data
          access and deletion requests from current and former employees. To submit a request:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Email <a href="mailto:reports@westcapitallending.center" className="text-primary underline underline-offset-2">reports@westcapitallending.center</a> with subject line "Data Request."</li>
          <li>We will acknowledge within 10 business days and respond within 45 calendar days.</li>
          <li>We do not sell or share personal information for cross-context behavioral advertising.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">6. Data Storage &amp; Security</h2>
        <p>
          All data is stored on servers hosted via Railway (railway.app) in the United States. Access is
          restricted to authenticated users via signed, httpOnly session cookies. We implement rate limiting
          and audit logging to detect and deter unauthorized access. Credentials stored within the Application
          (e.g., Bonzo, Lead Mailbox passwords) are accessible only to authenticated users with appropriate
          role permissions and are stored in a SQLite database with filesystem-level security. Users are
          advised not to store highly sensitive credentials (e.g., SSNs, financial account numbers) in
          free-text fields.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">7. Data Retention &amp; Deletion</h2>
        <p>
          Data is retained for the operational lifetime of the Application unless an administrator explicitly
          removes records. User accounts may be deactivated at any time by an administrator. Upon termination
          of employment, accounts are deactivated and data is retained per West Capital Lending's standard
          record-retention obligations. Employees may request deletion of their personal account data by
          contacting an administrator or the email address below.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">8. Third-Party Services</h2>
        <p>The Application integrates with the following third-party services. Each has its own privacy policy:</p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li><span className="text-foreground font-medium">Railway (railway.app)</span> — Hosting infrastructure. Data is stored in their US-based servers.</li>
          <li><span className="text-foreground font-medium">Resend (resend.com)</span> — Transactional email delivery for EOD reports and notifications. Email addresses are transmitted to send messages; no data is retained by Resend beyond delivery logs.</li>
          <li><span className="text-foreground font-medium">Bonzo / Mojo Dialer</span> — Optional CRM and dialer integrations. Data is exchanged only when explicitly configured and used by authorized administrators.</li>
          <li><span className="text-foreground font-medium">Google Fonts</span> — Font files loaded from fonts.googleapis.com. Google may collect standard browser request data (IP address, user agent) per their privacy policy.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. The "Last Updated" date at the top of this
          page will reflect any changes. Continued use of the Application following any update constitutes
          acceptance of the revised policy. Material changes will be communicated via an in-app notice.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">10. Contact</h2>
        <p>
          For questions regarding this Privacy Policy or to submit a data request:
        </p>
        <p>
          <a href="mailto:reports@westcapitallending.center" className="text-primary underline underline-offset-2">reports@westcapitallending.center</a>
          <br />
          West Capital Lending · CLR Connection Center<br />
          Developed by Chris Redoble &amp; Ethan Wood
        </p>
      </section>

      <p className="text-xs text-muted-foreground border-t pt-4">
        © 2026 West Capital Lending. All rights reserved. CLR Connection Center is proprietary software
        developed by Chris Redoble &amp; Ethan Wood.
      </p>
    </div>
  );
}

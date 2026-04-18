export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-sm leading-relaxed">
      <div>
        <h1 className="text-2xl font-bold mb-1">Privacy Policy</h1>
        <p className="text-muted-foreground text-xs">Effective Date: January 1, 2026 · Last Updated: April 17, 2026</p>
      </div>

      <p>
        This Privacy Policy describes how West Capital Lending ("Company," "we," "us," or "our") collects,
        uses, and protects information entered into the CLR Connection Center ("the Application"), a proprietary
        internal workflow management platform developed by Chris Redoble and Ethan Wood.
      </p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">1. Scope</h2>
        <p>
          This policy applies solely to authorized employees and contractors of West Capital Lending who have been
          granted access to the Application. The Application is not intended for, and does not knowingly collect
          information from, any person outside of this authorized user base.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">2. Information We Collect</h2>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li><span className="text-foreground font-medium">Account Information:</span> Name, email address, and role assigned by an administrator.</li>
          <li><span className="text-foreground font-medium">Activity Data:</span> Daily call logs, lead outcome records, assignment history, and audit trail entries generated in the course of normal use.</li>
          <li><span className="text-foreground font-medium">LO & Lead Data:</span> Loan officer profiles, credentials, licensing information, and contact details entered or imported by authorized users.</li>
          <li><span className="text-foreground font-medium">Session Data:</span> Login timestamps and IP addresses used for security and rate-limiting purposes.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">3. How We Use Information</h2>
        <p>Information collected within the Application is used exclusively to:</p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Facilitate internal loan officer assignment and call reporting workflows.</li>
          <li>Generate performance analytics and leaderboard rankings for internal management use.</li>
          <li>Maintain audit logs for administrative oversight and accountability.</li>
          <li>Protect the integrity and security of the Application.</li>
        </ul>
        <p>We do not sell, rent, or share any data with third parties for marketing or commercial purposes.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">4. Data Storage & Security</h2>
        <p>
          All data is stored on secured servers hosted via Railway (railway.app). Access is restricted to
          authenticated users via signed session cookies. We implement rate limiting and audit logging to
          detect and prevent unauthorized access. Credentials stored within the Application (e.g., Bonzo,
          Lead Mailbox) are accessible only to authenticated users and are not encrypted at rest beyond
          standard database security — users are advised not to store highly sensitive credentials in free-text fields.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">5. Access & Retention</h2>
        <p>
          Access to the Application is controlled by administrators. User accounts may be deactivated at any time.
          Data is retained for the operational lifetime of the Application unless an administrator explicitly
          removes records. Users may request deletion of their account data by contacting an administrator.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">6. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Continued use of the Application following
          any update constitutes acceptance of the revised policy.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">7. Contact</h2>
        <p>
          For questions regarding this Privacy Policy, contact:<br />
          <a href="mailto:ethan.anthony.wood@gmail.com" className="text-primary underline underline-offset-2">ethan.anthony.wood@gmail.com</a>
          {" · "}
          <a href="mailto:credoble@westcapitallending.com" className="text-primary underline underline-offset-2">credoble@westcapitallending.com</a>
        </p>
      </section>

      <p className="text-xs text-muted-foreground border-t pt-4">
        © 2026 West Capital Lending. All rights reserved. CLR Connection Center is proprietary software developed by Chris Redoble & Ethan Wood.
      </p>
    </div>
  );
}

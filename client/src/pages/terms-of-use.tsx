export default function TermsOfUse() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-sm leading-relaxed">
      <div>
        <h1 className="text-2xl font-bold mb-1">Terms of Use</h1>
        <p className="text-muted-foreground text-xs">Effective Date: January 1, 2026 · Last Updated: April 17, 2026</p>
      </div>

      <p>
        These Terms of Use ("Terms") govern your access to and use of the CLR Connection Center ("the Application"),
        a proprietary internal software platform owned by West Capital Lending and developed by Chris Redoble and
        Ethan Wood. By accessing the Application, you agree to be bound by these Terms.
      </p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">1. Authorized Use Only</h2>
        <p>
          The Application is provided exclusively to authorized employees and contractors of West Capital Lending.
          Access credentials are personal and non-transferable. You agree not to share your login credentials with
          any other person or allow unauthorized individuals to access the Application on your behalf.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">2. Intellectual Property</h2>
        <p>
          The CLR Connection Center, including all source code, design, data structures, logic, and documentation,
          is proprietary software developed by Chris Redoble and Ethan Wood for West Capital Lending. All rights
          are reserved. You may not copy, reproduce, modify, distribute, reverse-engineer, or create derivative
          works of any part of the Application without the express written consent of the owners.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">3. Acceptable Use</h2>
        <p>You agree to use the Application only for its intended business purposes and agree not to:</p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Attempt to access accounts, data, or systems beyond your authorized permission level.</li>
          <li>Introduce malicious code, scripts, or automated bots into the Application.</li>
          <li>Use the Application to harass, deceive, or harm any individual.</li>
          <li>Export, copy, or reproduce confidential loan officer or client data for unauthorized purposes.</li>
          <li>Attempt to circumvent rate limiting, authentication, or other security measures.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">4. Data Accuracy & Reporting</h2>
        <p>
          Users are responsible for the accuracy of data they enter into the Application, including daily call
          logs, lead outcomes, and loan officer information. Knowingly entering false or misleading data may
          result in loss of access and disciplinary action.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">5. Administrator Authority</h2>
        <p>
          Administrators reserve the right to access, modify, or delete any data within the Application;
          create, suspend, or remove user accounts; and override system-generated assignments when
          necessary. All administrative overrides are logged in the audit trail.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">6. Confidentiality</h2>
        <p>
          All information accessible through the Application — including loan officer profiles, credential
          data, assignment records, performance metrics, and business workflows — is strictly confidential
          to West Capital Lending. You agree not to disclose any such information to unauthorized parties
          during or after your employment or engagement with the Company.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">7. Disclaimer of Warranties</h2>
        <p>
          The Application is provided "as is" for internal operational use. West Capital Lending makes no
          warranties, express or implied, regarding uptime, fitness for a particular purpose, or freedom from
          errors. The developers will make reasonable efforts to maintain availability and correct issues promptly.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">8. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by applicable law, West Capital Lending, Chris Redoble, and Ethan Wood
          shall not be liable for any indirect, incidental, or consequential damages arising from your use of or
          inability to use the Application.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">9. Termination</h2>
        <p>
          Access to the Application may be suspended or terminated at any time, with or without notice, at
          the discretion of an administrator. Upon termination, you must immediately cease use of the Application.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">10. Governing Law</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the State of California,
          without regard to its conflict of law provisions.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">11. Contact</h2>
        <p>
          For questions regarding these Terms, contact:<br />
          <a href="mailto:ethan.anthony.wood@gmail.com" className="text-primary underline underline-offset-2">ethan.anthony.wood@gmail.com</a>
          {" · "}
          <a href="mailto:credoble@westcapitallending.com" className="text-primary underline underline-offset-2">credoble@westcapitallending.com</a>
        </p>
      </section>

      <p className="text-xs text-muted-foreground border-t pt-4">
        © 2026 West Capital Lending. All rights reserved. CLR Connection Center is proprietary software developed by Chris Redoble & Ethan Wood.
        Unauthorized use, reproduction, or distribution is strictly prohibited.
      </p>
    </div>
  );
}

import type { Metadata } from 'next'
import { LegalPage, Section } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Use - Fokus Kreativez',
  description: 'The terms that govern use of the Fokus Kreativez platform.',
}

const CONTACT = 'fokuskreatives@gmail.com'

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="June 10, 2026">
      <Section title="1. The service">
        <p>
          Fokus Kreativez provides a content creation and client-management platform:
          lead capture pages, a CRM (leads, meetings, invoices), content planning and
          approval tools, and integrations with third-party services such as Zoom, Google,
          and Calendly. By accessing the platform you agree to these terms.
        </p>
      </Section>

      <Section title="2. Accounts">
        <p>
          You are responsible for the accuracy of your account information and for keeping
          your credentials secure. Workspace owners are responsible for who they invite and
          for the data their team stores in the platform.
        </p>
      </Section>

      <Section title="3. Your data">
        <p>
          You retain all rights to the data you store in the platform (your contacts,
          leads, content, and documents). You grant us only the rights needed to host,
          process, and display it in order to provide the service, as described in our{' '}
          <a href="/privacy" className="text-[#2B79F7] hover:underline">Privacy Policy</a>.
          You are responsible for having a lawful basis to store the personal data of your
          own contacts in the platform.
        </p>
      </Section>

      <Section title="4. Acceptable use">
        <p>You agree not to use the platform to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>send spam or unlawful communications;</li>
          <li>store or distribute malicious code or infringing content;</li>
          <li>attempt to access other users&rsquo; data or disrupt the service;</li>
          <li>violate the terms of connected providers (Zoom, Google, Calendly).</li>
        </ul>
      </Section>

      <Section title="5. Third-party integrations">
        <p>
          Integrations are optional and governed additionally by the provider&rsquo;s own
          terms. We act on your behalf only within the access you grant (for example,
          creating and cancelling Zoom meetings you schedule through the platform). You can
          disconnect an integration at any time in your workspace settings.
        </p>
      </Section>

      <Section title="6. Availability and changes">
        <p>
          We aim for high availability but the service is provided &ldquo;as is&rdquo;
          without warranties of uninterrupted operation. We may update features over time.
          If we make material changes to these terms we will update the date above.
        </p>
      </Section>

      <Section title="7. Limitation of liability">
        <p>
          To the maximum extent permitted by law, Fokus Kreativez is not liable for
          indirect, incidental, or consequential damages arising from use of the platform.
          Our total liability for any claim is limited to the amounts paid for the service
          in the twelve months preceding the claim.
        </p>
      </Section>

      <Section title="8. Termination">
        <p>
          You may stop using the service at any time. We may suspend accounts that violate
          these terms. On termination we delete personal data as described in the Privacy
          Policy.
        </p>
      </Section>

      <Section title="9. Contact">
        <p>
          Questions about these terms:{' '}
          <a href={`mailto:${CONTACT}`} className="text-[#2B79F7] hover:underline">{CONTACT}</a>.
        </p>
      </Section>
    </LegalPage>
  )
}

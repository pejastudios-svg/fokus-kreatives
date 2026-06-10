import type { Metadata } from 'next'
import { LegalPage, Section } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy - Fokus Kreativez',
  description: 'How Fokus Kreativez collects, uses, and protects personal information.',
}

const CONTACT = 'fokuskreatives@gmail.com'

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="June 10, 2026">
      <Section title="Who we are">
        <p>
          Fokus Kreativez (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates a content creation and
          client-management platform that helps businesses manage leads, meetings, invoices,
          approvals, and content. This policy explains what personal information we process,
          why, and the rights you have over it. It applies to this website, the Fokus
          Kreativez app, and our integrations (including the Zoom, Google, and Calendly
          integrations).
        </p>
      </Section>

      <Section title="Information we collect">
        <p>
          <strong>Account information.</strong> Name, email address, and profile picture when
          you create an account or are invited to a workspace.
        </p>
        <p>
          <strong>Client and lead data.</strong> Information our users store in the platform
          about their own contacts: names, emails, phone numbers, form submissions from
          capture pages, meeting bookings, notes, and payment / invoice records.
        </p>
        <p>
          <strong>Integration data.</strong> When you connect a third-party service we store
          the credentials needed to act on your behalf: OAuth tokens (Zoom, Google,
          Calendly) and, if you connect your email, an app password stored encrypted
          (AES-256-GCM). For Zoom specifically, we store your OAuth tokens and the IDs of
          meetings created through the platform so we can create, reschedule, and cancel
          those meetings for you. We do not access your Zoom recordings, chat history, or
          meetings created outside the platform.
        </p>
        <p>
          <strong>Usage data.</strong> Basic technical logs (timestamps, errors) needed to
          operate and secure the service.
        </p>
      </Section>

      <Section title="How we use information">
        <p>We use personal information only to provide the service: authenticating you,
        storing and displaying your workspace data, creating and managing meetings through
        connected providers, sending the emails you ask the platform to send (invoices,
        meeting confirmations, notifications), and keeping the service secure. We do not
        sell personal information, and we do not use it for third-party advertising.</p>
      </Section>

      <Section title="Sharing">
        <p>
          We share data only with the processors required to run the service: our hosting
          and database providers (Vercel, Supabase), email delivery (Google), and the
          providers you explicitly connect (Zoom, Google, Calendly). Each receives only
          what is needed for its function.
        </p>
      </Section>

      <Section title="Security and retention">
        <p>
          Data is transmitted over TLS and stored with access controls. Connected email
          credentials are encrypted at rest with AES-256-GCM. We retain data for as long as
          the related account or workspace is active; disconnecting an integration deletes
          the stored credentials for it, and deleting your account removes your personal
          information except where retention is legally required.
        </p>
      </Section>

      <Section title="Your data subject rights">
        <p>
          Depending on where you live (including under the GDPR and similar laws), you have
          the right to:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Access</strong> the personal information we hold about you;</li>
          <li><strong>Correct</strong> inaccurate or incomplete information;</li>
          <li><strong>Delete</strong> your personal information;</li>
          <li><strong>Receive a copy</strong> of your information in a portable format;</li>
          <li><strong>Object to or restrict</strong> certain processing;</li>
          <li><strong>Withdraw consent</strong> at any time where processing is based on consent (for
          example, by disconnecting an integration);</li>
          <li><strong>Complain</strong> to your local data protection authority.</li>
        </ul>
        <p>
          To exercise any of these rights, email us at{' '}
          <a href={`mailto:${CONTACT}`} className="text-[#2B79F7] hover:underline">{CONTACT}</a>.
          We respond within 30 days. We will verify your identity before acting on a
          request.
        </p>
      </Section>

      <Section title="Zoom integration">
        <p>
          If you connect Zoom, we request only the scopes needed to create, update, and
          delete the meetings you schedule through the platform. You can revoke access at
          any time by disconnecting Zoom in your workspace settings or by removing the app
          from the Zoom App Marketplace (Manage &rarr; Added Apps). Revoking access deletes
          the stored tokens. See the{' '}
          <a href="/zoom-guide" className="text-[#2B79F7] hover:underline">Zoom guide</a>{' '}
          for details.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          We will update this page when our practices change and revise the date above.
          Questions about this policy:{' '}
          <a href={`mailto:${CONTACT}`} className="text-[#2B79F7] hover:underline">{CONTACT}</a>.
        </p>
      </Section>
    </LegalPage>
  )
}

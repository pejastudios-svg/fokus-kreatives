import type { Metadata } from 'next'
import { LegalPage, Section } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Support - Fokus Kreativez',
  description: 'Get help with the Fokus Kreativez platform and its integrations.',
}

const CONTACT = 'fokuskreatives@gmail.com'

export default function SupportPage() {
  return (
    <LegalPage title="Support">
      <Section title="Contact us">
        <p>
          The fastest way to reach the team is email:{' '}
          <a href={`mailto:${CONTACT}`} className="text-[#2B79F7] hover:underline">{CONTACT}</a>.
          We typically respond within one business day. Include your workspace name and, if
          relevant, a screenshot of what you&rsquo;re seeing.
        </p>
      </Section>

      <Section title="Common topics">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Connecting Zoom, Google Meet, or Calendly</strong> - go to your CRM
            workspace &rarr; Settings &rarr; Integrations and click Connect on the provider.
            For Zoom specifics see the{' '}
            <a href="/zoom-guide" className="text-[#2B79F7] hover:underline">Zoom guide</a>.
          </li>
          <li>
            <strong>Meetings not appearing</strong> - check the integration shows
            &ldquo;connected&rdquo; in Settings; if it shows an error, disconnect and
            reconnect.
          </li>
          <li>
            <strong>Invoices and payments</strong> - invoices are created from the Revenue
            tab; clients view and confirm them on a secure link.
          </li>
          <li>
            <strong>Email sending</strong> - connect your Gmail under Settings &rarr;
            Integrations &rarr; Email (Gmail) to send invoices and meeting emails from your
            own address.
          </li>
          <li>
            <strong>Account or data requests</strong> - see your rights and how to exercise
            them in the{' '}
            <a href="/privacy" className="text-[#2B79F7] hover:underline">Privacy Policy</a>.
          </li>
        </ul>
      </Section>

      <Section title="Reporting a problem">
        <p>
          For bugs or suspected security issues, email{' '}
          <a href={`mailto:${CONTACT}`} className="text-[#2B79F7] hover:underline">{CONTACT}</a>{' '}
          with the steps to reproduce. Security reports are prioritized.
        </p>
      </Section>
    </LegalPage>
  )
}

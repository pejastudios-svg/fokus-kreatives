import type { Metadata } from 'next'
import { LegalPage, Section } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Zoom Integration Guide - Fokus Kreativez',
  description: 'How to add, use, and remove the Fokus Kreativez Zoom integration.',
}

const CONTACT = 'fokuskreatives@gmail.com'

export default function ZoomGuidePage() {
  return (
    <LegalPage title="Zoom Integration Guide" updated="June 10, 2026">
      <Section title="What the integration does">
        <p>
          Connecting Zoom lets Fokus Kreativez create Zoom meetings on your behalf: when a
          visitor books time on one of your capture pages, or when you schedule a meeting
          from the CRM, the platform creates the Zoom meeting, stores the join link, and
          emails it to the attendee. Rescheduling or cancelling the meeting in the CRM
          updates or removes it on Zoom too.
        </p>
        <p>
          The integration only touches meetings created through the platform. It does not
          read your recordings, chats, or meetings you create elsewhere.
        </p>
      </Section>

      <Section title="Adding the app">
        <ol className="list-decimal pl-5 space-y-2">
          <li>Sign in to your Fokus Kreativez CRM workspace.</li>
          <li>
            Go to <strong>Settings &rarr; Integrations</strong> and click{' '}
            <strong>Connect</strong> next to <strong>Zoom</strong>.
          </li>
          <li>
            You&rsquo;ll be redirected to Zoom&rsquo;s consent page. Review the requested
            permissions and click <strong>Allow</strong>.
          </li>
          <li>
            You&rsquo;ll land back on the Settings page with Zoom showing{' '}
            <strong>connected</strong> and the linked Zoom account&rsquo;s email.
          </li>
        </ol>
      </Section>

      <Section title="Using the app">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Capture pages:</strong> set a page&rsquo;s meeting integration to Zoom;
            visitors pick a date and time, and the platform creates the Zoom meeting and
            emails them the join link automatically.
          </li>
          <li>
            <strong>CRM meetings:</strong> when adding a meeting, choose Zoom as the
            platform - the meeting is created on your Zoom account with the join link
            attached to the CRM record.
          </li>
          <li>
            <strong>Reschedule / cancel:</strong> changing the date or cancelling in the
            CRM updates or deletes the Zoom meeting (attendees are notified).
          </li>
        </ul>
      </Section>

      <Section title="Removing the app">
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            In Fokus Kreativez: <strong>Settings &rarr; Integrations &rarr; Zoom &rarr;
            Disconnect</strong>. This revokes and deletes the stored tokens.
          </li>
          <li>
            In Zoom: sign in to the{' '}
            <a
              href="https://marketplace.zoom.us"
              target="_blank"
              rel="noreferrer"
              className="text-[#2B79F7] hover:underline"
            >
              Zoom App Marketplace
            </a>
            , open <strong>Manage &rarr; Added Apps</strong>, find Fokus Kreativez and click{' '}
            <strong>Remove</strong>.
          </li>
        </ol>
        <p>
          After removal, existing CRM records keep their meeting history, but the platform
          can no longer create or change Zoom meetings until you reconnect.
        </p>
      </Section>

      <Section title="Data handled">
        <p>
          While connected, we store your Zoom OAuth tokens (to act on your behalf) and the
          IDs of meetings created through the platform (to update or cancel them). Both are
          deleted when you disconnect. See the{' '}
          <a href="/privacy" className="text-[#2B79F7] hover:underline">Privacy Policy</a>{' '}
          for full details.
        </p>
      </Section>

      <Section title="Troubleshooting">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>&ldquo;Zoom not connected&rdquo; errors</strong> - the connection
            expired or was revoked; disconnect and reconnect in Settings.
          </li>
          <li>
            <strong>Cancel didn&rsquo;t remove the Zoom meeting</strong> - the meeting may
            have been created under a different Zoom account than the one connected.
          </li>
          <li>
            Anything else - email{' '}
            <a href={`mailto:${CONTACT}`} className="text-[#2B79F7] hover:underline">{CONTACT}</a>{' '}
            or see <a href="/support" className="text-[#2B79F7] hover:underline">Support</a>.
          </li>
        </ul>
      </Section>
    </LegalPage>
  )
}

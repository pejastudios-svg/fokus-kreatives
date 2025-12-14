// lib/google-meet.ts
import { google } from 'googleapis'

export async function createGoogleMeetEvent(eventData: {
  summary: string
  description: string
  start: string
  end: string
  attendees: string[]
}) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )

  // Use your refresh token to get access token
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })

  const calendar = google.calendar({ version: 'v3', auth })

  const event = {
    summary: eventData.summary,
    description: eventData.description,
    start: {
      dateTime: eventData.start,
      timeZone: 'America/New_York',
    },
    end: {
      dateTime: eventData.end,
      timeZone: 'America/New_York',
    },
    conferenceData: {
      createRequest: {
        requestId: Math.random().toString(36).substring(2, 15),
        conferenceSolution: {
          key: {
            type: 'hangoutsMeet'
          }
        }
      }
    },
    attendees: eventData.attendees.map(email => ({ email })),
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 10 }
      ]
    }
  }

  const response = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
    conferenceDataVersion: 1,
  })

  return response.data
}
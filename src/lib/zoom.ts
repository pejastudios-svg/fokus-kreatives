import jwt from 'jsonwebtoken'

export async function createZoomMeeting(meetingData: {
  topic: string
  startTime: string
  duration: number
  timezone: string
}) {
  const token = jwt.sign({}, process.env.ZOOM_API_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '1h',
    header: { alg: 'HS256', typ: 'JWT' }
  })

  const response = await fetch(`https://api.zoom.us/v2/users/me/meetings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      topic: meetingData.topic,
      type: 2, // Scheduled meeting
      start_time: meetingData.startTime,
      duration: meetingData.duration,
      timezone: meetingData.timezone,
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        mute_upon_entry: false,
        watermark: false,
        use_pmi: false,
        approval_type: 0,
        registration_type: 1,
        audio: 'both',
        auto_recording: 'none',
        enforce_login: false,
        waiting_room: false
      }
    })
  })

  if (!response.ok) {
    throw new Error('Failed to create Zoom meeting')
  }

  return await response.json()
}
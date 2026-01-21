// lib/meeting-scheduler.ts
import { createClient } from '@/lib/supabase/client'

export async function scheduleMeeting(
  platform: string, 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meetingData: Record<string, any>, 
  clientId: string
) {
  let meetingUrl = ''
  
  try {
    // For now, just create Jitsi meetings (easiest)
    if (platform === 'jitsi') {
      const roomName = Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
      meetingUrl = `https://meet.jit.si/${roomName}`
    } else {
      // Default to Jitsi for other platforms too (for now)
      const roomName = Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
      meetingUrl = `https://meet.jit.si/${roomName}`
    }
    
    // Save to database
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meetings')
      .insert({
        ...meetingData,
        client_id: clientId,
        meeting_url: meetingUrl,
        platform: platform
      })
      .select()
      .single()
    
    if (error) throw error
    
    return { success: true, meeting: data }
    
  } catch (error) {
    console.error('Meeting scheduling error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
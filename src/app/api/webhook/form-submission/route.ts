import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { form_id, form_data, timestamp } = await request.json()

    // Get form details
    const { data: form } = await supabase
      .from('capture_forms')
      .select('client_id, settings, fields')
      .eq('id', form_id)
      .single()

    if (!form) {
      return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 })
    }

    // Save lead to CRM
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .insert({
        client_id: form.client_id,
        data: form_data,
        source: 'capture_form',
        notes: `Submitted via form: ${form_id}`
      })
      .select()
      .single()

    if (leadError) {
      console.error('Lead creation error:', leadError)
      return NextResponse.json({ success: false, error: 'Failed to create lead' }, { status: 500 })
    }

    // Trigger email notifications if enabled
    if (form.settings.notifications?.email) {
      try {
        await fetch('/api/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: 'client@example.com', // This should be the client's email
            subject: 'New Form Submission',
            type: 'form-submission',
            data: {
              form_name: form.name,
              lead_data: form_data,
              lead_id: lead.id
            }
          })
        })
      } catch (emailError) {
        console.error('Email notification error:', emailError)
      }
    }

    // Trigger webhook if enabled
    if (form.settings.notifications?.webhook && form.settings.notifications.webhookUrl) {
      try {
        await fetch(form.settings.notifications.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'form_submission',
            form_id,
            lead_id: lead.id,
            data: form_data,
            timestamp
          })
        })
      } catch (webhookError) {
        console.error('Webhook notification error:', webhookError)
      }
    }

    // Schedule meeting if meeting field was included
    const meetingField = form.fields.find(f => f.type === 'meeting')
    if (meetingField && form_data[meetingField.id]) {
      // This would integrate with your meeting scheduling system
      console.log('Meeting booking requested:', form_data[meetingField.id])
    }

    return NextResponse.json({ success: true, lead_id: lead.id })

  } catch (error) {
    console.error('Form submission error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
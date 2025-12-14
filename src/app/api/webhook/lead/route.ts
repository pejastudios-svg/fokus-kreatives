import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// This webhook can receive leads from ManyChat, Zapier, or any other tool
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      client_id,
      name,
      email,
      phone,
      platform,
      source, // which content/keyword
      notes
    } = body

    const { data, error } = await supabase
      .from('leads')
      .insert({
        client_id,
        name: name || 'Unknown',
        email: email || null,
        phone: phone || null,
        platform: platform || 'unknown',
        status: 'new',
        notes: notes || `Source: ${source || 'webhook'}`,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, lead: data })

  } catch (error) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 500 })
  }
}
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: NextRequest) {
  try {
    const { to, subject, type, data } = await request.json()

    let html = ''

    if (type === 'team-invite') {
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #2B79F7 0%, #1E54B7 50%, #143A80 100%); padding: 40px; text-align: center;">
            <h1 style="color: white; margin: 0;">Fokus Kreatives</h1>
          </div>
          <div style="padding: 40px; background: #f9fafb;">
            <h2 style="color: #1f2937;">You're Invited!</h2>
            <p style="color: #6b7280;">Hi ${data.name},</p>
            <p style="color: #6b7280;">${data.invitedBy} has invited you to join Fokus Kreatives as a <strong>${data.role}</strong>.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/invite/${data.token}" 
                 style="background: linear-gradient(135deg, #2B79F7 0%, #1E54B7 100%); 
                        color: white; 
                        padding: 12px 30px; 
                        text-decoration: none; 
                        border-radius: 8px;
                        display: inline-block;">
                Accept Invitation
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 14px;">This invitation expires in 7 days.</p>
          </div>
        </div>
      `
    } else if (type === 'client-invite') {
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #2B79F7 0%, #1E54B7 50%, #143A80 100%); padding: 40px; text-align: center;">
            <h1 style="color: white; margin: 0;">Fokus Kreatives</h1>
          </div>
          <div style="padding: 40px; background: #f9fafb;">
            <h2 style="color: #1f2937;">Welcome to Your Client Portal!</h2>
            <p style="color: #6b7280;">Hi ${data.name},</p>
            <p style="color: #6b7280;">Your client portal is ready.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL}/invite/${data.token}" 
                 style="background: linear-gradient(135deg, #2B79F7 0%, #1E54B7 100%); 
                        color: white; 
                        padding: 12px 30px; 
                        text-decoration: none; 
                        border-radius: 8px;
                        display: inline-block;">
                Access Your Portal
              </a>
            </div>
          </div>
        </div>
      `
    }

    // For free tier, Resend only allows sending to verified emails
    // You can only send to yourself until you verify a domain
    const { data: emailData, error } = await resend.emails.send({
      from: 'Fokus Kreatives <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: html,
    })

    if (error) {
      console.error('Resend error:', error)
      // Return success anyway but log the error - for development
      return NextResponse.json({ 
        success: true, 
        message: 'Invitation created (email may not send on free tier)',
        error: error.message 
      })
    }

    return NextResponse.json({ success: true, data: emailData })

  } catch (error) {
    console.error('Email error:', error)
    return NextResponse.json({ success: false, error: 'Failed to send email' }, { status: 500 })
  }
}
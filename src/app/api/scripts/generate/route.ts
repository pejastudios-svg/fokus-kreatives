import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      clientId, // Keeping for logging if needed, or remove if strictly unused
      clientProfile,
      contentType, 
      contentPillar, 
      ideaInput,
      referenceScript, 
      tier,
      ctaText
    } = body

    // 1. Analyze Input
    const cleanIdea = (ideaInput || '').trim()
    const isLongDraft = cleanIdea.length > 150 
    const isSeries = contentPillar === 'series' // match lowercase from frontend values
    const isDoubleDown = contentPillar === 'doubledown'

    // 2. The 5-Part Structure (Expanded for better length/pacing)
    const storyStructure = `
    STRICT 5-PART SCRIPT STRUCTURE:
    1. HOOK (0:00-0:03): Stop the scroll. Use a pattern interrupt or emotional statement.
    2. STORY SETUP (0:03-0:08): "Let's say you're...", "Picture this...", "It's Day 2 and...". Drop them into the specific scenario immediately.
    3. OPEN LOOP + TEACH (0:08-0:38): 
       - Open Loop: "I'll show you [Solution], but first [Context/Struggle]"
       - The Meat: Teach the lesson or tell the story through discovery ("I used to...", "Then I realized...").
       - Detail: Be specific. If the draft mentions "fixing bugs" or "GPT tokens", talk about that pain.
    4. LOOP BACK (0:38-0:43): Tie the ending back to the hook or setup to close the loop.
    5. CTA (0:43-0:50): You MUST use the exact CTA provided below.
    `

    // 3. Construct System Prompt
    let systemPrompt = `You are an elite scriptwriter. You write viral, story-driven content.
    
    CLIENT CONTEXT:
    - Industry: ${clientProfile?.business?.industry || 'General'}
    - Voice: ${clientProfile?.voice?.traits || 'Professional'} (Casualness: ${clientProfile?.voice?.casualness}/5)
    - Target Audience: ${clientProfile?.audience?.work_roles || 'People'}
    - Tier: ${tier} (Beginner = Guide tone, Advanced = Authority tone)
    `

    // --- MODE SELECTION ---
    if (isLongDraft) {
      systemPrompt += `
      \n**MODE: EDITOR & EXPANDER**
      The user provided a ROUGH DRAFT/IDEA.
      ✅ YOUR JOB: Flesh this out into a full, engaging script using the 5-Part Structure.
      ✅ EXPAND: Don't just summarize. If the user says "it's frustrating", describe *why* it's frustrating. Make us feel it.
      ❌ RULES:
         - Keep specific names (Jedidiah, Seun, Fokus KREATVEZ).
         - Keep specific numbers (10k in 30 days).
         - Do NOT invent fake results.
         - Do NOT be generic. Use the specific details from the draft.
      `
    } else if (isDoubleDown && referenceScript) {
      systemPrompt += `
      \n**MODE: DOUBLE DOWN (CLONE)**
      Reference Script provided.
      ✅ YOUR JOB: Analyze the Reference Script's rhythm, hook style, and structure.
      ✅ ACTION: Write a NEW script about "${cleanIdea}" that feels exactly like the reference script but covers this new topic.
      `
    } else if (isSeries && referenceScript) {
      systemPrompt += `
      \n**MODE: SERIES (NEXT PART)**
      Reference Script provided (Previous Part).
      ✅ YOUR JOB: Write the NEXT part of this story/lesson.
      ✅ ACTION: Briefly recap ("In part 1...") then move the story forward immediately.
      `
    } else {
      systemPrompt += `
      \n**MODE: CREATOR (FROM SCRATCH)**
      Topic: "${cleanIdea}"
      ✅ YOUR JOB: Create a script from scratch using the Client Profile.
      ✅ USE:
         - Pain Point: ${clientProfile?.audience?.pain_points?.[0] || 'General struggle'}
         - Desire: ${clientProfile?.audience?.desires || 'Success'}
      `
    }

    systemPrompt += `
    \n**FINAL FORMATTING RULES:**
    - Output ONLY the script text. No intro/outro commentary.
    - Follow the 5-Part Structure headings ([HOOK], [STORY SETUP], etc).
    - If a CTA is provided, it is MANDATORY. Use it verbatim.
    `

    // 4. User Prompt Construction
    let userPrompt = `Generate the ${contentType} script.`
    
    if (isLongDraft) {
      userPrompt += `\n\nMY DRAFT:\n"""\n${cleanIdea}\n"""`
    } else {
      userPrompt += `\n\nTOPIC:\n"${cleanIdea}"`
    }

    if (referenceScript) {
      userPrompt += `\n\nREFERENCE SCRIPT (For Context):\n"""\n${referenceScript}\n"""`
    }

    if (ctaText) {
      userPrompt += `\n\nREQUIRED CTA (Verbatim):\n"${ctaText}"`
    } else {
      userPrompt += `\n\nNO CTA SECTION REQUIRED.`
    }

    // 5. Generate
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7, // Higher temp allows for better "fleshing out" of the story
      max_tokens: 4000,
    })

    const content = completion.choices[0]?.message?.content || ''
    
    // Logging for debugging
    console.log(`Generated script for client ${clientId} (Mode: ${isLongDraft ? 'Editor' : 'Creator'})`)

    return NextResponse.json({ success: true, content })

  } catch (error) {
    console.error('Script Gen Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to generate script' }, { status: 500 })
  }
}
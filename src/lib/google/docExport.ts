// Doc export helper. Two paths:
//
//   PRIMARY: POST to the Apps Script webhook (APPS_SCRIPT_EXPORT_WEBHOOK_URL).
//     The script runs as the script owner, so docs land in their Drive,
//     bypassing the "service accounts have 0 Drive quota" restriction on
//     personal Gmail accounts. Auth via a shared secret
//     (APPS_SCRIPT_EXPORT_SECRET) that must match EXPECTED_SECRET in the
//     Apps Script. The script creates one tab per campaign for easy
//     navigation, plus an Overview tab.
//
//   FALLBACK: generate a .docx file in memory using the `docx` npm
//     library. Tabs flatten into H1-divided sections. Returned as base64
//     so the UI can trigger a download. Triggered when:
//       - APPS_SCRIPT_EXPORT_WEBHOOK_URL or APPS_SCRIPT_EXPORT_SECRET is unset
//       - the webhook POST fails
//       - the webhook returns { ok: false }

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from 'docx'

export interface DocSegment {
  text: string
  style?: 'h1' | 'h2' | 'h3' | 'bold' | 'plain'
}

/** A non-long-form asset inside a campaign. Becomes a sub-tab in Google
 *  Docs / an H2-divided section in the .docx fallback. */
export interface AssetSubTab {
  /** Display name of the sub-tab. e.g. "Short-form #1", "Engagement Reel #2". */
  name: string
  /** Stream the asset belongs to - drives ordering in the .docx fallback. */
  stream: 'short_form' | 'engagement_reel' | 'carousel' | 'story'
  /** Body content of the sub-tab. */
  segments: DocSegment[]
}

/** One campaign's full export payload. Top-level tab body is the
 *  long-form; sub-tabs are the non-long-form assets. */
export interface CampaignSection {
  /** Top-level tab name. e.g. "Campaign 1 (2026-06-01)". */
  name: string
  /** The topic_group_id this section belongs to. */
  topicGroupId: string
  /** Header segments rendered at the top of the campaign's main tab
   *  (before the long-form script). Typically the campaign label +
   *  long-form metadata. */
  headerSegments: DocSegment[]
  /** The long-form script body, paragraph by paragraph. Rendered as the
   *  main content of the campaign's top-level tab. */
  longFormSegments: DocSegment[]
  /** Non-long-form assets - each becomes a sub-tab under this campaign. */
  childTabs: AssetSubTab[]
}

export interface ExportInput {
  /** Document title (also used for the .docx filename). */
  title: string
  /** One top-level tab per campaign. */
  campaigns: CampaignSection[]
  /** Emails to share the Google Doc with (Apps Script path only). */
  shareWith: string[]
}

/** A single created doc returned by the Apps Script export. */
export interface CreatedDoc {
  docUrl: string
  docId: string
  name: string
}

export type ExportResult =
  | { mode: 'gdoc'; docs: CreatedDoc[]; appsScriptDiagnostics?: unknown }
  | { mode: 'docx'; docxBase64: string; filename: string; fallbackReason: string }

export function getGlobalShareList(): string[] | null {
  const raw = process.env.GOOGLE_DOCS_SHARE_WITH?.trim()
  if (!raw) return null
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function resolveFolderId(): string | null {
  const raw = process.env.GOOGLE_DOCS_FOLDER_ID?.trim()
  if (!raw) return null
  const urlMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (urlMatch) return urlMatch[1]
  return raw.split('?')[0]
}

async function tryAppsScriptExport(
  input: ExportInput,
): Promise<{ docs: CreatedDoc[]; diagnostics?: unknown } | { error: string }> {
  const webhookUrl = process.env.APPS_SCRIPT_EXPORT_WEBHOOK_URL?.trim()
  const secret = process.env.APPS_SCRIPT_EXPORT_SECRET?.trim()

  if (!webhookUrl || !secret) {
    return { error: 'Apps Script webhook not configured (APPS_SCRIPT_EXPORT_WEBHOOK_URL or APPS_SCRIPT_EXPORT_SECRET missing)' }
  }

  const folderId = resolveFolderId()
  const payload = {
    secret,
    title: input.title,
    fontFamily: 'Montserrat',
    campaigns: input.campaigns,
    shareWith: input.shareWith,
    folderId,
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
      redirect: 'follow',
    })

    if (!res.ok) {
      // Never surface the raw body - Google returns full HTML pages here
      // and users were seeing "<!DOCTYPE html>..." dumps in the export
      // banner. Map the status to what it actually means.
      const hint =
        res.status === 404
          ? 'The Google Docs webhook deployment no longer exists - redeploy the Apps Script and update APPS_SCRIPT_EXPORT_WEBHOOK_URL.'
          : res.status === 401 || res.status === 403
            ? 'The Google Docs webhook refused the request - check the deployment is a Web app with access set to Anyone.'
            : 'The Google Docs webhook is not responding normally - try again in a minute.'
      return { error: `Google Docs export unavailable (${res.status}). ${hint}` }
    }

    let json: {
      ok?: boolean
      docs?: CreatedDoc[]
      error?: string
      diagnostics?: unknown
    }
    try {
      json = (await res.json()) as typeof json
    } catch {
      return {
        error:
          'The Google Docs webhook returned an unreadable response - check the Apps Script deployment, then try again.',
      }
    }
    if (!json.ok) {
      const reason = (json.error || '').slice(0, 160) || 'unknown error'
      const hint =
        /invalid secret/i.test(reason)
          ? ' The EXPECTED_SECRET in the Apps Script does not match APPS_SCRIPT_EXPORT_SECRET.'
          : ''
      return { error: `Google Docs export failed: ${reason}.${hint}` }
    }
    if (!Array.isArray(json.docs) || json.docs.length === 0) {
      return { error: 'Google Docs export returned no documents - try again.' }
    }
    return { docs: json.docs, diagnostics: json.diagnostics }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const friendly = /abort|timeout/i.test(detail)
      ? 'The Google Docs webhook timed out after 90 seconds - large exports can do this; try again or export one campaign at a time.'
      : /ENOTFOUND|ECONNREFUSED|fetch failed/i.test(detail)
        ? 'Could not reach Google - check the connection and try again.'
        : `Google Docs export failed: ${detail.slice(0, 160)}`
    return { error: friendly }
  }
}

function segmentToDocxParagraph(seg: DocSegment): Paragraph {
  const text = (seg.text ?? '').replace(/\n+$/, '')
  if (!text) {
    return new Paragraph({ children: [new TextRun('')] })
  }
  // docx supports a top-level `font` on the document; we don't set it per
  // paragraph to keep .docx files small. The output renders in the
  // user's default Word/Pages font.
  switch (seg.style) {
    case 'h1':
      return new Paragraph({ text, heading: HeadingLevel.HEADING_1 })
    case 'h2':
      return new Paragraph({ text, heading: HeadingLevel.HEADING_2 })
    case 'h3':
      return new Paragraph({ text, heading: HeadingLevel.HEADING_3 })
    case 'bold':
      return new Paragraph({ children: [new TextRun({ text, bold: true })] })
    default:
      return new Paragraph({ children: [new TextRun(text)] })
  }
}

async function generateDocxFallback(input: ExportInput): Promise<{ docxBase64: string; filename: string }> {
  // Flatten: for each campaign, the long-form as the main section, then
  // each sub-tab asset as a sub-section, with H1 dividers between
  // campaigns and H2 dividers between assets. Page breaks between
  // campaigns make the .docx viewer divisions clean.
  const allParagraphs: Paragraph[] = []
  input.campaigns.forEach((campaign, idx) => {
    if (idx > 0) {
      allParagraphs.push(new Paragraph({ children: [new TextRun('')], pageBreakBefore: true }))
    }
    // Campaign top-level header
    allParagraphs.push(new Paragraph({ text: campaign.name, heading: HeadingLevel.HEADING_1 }))
    // Header segments (campaign metadata)
    for (const seg of campaign.headerSegments) {
      allParagraphs.push(segmentToDocxParagraph(seg))
    }
    // Long-form section
    allParagraphs.push(new Paragraph({ text: 'Long-form', heading: HeadingLevel.HEADING_2 }))
    for (const seg of campaign.longFormSegments) {
      allParagraphs.push(segmentToDocxParagraph(seg))
    }
    // Each child tab as an H2 section
    for (const sub of campaign.childTabs) {
      allParagraphs.push(new Paragraph({ text: sub.name, heading: HeadingLevel.HEADING_2 }))
      for (const seg of sub.segments) {
        allParagraphs.push(segmentToDocxParagraph(seg))
      }
    }
  })

  const doc = new Document({
    creator: 'Fokus Kreativez',
    title: input.title,
    styles: {
      default: {
        document: {
          run: { font: 'Montserrat' },
        },
      },
    },
    sections: [{ children: allParagraphs }],
  })

  const buffer = await Packer.toBuffer(doc)
  const docxBase64 = Buffer.from(buffer).toString('base64')
  const safeName = input.title.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'export'
  return { docxBase64, filename: `${safeName}.docx` }
}

export async function exportDoc(input: ExportInput): Promise<ExportResult> {
  const gdoc = await tryAppsScriptExport(input)
  if ('docs' in gdoc) {
    return {
      mode: 'gdoc',
      docs: gdoc.docs,
      appsScriptDiagnostics: gdoc.diagnostics,
    }
  }
  console.warn('[docExport] falling back to .docx:', gdoc.error)
  const docx = await generateDocxFallback(input)
  return {
    mode: 'docx',
    docxBase64: docx.docxBase64,
    filename: docx.filename,
    fallbackReason: gdoc.error,
  }
}

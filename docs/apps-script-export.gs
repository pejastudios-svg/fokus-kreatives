/**
 * Fokus Kreativez doc export webhook (v5 - one doc per campaign).
 *
 * Apps Script's DocumentApp does NOT support programmatic tab creation
 * or renaming (addTab and setTitle aren't exposed). Rather than fight
 * that, we create ONE Google Doc per campaign. Each doc is:
 *   - Named "Campaign 1 (DATE)" / "Campaign 2 (DATE)" / etc. The file
 *     name shows in Drive directly.
 *   - Has a single Tab 1 (always — Apps Script default).
 *   - Body starts with the campaign name as H1, then metadata, then the
 *     long-form, then H2 sections for each non-long-form asset, with
 *     H3 sub-headings for bracket section tags ([TITLE], [HOOK], etc.).
 *
 * Deploy:
 *   - Paste this whole file into Code.gs.
 *   - Set EXPECTED_SECRET below to your APPS_SCRIPT_EXPORT_SECRET value.
 *   - Save (Cmd+S).
 *   - Deploy → Manage deployments → pencil on existing deployment →
 *     Version: New version → Deploy. URL stays the same.
 *
 * Response shape:
 *   { ok: true, docs: [{docUrl, docId, name}, ...], diagnostics: {...} }
 *   { ok: false, error: "..." }
 */

const EXPECTED_SECRET = 'REPLACE_WITH_A_LONG_RANDOM_STRING'
const DEFAULT_FONT = 'Montserrat'

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'missing request body' })
    }

    var body
    try {
      body = JSON.parse(e.postData.contents)
    } catch (parseErr) {
      return jsonResponse({ ok: false, error: 'invalid JSON body' })
    }

    if (!body.secret || body.secret !== EXPECTED_SECRET) {
      return jsonResponse({ ok: false, error: 'invalid secret' })
    }

    var fontFamily = (body.fontFamily || DEFAULT_FONT).toString()
    var campaigns = Array.isArray(body.campaigns) ? body.campaigns : []
    var shareWith = Array.isArray(body.shareWith) ? body.shareWith : []
    var folderId = body.folderId ? String(body.folderId) : null

    if (campaigns.length === 0) {
      return jsonResponse({ ok: false, error: 'no campaigns supplied' })
    }

    // Create one doc per campaign. Per-doc failures are caught so the
    // overall export still succeeds for the docs that did work.
    var docs = []
    var diagnostics = {
      docsCreated: 0,
      docsFailed: 0,
      perDocErrors: [],
    }

    for (var ci = 0; ci < campaigns.length; ci++) {
      var camp = campaigns[ci] || {}
      var docTitle = (camp.name || ('Campaign ' + (ci + 1))).toString().slice(0, 200)

      try {
        var info = createOneCampaignDoc(camp, docTitle, fontFamily, folderId, shareWith)
        docs.push(info)
        diagnostics.docsCreated++
      } catch (campErr) {
        diagnostics.docsFailed++
        diagnostics.perDocErrors.push({
          campaign: docTitle,
          error: (campErr && campErr.message) ? campErr.message : String(campErr),
        })
      }
    }

    if (docs.length === 0) {
      return jsonResponse({
        ok: false,
        error: 'All campaign docs failed to create',
        diagnostics: diagnostics,
      })
    }

    return jsonResponse({
      ok: true,
      docs: docs,
      diagnostics: diagnostics,
    })
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: (err && err.message) ? err.message : String(err),
    })
  }
}

/**
 * Create a single Google Doc for one campaign.
 *   - Names the doc after the campaign.
 *   - Body: campaign H1 + metadata + long-form + asset H2 sections.
 *   - Moves into folderId if supplied.
 *   - Shares as Editor with each email in shareWith.
 *
 * Returns { docUrl, docId, name }. Throws on doc-create failure.
 */
function createOneCampaignDoc(camp, title, fontFamily, folderId, shareWith) {
  var doc = DocumentApp.create(title)
  var docId = doc.getId()
  var body = doc.getBody()
  body.clear()

  renderCampaignContent(body, camp, fontFamily)

  doc.saveAndClose()

  // Move into the configured folder.
  if (folderId) {
    try {
      var file = DriveApp.getFileById(docId)
      var folder = DriveApp.getFolderById(folderId)
      folder.addFile(file)
      DriveApp.getRootFolder().removeFile(file)
    } catch (folderErr) {
      // Non-fatal - doc still exists in root.
    }
  }

  // Share.
  var sharedFile = DriveApp.getFileById(docId)
  for (var si = 0; si < shareWith.length; si++) {
    var email = shareWith[si]
    if (!email || typeof email !== 'string' || email.indexOf('@') < 0) continue
    try {
      sharedFile.addEditor(email)
    } catch (shareErr) {
      // Per-email failure ignored.
    }
  }

  return {
    docUrl: doc.getUrl(),
    docId: docId,
    name: title,
  }
}

/**
 * Render a single campaign's content into a body element:
 *   - H1: campaign name (always - the doc title shows in Drive but the
 *     body needs its own header so the doc is self-contained)
 *   - header segments (metadata: brand, date, tier)
 *   - long-form script (with H3 bracket-tag sub-headings)
 *   - each non-long-form asset as an H2 section
 */
function renderCampaignContent(body, camp, fontFamily) {
  // Always start with the campaign H1 - matches the doc title and gives
  // the body a clear top-of-page header.
  var h = body.appendParagraph(camp.name || 'Campaign')
  h.setHeading(DocumentApp.ParagraphHeading.HEADING1)
  if (fontFamily) {
    try { h.editAsText().setFontFamily(fontFamily) } catch (e) { /* non-fatal */ }
  }

  renderSegments(body, camp.headerSegments || [], fontFamily)
  renderSegments(body, camp.longFormSegments || [], fontFamily)

  var childTabs = Array.isArray(camp.childTabs) ? camp.childTabs : []
  for (var k = 0; k < childTabs.length; k++) {
    var sub = childTabs[k] || {}
    var h2 = body.appendParagraph(sub.name || 'Asset')
    h2.setHeading(DocumentApp.ParagraphHeading.HEADING2)
    if (fontFamily) {
      try { h2.editAsText().setFontFamily(fontFamily) } catch (e) { /* non-fatal */ }
    }
    renderSegments(body, sub.segments || [], fontFamily)
  }
}

/**
 * Append a sequence of segments as paragraphs in the given body. Each
 * segment = one paragraph. Bold state is explicitly set every iteration
 * to prevent cursor-state inheritance from bleeding bold across plain
 * paragraphs. Headings inherit their bold from the named style.
 */
function renderSegments(body, segments, fontFamily) {
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i] || {}
    var text = seg.text == null ? '' : String(seg.text)
    text = text.replace(/\n+$/, '')

    var para = body.appendParagraph(text)

    switch (seg.style) {
      case 'h1':
        para.setHeading(DocumentApp.ParagraphHeading.HEADING1)
        break
      case 'h2':
        para.setHeading(DocumentApp.ParagraphHeading.HEADING2)
        break
      case 'h3':
        para.setHeading(DocumentApp.ParagraphHeading.HEADING3)
        break
      default:
        para.setHeading(DocumentApp.ParagraphHeading.NORMAL)
        break
    }

    // Explicitly set bold per paragraph - prevents cursor-state
    // inheritance from the previous paragraph carrying bold forward.
    // Headings get their visual weight from the named style so we
    // don't override them.
    if (text.length > 0 && seg.style !== 'h1' && seg.style !== 'h2' && seg.style !== 'h3') {
      try {
        para.editAsText().setBold(seg.style === 'bold')
      } catch (boldErr) {
        // Non-fatal.
      }
    }

    if (text.length > 0 && fontFamily) {
      try {
        para.editAsText().setFontFamily(fontFamily)
      } catch (fontErr) {
        // Non-fatal.
      }
    }
  }
}

function doGet() {
  return jsonResponse({
    ok: true,
    info: 'Fokus Kreativez doc export webhook (v5 - one doc per campaign). POST JSON with secret + campaigns.',
  })
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON)
}

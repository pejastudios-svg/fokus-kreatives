import { createClient } from '@/lib/supabase/client'

// Upload a file straight from the browser to Supabase Storage using a signed
// upload URL, so large files (videos/reels) aren't capped by the serverless
// function request-body limit. Returns the file's public URL.
export async function uploadFileDirect(file: File, folder: string): Promise<string> {
  const res = await fetch('/api/upload/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, name: file.name }),
  })
  const data = await res.json()
  if (!data?.success) throw new Error(data?.error || 'Could not start upload')

  const supabase = createClient()
  const { error } = await supabase.storage.from('uploads').uploadToSignedUrl(data.path, data.token, file)
  if (error) throw error
  return data.publicUrl as string
}

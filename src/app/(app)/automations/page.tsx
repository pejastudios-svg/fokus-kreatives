'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Plus, Zap, MessageCircle, Copy, Trash2, X, Check, Sparkles, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface Client {
  id: string
  name: string
  business_name: string
  industry: string
  target_audience: string
}

interface MessageTemplate {
  id: string
  client_id: string
  keyword: string
  message: string
  created_at: string
}

export default function AutomationsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [showModal, setShowModal] = useState(false)
  const [newKeyword, setNewKeyword] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedMessages, setGeneratedMessages] = useState<string[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    fetchClients()
  }, [])

  useEffect(() => {
    if (selectedClientId) {
      const client = clients.find(c => c.id === selectedClientId)
      setSelectedClient(client || null)
      fetchTemplates()
    }
  }, [selectedClientId, clients])

  const fetchClients = async () => {
    const { data } = await supabase.from('clients').select('id, name, business_name, industry, target_audience').order('name')
    if (data) setClients(data)
  }

  const fetchTemplates = async () => {
    const { data } = await supabase
      .from('automations')
      .select('*')
      .eq('client_id', selectedClientId)
    if (data) {
      setTemplates(data.map(t => ({
        id: t.id,
        client_id: t.client_id,
        keyword: t.keyword,
        message: t.response_content,
        created_at: t.created_at
      })))
    }
  }

  const generateMessages = async () => {
    if (!selectedClient || !newKeyword) return

    setIsGenerating(true)
    setGeneratedMessages([])

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientInfo: `Business: ${selectedClient.business_name}, Industry: ${selectedClient.industry}, Target: ${selectedClient.target_audience}`,
          contentType: 'DM Message Templates',
          contentPillar: 'Authority',
          idea: `Create 5 different DM response templates for when someone comments "${newKeyword}" on a post. 
          
Each message should:
- Be friendly and personal (not robotic)
- Deliver value immediately
- Include a soft next step
- Be under 200 characters for easy mobile reading
- NOT say "Hi there!" or "Hello!" - jump straight to value

Format as:
MESSAGE 1:
[message]

MESSAGE 2:
[message]

etc.`,
          quantity: 1,
        }),
      })

      const data = await response.json()
      
      if (data.success && data.content) {
        // Parse the messages from the response
        const messages = data.content
          .split(/MESSAGE \d+:/i)
          .filter((m: string) => m.trim())
          .map((m: string) => m.trim())
        
        setGeneratedMessages(messages.slice(0, 5))
      }
    } catch (error) {
      console.error('Failed to generate:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const saveTemplate = async (message: string) => {
    await supabase.from('automations').insert({
      client_id: selectedClientId,
      keyword: newKeyword.toUpperCase(),
      response_content: message,
      trigger_type: 'comment_contains',
      response_type: 'text',
      active: true,
    })

    fetchTemplates()
    setShowModal(false)
    setNewKeyword('')
    setGeneratedMessages([])
  }

  const handleCopy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleDelete = async (id: string) => {
    await supabase.from('automations').delete().eq('id', id)
    fetchTemplates()
  }

  return (
    <>
      <Header 
        title="Message Suggestions" 
        subtitle="AI-generated DM templates for your content"
      />
      <div className="p-8">
        {/* Client Selection */}
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="w-80">
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent"
                >
                  <option value="">Select a client...</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} - {client.business_name}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={() => setShowModal(true)} disabled={!selectedClientId}>
                <Plus className="h-5 w-5 mr-2" />
                Generate New Templates
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Saved Templates */}
        {selectedClientId && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Saved Templates</h3>
            
            {templates.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <MessageCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No templates yet. Generate some!</p>
                </CardContent>
              </Card>
            ) : (
              templates.map((template) => (
                <Card key={template.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-3 py-1 bg-[#E8F1FF] text-[#2B79F7] rounded-full text-sm font-medium">
                            {template.keyword}
                          </span>
                        </div>
                        <p className="text-gray-700">{template.message}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(template.id, template.message)}
                        >
                          {copiedId === template.id ? (
                            <>
                              <Check className="h-4 w-4 mr-1" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4 mr-1" />
                              Copy
                            </>
                          )}
                        </Button>
                        <button
                          onClick={() => handleDelete(template.id)}
                          className="p-2 rounded-lg bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        {/* How To Use */}
        <Card className="mt-8">
          <CardHeader>
            <h3 className="text-lg font-semibold text-gray-900">How To Use</h3>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-6">
              <div className="text-center">
                <div className="h-10 w-10 rounded-full bg-[#E8F1FF] flex items-center justify-center mx-auto mb-3">
                  <span className="text-[#2B79F7] font-bold">1</span>
                </div>
                <p className="text-sm text-gray-600">Add a CTA to your content: "Comment GUIDE for the free PDF"</p>
              </div>
              <div className="text-center">
                <div className="h-10 w-10 rounded-full bg-[#E8F1FF] flex items-center justify-center mx-auto mb-3">
                  <span className="text-[#2B79F7] font-bold">2</span>
                </div>
                <p className="text-sm text-gray-600">Generate AI message templates for that keyword</p>
              </div>
              <div className="text-center">
                <div className="h-10 w-10 rounded-full bg-[#E8F1FF] flex items-center justify-center mx-auto mb-3">
                  <span className="text-[#2B79F7] font-bold">3</span>
                </div>
                <p className="text-sm text-gray-600">Copy and paste to respond to comments quickly</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Generate Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-lg">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Generate Message Templates</h3>
                  <button onClick={() => { setShowModal(false); setGeneratedMessages([]); setNewKeyword('') }} className="p-1 hover:bg-gray-100 rounded">
                    <X className="h-5 w-5 text-gray-400" />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <Input
                    label="Trigger Keyword"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value.toUpperCase())}
                    placeholder="GUIDE, TIPS, FREE, etc."
                  />
                  
                  {!generatedMessages.length && (
                    <Button 
                      onClick={generateMessages} 
                      isLoading={isGenerating}
                      disabled={!newKeyword}
                      className="w-full"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate 5 Message Options
                    </Button>
                  )}

                  {isGenerating && (
                    <div className="text-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin text-[#2B79F7] mx-auto mb-2" />
                      <p className="text-gray-500">Generating personalized messages...</p>
                    </div>
                  )}

                  {generatedMessages.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-gray-700">Choose a template to save:</p>
                      {generatedMessages.map((msg, idx) => (
                        <div 
                          key={idx}
                          className="p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-[#2B79F7] cursor-pointer transition-colors"
                          onClick={() => saveTemplate(msg)}
                        >
                          <p className="text-sm text-gray-700">{msg}</p>
                          <p className="text-xs text-[#2B79F7] mt-2">Click to save this template</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <Button variant="outline" onClick={() => { setShowModal(false); setGeneratedMessages([]); setNewKeyword('') }}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </>
  )
}
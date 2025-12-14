'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Sparkles, FileText, Film, LayoutGrid, MessageCircle, Zap, Copy, Check, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface Client {
  id: string
  name: string
  business_name: string
  industry: string
  target_audience: string
  brand_doc_text: string
  dos_and_donts: string
  topics_library: string
  key_stories: string
  unique_mechanisms: string
  social_proof: string
  competitor_insights: string
}

const contentTypes = [
  { id: 'longform', name: 'Long-form Script', icon: FileText, description: '10-12 min videos' },
  { id: 'shortform', name: 'Short-form Script', icon: Film, description: '30-60 sec videos' },
  { id: 'carousel', name: 'Carousel', icon: LayoutGrid, description: '10-slide posts' },
  { id: 'story', name: 'Story Post', icon: MessageCircle, description: '3-part stories' },
  { id: 'engagement', name: 'Engagement Reel', icon: Zap, description: 'Viral reels' },
]

const contentPillars = [
  { id: 'educational', name: 'Educational', description: 'Tips, tutorials, mistakes' },
  { id: 'storytelling', name: 'Storytelling', description: 'Journey, challenges, wins' },
  { id: 'authority', name: 'Authority', description: 'Case studies, transformations' },
  { id: 'series', name: 'Series', description: 'Multi-part content' },
  { id: 'doubledown', name: 'Double Down', description: 'Expand proven content' },
]

export function ContentCreationEngine() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [selectedType, setSelectedType] = useState('')
  const [selectedPillar, setSelectedPillar] = useState('')
  const [ideaInput, setIdeaInput] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetchClients()
    
    const storedClientId = sessionStorage.getItem('selectedClientId')
    if (storedClientId) {
      setSelectedClientId(storedClientId)
      sessionStorage.removeItem('selectedClientId')
    }
  }, [])

  useEffect(() => {
    if (selectedClientId) {
      const client = clients.find(c => c.id === selectedClientId)
      setSelectedClient(client || null)
    } else {
      setSelectedClient(null)
    }
  }, [selectedClientId, clients])

  const fetchClients = async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('name')

    if (data) {
      setClients(data)
      
      const storedClientId = sessionStorage.getItem('selectedClientId')
      if (storedClientId && data.find(c => c.id === storedClientId)) {
        setSelectedClientId(storedClientId)
        sessionStorage.removeItem('selectedClientId')
      }
    }
  }

  const buildClientContext = (client: Client) => {
    let context = ''

    if (client.name && client.business_name) {
      context += `CLIENT: ${client.name} from ${client.business_name}\n`
    }
    if (client.industry) {
      context += `INDUSTRY: ${client.industry}\n`
    }
    if (client.target_audience) {
      context += `TARGET AUDIENCE: ${client.target_audience}\n\n`
    }
    if (client.brand_doc_text) {
      context += `BRAND GUIDELINES:\n${client.brand_doc_text}\n\n`
    }
    if (client.dos_and_donts) {
      context += `CONTENT RULES (MUST FOLLOW):\n${client.dos_and_donts}\n\n`
    }
    if (client.topics_library) {
      context += `TOPICS TO COVER:\n${client.topics_library}\n\n`
    }
    if (client.key_stories) {
      context += `STORIES FOR INSPIRATION (do NOT copy word-for-word, use as reference only):\n${client.key_stories}\n\n`
    }
    if (client.unique_mechanisms) {
      context += `UNIQUE METHODS/FRAMEWORKS TO MENTION:\n${client.unique_mechanisms}\n\n`
    }
    if (client.social_proof) {
      context += `PROOF & RESULTS TO REFERENCE:\n${client.social_proof}\n\n`
    }
    if (client.competitor_insights) {
      context += `COMPETITOR INSIGHTS TO LEVERAGE:\n${client.competitor_insights}\n\n`
    }

    return context || 'General business helping clients succeed.'
  }

  const handleGenerate = async () => {
    if (!selectedClient) {
      setError('Please select a client first')
      return
    }

    if (!selectedType) {
      setError('Please select a content type')
      return
    }

    if (!selectedPillar) {
      setError('Please select a content pillar')
      return
    }

    setIsGenerating(true)
    setError('')
    setGeneratedContent('')

    try {
      const clientContext = buildClientContext(selectedClient)
      
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientInfo: clientContext,
          contentType: contentTypes.find(t => t.id === selectedType)?.name || selectedType,
          contentPillar: contentPillars.find(p => p.id === selectedPillar)?.name || selectedPillar,
          idea: ideaInput,
          quantity: quantity,
          competitorInsights: selectedClient.competitor_insights || '',
        }),
      })

      const data = await response.json()

      if (data.success) {
        setGeneratedContent(data.content)
        
        await supabase.from('content').insert({
          client_id: selectedClient.id,
          content_type: selectedType,
          content_pillar: selectedPillar,
          script: data.content,
          idea_input: ideaInput,
        })
      } else {
        setError(data.error || 'Failed to generate content')
      }
    } catch (err) {
      console.error('Generation error:', err)
      setError('Failed to connect to AI service. Check your API key in .env.local')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Client Selection */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Select Client</h3>
        </CardHeader>
        <CardContent>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent"
          >
            <option value="">Choose a client...</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} - {client.business_name}
              </option>
            ))}
          </select>
          
          {selectedClient && (
            <div className="mt-4 p-4 bg-[#E8F1FF] rounded-lg">
              <p className="text-sm text-[#2B79F7]">
                <strong>Industry:</strong> {selectedClient.industry || 'Not set'} | 
                <strong> Target:</strong> {selectedClient.target_audience?.slice(0, 50) || 'Not set'}...
              </p>
              {selectedClient.brand_doc_text && (
                <p className="text-xs text-[#2B79F7]/70 mt-1">Brand doc loaded ({selectedClient.brand_doc_text.length} characters)</p>
              )}
            </div>
          )}
          
          {clients.length === 0 && (
            <p className="mt-2 text-sm text-gray-500">
              No clients found. <a href="/clients/new" className="text-[#2B79F7] hover:underline">Add a client</a> first.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Content Type */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Content Type</h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {contentTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelectedType(type.id)}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-200 ${
                  selectedType === type.id
                    ? 'border-[#2B79F7] bg-[#E8F1FF] text-[#2B79F7]'
                    : 'border-gray-200 hover:border-[#5A9AFF] text-gray-600'
                }`}
              >
                <type.icon className="h-6 w-6" />
                <span className="text-sm font-medium text-center">{type.name}</span>
                <span className="text-xs text-gray-400">{type.description}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Content Pillar */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Content Pillar</h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {contentPillars.map((pillar) => (
              <button
                key={pillar.id}
                onClick={() => setSelectedPillar(pillar.id)}
                className={`flex flex-col items-start p-4 rounded-lg border-2 transition-all duration-200 ${
                  selectedPillar === pillar.id
                    ? 'border-[#2B79F7] bg-[#E8F1FF]'
                    : 'border-gray-200 hover:border-[#5A9AFF]'
                }`}
              >
                <span className={`text-sm font-semibold ${
                  selectedPillar === pillar.id ? 'text-[#2B79F7]' : 'text-gray-900'
                }`}>
                  {pillar.name}
                </span>
                <span className="text-xs text-gray-500 mt-1">{pillar.description}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Specific Idea */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-gray-900">Specific Idea (Optional)</h3>
        </CardHeader>
        <CardContent>
          <textarea
            value={ideaInput}
            onChange={(e) => setIdeaInput(e.target.value)}
            placeholder="Type a specific topic, angle, or idea you want to create content about. Be specific for better results..."
            rows={4}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none"
          />
        </CardContent>
      </Card>

      {/* Quantity Slider */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Quantity</h3>
            <span className="text-2xl font-bold text-[#2B79F7]">{quantity}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <input
              type="range"
              min="1"
              max="50"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#2B79F7]"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>1</span>
              <span>10</span>
              <span>20</span>
              <span>30</span>
              <span>40</span>
              <span>50</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generate Button */}
      <div className="flex justify-center pt-4">
        <Button
          size="lg"
          onClick={handleGenerate}
          isLoading={isGenerating}
          disabled={!selectedClientId || !selectedType || !selectedPillar}
          className="px-12"
        >
          <Sparkles className="h-5 w-5 mr-2" />
          {isGenerating ? 'Generating...' : 'Generate Content'}
        </Button>
      </div>

      {/* Error Message */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <p className="text-red-600 text-center">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Generated Content */}
      {generatedContent && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Generated Content</h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
                Regenerate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy All
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none">
              <pre className="whitespace-pre-wrap bg-gray-50 p-6 rounded-lg text-sm text-gray-800 overflow-auto max-h-[800px] font-sans leading-relaxed">
                {generatedContent}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
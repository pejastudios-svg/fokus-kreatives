'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Search, Save, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/Loading' 

interface Client {
  id: string
  name: string
  business_name: string
  industry: string
}

export default function CompetitorsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [competitorHandle, setCompetitorHandle] = useState('')
  const [platform, setPlatform] = useState('instagram')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [analysis, setAnalysis] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  // Fix: Memoize supabase client to prevent infinite loop
  const supabase = useMemo(() => createClient(), [])
  const [transcript, setTranscript] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  // Fix: Wrap fetchClients in useCallback to include it in dependencies
  const fetchClients = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('clients')
        .select('id, name, business_name, industry')
        .order('name')
      if (data) setClients(data)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  // Fix: Added fetchClients to dependency array
  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  useEffect(() => {
    if (selectedClientId) {
      const client = clients.find(c => c.id === selectedClientId)
      setSelectedClient(client || null)
    }
  }, [selectedClientId, clients])

  const handleAnalyze = async () => {
    if (!selectedClient || !competitorHandle) return

    setIsAnalyzing(true)
    setAnalysis('')
    setSaved(false)
    setError('')

    try {
      const response = await fetch('/api/analyze-competitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
          competitorHandle,
          platform,
          clientNiche: selectedClient.industry || selectedClient.business_name,
          videoTranscript: transcript || null,
        }),
      })

      const data = await response.json()
      
      if (data.success) {
        setAnalysis(data.analysis)
      } else {
        setError(data.error || 'Failed to analyze. Please try again.')
      }
    } catch (err) {
      console.error('Analysis error:', err)
      setError('Failed to connect to AI service. Check your GROQ_API_KEY in .env.local')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleSaveToClient = async () => {
    if (!selectedClientId || !analysis) return

    setIsSaving(true)

    try {
      // Save competitor record
      await supabase.from('competitors').insert({
        client_id: selectedClientId,
        platform,
        url: competitorHandle,
        analysis: { raw: analysis, analyzed_at: new Date().toISOString() },
      })

      // Get current competitor_insights
      const { data: clientData } = await supabase
        .from('clients')
        .select('competitor_insights')
        .eq('id', selectedClientId)
        .single()

      const existingInsights = clientData?.competitor_insights || ''
      const newInsights = `\n\n--- ${competitorHandle} (${platform}) - ${new Date().toLocaleDateString()} ---\n${analysis}`

      // Save to competitor_insights field
      await supabase
        .from('clients')
        .update({ 
          competitor_insights: existingInsights + newInsights 
        })
        .eq('id', selectedClientId)

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Save error:', err)
      setError('Failed to save insights')
    } finally {
      setIsSaving(false)
    }
  }

function CompetitorSkeleton() {
  return (
    <Card className="mb-6 animate-in fade-in">
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        <div className="space-y-2">
           <Skeleton className="h-4 w-64" />
           <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-10 w-48" />
      </CardContent>
    </Card>
  )
}

  return (
    <>
      <Header 
        title="Competitor Research" 
        subtitle="Analyze competitors and steal their best strategies"
      />
      <div className="p-8">
        {/* Error Message */}
        {error && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="py-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <p className="text-red-700">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Input Section */}
        {isLoading ? (
          <CompetitorSkeleton />
        ) : (
        <Card className="mb-6">
          <CardHeader>
            <h3 className="text-lg font-semibold text-gray-900">Analyze Competitor</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Client
                </label>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent"
                >
                  <option value="">Choose client...</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} - {client.business_name}
                    </option>
                  ))}
                </select>
              </div>
              {/* NEW: Transcript / Sample Content */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Transcript / Sample Content (optional)
              </label>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={5}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 text-sm"
                placeholder="Paste the transcript of a high-performing video or example posts here..."
              />
              <p className="mt-1 text-xs text-gray-400">
                This will be analyzed as the primary source and used as inspiration (never copied) for new ideas.
              </p>
            </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Platform
                </label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent"
                >
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="youtube">YouTube</option>
                  <option value="linkedin">LinkedIn</option>
                </select>
              </div>
              <Input
                label="Competitor Handle/URL"
                value={competitorHandle}
                onChange={(e) => setCompetitorHandle(e.target.value)}
                placeholder="@competitor or full URL"
              />
            </div>
            <div className="flex gap-3">
              <Button 
                onClick={handleAnalyze} 
                isLoading={isAnalyzing}
                disabled={!selectedClientId || !competitorHandle}
              >
                <Search className="h-5 w-5 mr-2" />
                Analyze Competitor
              </Button>
              {analysis && (
                <Button 
                  variant="outline" 
                  onClick={handleSaveToClient}
                  isLoading={isSaving}
                >
                  {saved ? (
                    <>
                      <CheckCircle className="h-5 w-5 mr-2" />
                      Saved!
                    </>
                  ) : (
                    <>
                      <Save className="h-5 w-5 mr-2" />
                      Save to Client Profile
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        )}

        {/* Loading State */}
        {isAnalyzing && (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#2B79F7] mx-auto mb-4" />
              <p className="text-gray-600">Analyzing competitor strategies...</p>
              <p className="text-sm text-gray-400 mt-2">This may take 30-60 seconds</p>
            </CardContent>
          </Card>
        )}

        {/* Analysis Results */}
        {analysis && !isAnalyzing && (
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">
                Competitor Analysis: {competitorHandle}
              </h3>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap bg-gray-50 p-6 rounded-lg text-sm text-gray-800 leading-relaxed font-sans overflow-auto max-h-[600px]">
                  {analysis}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}

        {/* How It Works */}
        {!analysis && !isAnalyzing && (
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">How This Works</h3>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="h-12 w-12 rounded-full bg-[#E8F1FF] flex items-center justify-center mx-auto mb-3">
                    <span className="text-[#2B79F7] font-bold">1</span>
                  </div>
                  <h4 className="font-medium text-gray-900">Enter Competitor</h4>
                  <p className="text-sm text-gray-500 mt-1">Add their handle and select the platform</p>
                </div>
                <div className="text-center">
                  <div className="h-12 w-12 rounded-full bg-[#E8F1FF] flex items-center justify-center mx-auto mb-3">
                    <span className="text-[#2B79F7] font-bold">2</span>
                  </div>
                  <h4 className="font-medium text-gray-900">AI Analyzes</h4>
                  <p className="text-sm text-gray-500 mt-1">Get insights on hooks, CTAs, content gaps</p>
                </div>
                <div className="text-center">
                  <div className="h-12 w-12 rounded-full bg-[#E8F1FF] flex items-center justify-center mx-auto mb-3">
                    <span className="text-[#2B79F7] font-bold">3</span>
                  </div>
                  <h4 className="font-medium text-gray-900">Save & Use</h4>
                  <p className="text-sm text-gray-500 mt-1">Insights are used when generating content</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
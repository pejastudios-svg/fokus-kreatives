'use client'

import { useState } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Plus, Upload, MessageSquare, X } from 'lucide-react'

export default function PortalTestimonials() {
  const [showModal, setShowModal] = useState(false)
  const [testimonials, setTestimonials] = useState([
    { id: '1', type: 'written', text: 'Working with them has been incredible. My revenue doubled in 3 months!', amount: 15000, date: '2024-01-10' },
    { id: '2', type: 'written', text: 'Best content agency I have ever worked with. Highly recommend!', amount: 8000, date: '2024-01-05' },
  ])

  return (
    <PortalLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Testimonials</h1>
            <p className="text-gray-500 mt-1">Upload client wins and testimonials</p>
          </div>
          <Button onClick={() => setShowModal(true)}>
            <Plus className="h-5 w-5 mr-2" />
            Add Testimonial
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {testimonials.map((testimonial) => (
            <Card key={testimonial.id}>
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-[#E8F1FF]">
                    <MessageSquare className="h-6 w-6 text-[#2B79F7]" />
                  </div>
                  <div className="flex-1">
                    <p className="text-gray-700 italic">"{testimonial.text}"</p>
                    {testimonial.amount && (
                      <p className="mt-3 text-green-600 font-semibold">
                        Result: ${testimonial.amount.toLocaleString()}
                      </p>
                    )}
                    <p className="mt-2 text-sm text-gray-400">{testimonial.date}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Upload Area */}
        <Card className="mt-8">
          <CardContent className="p-8">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-[#2B79F7] transition-colors">
              <Upload className="h-10 w-10 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-2">Upload screenshot or video testimonial</p>
              <p className="text-sm text-gray-400">PNG, JPG, MP4 up to 50MB</p>
              <Button variant="outline" size="sm" className="mt-4">
                Choose File
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Add Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Add Testimonial</h3>
                  <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded">
                    <X className="h-5 w-5 text-gray-400" />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Testimonial Text</label>
                    <textarea
                      placeholder="What did your client say?"
                      rows={4}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Result Amount ($)</label>
                    <input
                      type="number"
                      placeholder="10000"
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                  <Button onClick={() => setShowModal(false)}>Save</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </PortalLayout>
  )
}
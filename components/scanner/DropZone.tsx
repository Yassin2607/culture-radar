'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_MB, MAX_FILES } from '@/lib/constants'
import type { ProcessableFile } from '@/types/scanner'
import { v4 as uuidv4 } from 'uuid'

interface Props {
  onFilesSelected: (files: ProcessableFile[]) => void
  disabled?: boolean
}

async function getAllFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise<File[]>((resolve) => {
      ;(entry as FileSystemFileEntry).file((f) => resolve([f]))
    })
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const allEntries: FileSystemEntry[] = []
    await new Promise<void>((resolve) => {
      const readBatch = () => {
        reader.readEntries((entries) => {
          if (entries.length === 0) { resolve() } else { allEntries.push(...entries); readBatch() }
        })
      }
      readBatch()
    })
    const nested = await Promise.all(allEntries.map(getAllFilesFromEntry))
    return nested.flat()
  }
  return []
}

export default function DropZone({ onFilesSelected, disabled }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [fileCount, setFileCount] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '')
    }
  }, [])

  const processFiles = useCallback(async (rawFiles: File[]) => {
    setIsProcessing(true)
    setErrors([])

    const validFiles: File[] = []
    const newErrors: string[] = []

    // Strip macOS/OS system files before validation (e.g. .DS_Store, Thumbs.db)
    const filteredFiles = rawFiles.filter((f) => !f.name.startsWith('.') && f.name !== 'Thumbs.db')

    for (const file of filteredFiles) {
      if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
        newErrors.push(`${file.name}: unsupported format`)
        continue
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        newErrors.push(`${file.name}: exceeds ${MAX_FILE_SIZE_MB}MB limit`)
        continue
      }
      validFiles.push(file)
    }

    if (validFiles.length > MAX_FILES) {
      newErrors.push(`Only the first ${MAX_FILES} images will be processed (${validFiles.length} selected)`)
      validFiles.splice(MAX_FILES)
    }

    if (newErrors.length) setErrors(newErrors)

    // Build ProcessableFile objects — store raw File, skip eager base64 conversion
    const processable: ProcessableFile[] = validFiles.map((file) => ({
      id: uuidv4(),
      filename: file.name,
      mimeType: file.type,
      base64: '',
      objectUrl: URL.createObjectURL(file),
      sizeBytes: file.size,
      file,
    }))

    revokeUrls(prevFilesRef.current)
    prevFilesRef.current = processable
    setFileCount(processable.length)
    setIsProcessing(false)
    onFilesSelected(processable)
  }, [onFilesSelected])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (disabled) return

      const items = Array.from(e.dataTransfer.items)
      const entries = items.map((item) => item.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[]
      const hasDirectory = entries.some((en) => en.isDirectory)

      if (hasDirectory) {
        setIsProcessing(true)
        const allFiles = await Promise.all(entries.map(getAllFilesFromEntry))
        processFiles(allFiles.flat())
      } else {
        processFiles(Array.from(e.dataTransfer.files))
      }
    },
    [disabled, processFiles]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return
      processFiles(Array.from(e.target.files))
    },
    [processFiles]
  )

  const prevFilesRef = useRef<ProcessableFile[]>([])

  // Revoke old ObjectURLs when files change or component unmounts
  const revokeUrls = useCallback((files: ProcessableFile[]) => {
    for (const f of files) {
      if (f.objectUrl) URL.revokeObjectURL(f.objectUrl)
    }
  }, [])

  useEffect(() => {
    return () => revokeUrls(prevFilesRef.current)
  }, [revokeUrls])

  const handleClear = useCallback(() => {
    revokeUrls(prevFilesRef.current)
    prevFilesRef.current = []
    setFileCount(0)
    setErrors([])
    onFilesSelected([])
    if (inputRef.current) inputRef.current.value = ''
    if (folderInputRef.current) folderInputRef.current.value = ''
  }, [onFilesSelected, revokeUrls])

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && !isProcessing && inputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all
          ${isDragging ? 'border-action-red bg-red-50 scale-[1.01]' : 'border-gray-300 hover:border-gray-400 bg-white'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        style={isDragging ? { borderColor: 'var(--action-red)', backgroundColor: '#fff5f5' } : {}}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_MIME_TYPES.join(',')}
          className="hidden"
          onChange={handleChange}
          disabled={disabled}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          accept={ACCEPTED_MIME_TYPES.join(',')}
          className="hidden"
          onChange={handleChange}
          disabled={disabled}
        />

        {isProcessing ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
            <p className="text-gray-600 font-medium">Processing images...</p>
          </div>
        ) : fileCount > 0 ? (
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ backgroundColor: '#f0fdf4' }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-lg">{fileCount} image{fileCount !== 1 ? 's' : ''} ready</p>
              <p className="text-gray-500 text-sm">Click or drag to replace</p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleClear() }}
              className="text-sm text-red-600 hover:text-red-700 font-medium underline"
            >
              Clear all
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-lg">Drop images or folders here</p>
              <p className="text-gray-500 text-sm">or choose below</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
                className="text-sm font-medium text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 hover:border-gray-400 hover:bg-gray-50 transition-colors"
              >
                Select files
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click() }}
                className="text-sm font-medium text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 hover:border-gray-400 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                Select folder
              </button>
            </div>
            <p className="text-xs text-gray-400">
              JPEG, PNG, WEBP, AVIF, GIF &bull; Max {MAX_FILE_SIZE_MB}MB each &bull; Up to {MAX_FILES} images
            </p>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3">
          <p className="text-sm font-medium text-red-800 mb-1">Some files were skipped:</p>
          <ul className="text-xs text-red-700 space-y-0.5 max-h-24 overflow-y-auto">
            {errors.map((err, i) => <li key={i}>• {err}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

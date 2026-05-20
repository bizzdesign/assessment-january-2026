import { useState, useCallback, DragEvent } from 'react'
import './App.css'

interface FileEntry {
  name: string
  size: number
  sourceFile: string
  fileType: 'json' | 'csv'
  status: 'uploading' | 'ready' | 'error'
  uploadError?: string
  config?: unknown
  executing?: boolean
  result?: unknown
  executeError?: string
}

const ACCEPTED = ['.json', '.csv', 'application/json', 'text/csv']

function isAccepted(file: File) {
  return (
    file.type === 'application/json' ||
    file.type === 'text/csv' ||
    file.name.endsWith('.json') ||
    file.name.endsWith('.csv')
  )
}

function resolveFileType(file: File): 'json' | 'csv' {
  return file.name.endsWith('.json') || file.type === 'application/json' ? 'json' : 'csv'
}

function App() {
  const [dragging, setDragging] = useState(false)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [dropError, setDropError] = useState<string | null>(null)

  const updateEntry = useCallback((name: string, patch: Partial<FileEntry>) => {
    setFiles((prev) => prev.map((e) => (e.name === name ? { ...e, ...patch } : e)))
  }, [])

  const handleFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming) return

      const valid: File[] = []
      const invalid: string[] = []

      Array.from(incoming).forEach((f) => {
        if (isAccepted(f)) valid.push(f)
        else invalid.push(f.name)
      })

      setDropError(invalid.length ? `Rejected (not JSON or CSV): ${invalid.join(', ')}` : null)

      valid.forEach(async (f) => {
        const sourceFile = await f.text()
        const fileType = resolveFileType(f)

        const entry: FileEntry = {
          name: f.name,
          size: f.size,
          sourceFile,
          fileType,
          status: 'uploading',
        }

        setFiles((prev) => [...prev, entry])

        try {
          const res = await fetch('http://localhost:3000/generate/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceFile, fileType }),
          })
          if (!res.ok) throw new Error(`Server responded ${res.status}`)
          const config = await res.json()
          updateEntry(f.name, { status: 'ready', config })
        } catch (err) {
          updateEntry(f.name, { status: 'error', uploadError: (err as Error).message })
        }
      })
    },
    [updateEntry]
  )

  const execute = useCallback(
    async (entry: FileEntry) => {
      updateEntry(entry.name, { executing: true, result: undefined, executeError: undefined })
      try {
        const res = await fetch('http://localhost:3000/execute/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: entry.config, sourceFile: entry.sourceFile }),
        })
        if (!res.ok) throw new Error(`Server responded ${res.status}`)
        const result = await res.json()
        updateEntry(entry.name, { executing: false, result })
      } catch (err) {
        updateEntry(entry.name, { executing: false, executeError: (err as Error).message })
      }
    },
    [updateEntry]
  )

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragging(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  return (
    <div className="page">
      <h1>File Drop</h1>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p>Drop JSON or CSV files here</p>
        <label className="browse">
          Browse
          <input
            type="file"
            accept={ACCEPTED.join(',')}
            multiple
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      </div>

      {dropError && <p className="error">{dropError}</p>}

      {files.map((f, i) => (
        <div key={i} className="file-card">
          <div className="file-header">
            <span className="file-name">{f.name}</span>
            <span className={`file-status status-${f.status}`}>
              {f.status === 'uploading' && 'generating config...'}
              {f.status === 'ready' && 'config ready'}
              {f.status === 'error' && (f.uploadError ?? 'error')}
            </span>
          </div>

          {f.config && (
            <>
              <pre className="json-block">{JSON.stringify(f.config, null, 2)}</pre>
              <button
                className="execute-btn"
                disabled={f.executing}
                onClick={() => execute(f)}
              >
                {f.executing ? 'Executing...' : 'Execute'}
              </button>
            </>
          )}

          {f.executeError && <p className="error">{f.executeError}</p>}

          {f.result && (
            <pre className="json-block result">{JSON.stringify(f.result, null, 2)}</pre>
          )}
        </div>
      ))}
    </div>
  )
}

export default App

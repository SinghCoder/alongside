import type { BinaryFileData, DataURL, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { FileId } from '@excalidraw/excalidraw/element/types'
import type { BoardScene } from './types'

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

// Register image bytes before playback so placing a photo never waits on the network.
export async function loadImages(api: ExcalidrawImperativeAPI, scene: BoardScene, signal: AbortSignal) {
  const files = await Promise.all(scene.filter(item => item.kind === 'image').map(async item => {
    const response = await fetch(item.src, { signal })
    if (!response.ok) { throw new Error('Could not load the reference photo. Reload to retry.') }
    const blob = await response.blob()
    if (!IMAGE_TYPES.has(blob.type)) { throw new Error('Unsupported reference image format.') }
    const dataURL = await new Promise<DataURL>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as DataURL)
      reader.onerror = () => reject(new Error('Could not read the reference photo.'))
      reader.readAsDataURL(blob)
    })
    return { id: item.id as FileId, dataURL, mimeType: blob.type as BinaryFileData['mimeType'], created: Date.now() }
  }))
  if (signal.aborted) { return }
  api.addFiles(files)
}

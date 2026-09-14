import { forwardRef, useImperativeHandle, useState } from 'react'
import { INK } from './sequence'
import { LETTER_FONT, DrawingTool, Part, Playback, type PenBoard, type PenFrame } from './types'

export type PenOverlayHandle = { show: (frame: PenFrame) => void }

const PenOverlay = forwardRef<PenOverlayHandle, { board: Pick<PenBoard, 'screen' | 'ink'> }>(function PenOverlay({ board }, ref) {
  const [frame, setFrame] = useState<PenFrame>({ state: Playback.Ready, blocked: false, part: Part.Box, strokes: [], pen: null })
  useImperativeHandle(ref, () => ({ show: setFrame }), [])
  const ink = board.ink()
  const pen = frame.pen ? board.screen(frame.pen) : null
  return <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-hidden" aria-label="Partner drawing" data-state={frame.state}>
    {frame.images?.map(item => {
      const start = board.screen(item)
      const end = board.screen({ x: item.x + item.width, y: item.y + item.height })
      return <image key={item.id} data-testid="partner-image" href={item.src} x={start.x} y={start.y}
        width={end.x - start.x} height={end.y - start.y} opacity={item.opacity} preserveAspectRatio="none" />
    })}
    {frame.fills?.map((fill,index) => <polygon key={index} data-testid="partner-fill"
      points={fill.points.map(point=>{const p=board.screen(point);return `${p.x},${p.y}`}).join(' ')} fill={fill.color} />)}
    {frame.strokes.map((stroke, index) => <polyline key={index}
      points={stroke.map((point) => { const p = board.screen(point); return `${p.x},${p.y}` }).join(' ')}
      fill="none" stroke={ink.color} strokeWidth={ink.width} strokeLinecap="round" strokeLinejoin="round" />)}
    {frame.erasures?.map((area, index) => {
      const start = board.screen(area)
      const end = board.screen({ x: area.x + area.width, y: area.y + area.height })
      return <rect key={index} data-testid="partner-wipe" x={start.x} y={start.y}
        width={end.x - start.x} height={end.y - start.y} fill={area.color} />
    })}
    {frame.lettering?.map((line, index) => {
      const origin = board.screen(line)
      const size = board.screen({ x: line.x + line.size, y: line.y }).x - origin.x
      return <text key={index} data-testid="partner-lettering" x={origin.x} y={board.screen({ x: line.x, y: line.y + (line.baseline ?? line.size) }).y}
        dominantBaseline="alphabetic" fontFamily={LETTER_FONT} fontSize={size} fill={line.color}>{line.text}</text>
    })}
    {pen && <g transform={`translate(${pen.x} ${pen.y})`} data-testid="partner-pen" opacity={frame.penOpacity ?? 1}>
      <circle r="10" fill={INK} opacity=".09" />
      {frame.tool === DrawingTool.Eraser ? <g data-testid="partner-eraser" transform="rotate(-15)">
        <rect x="-15" y="-12" width="30" height="24" rx="4" fill="#d8b786" stroke="#6b5840" />
        <rect x="-15" y="4" width="30" height="8" rx="2" fill="#485b50" />
      </g> : <g transform="rotate(35)">
        <path d="M0 0L-4 -10V-42Q0 -47 4 -42V-10Z" fill="#f8faf7" stroke={INK} strokeWidth="1.5" />
        <path d="M-4 -10H4L0 0Z" fill={INK} />
        <path d="M-4 -34H4" stroke={INK} strokeWidth="2" />
      </g>}
      <g transform="translate(16 -40)">
        <rect width="76" height="24" rx="12" fill={INK} />
        <text x="38" y="16" textAnchor="middle" fill="white" fontSize="11" fontFamily="system-ui">{frame.state === Playback.Paused ? 'Paused' : frame.tool === DrawingTool.Eraser ? 'Erasing' : 'Alongside'}</text>
      </g>
    </g>}
  </svg>
})

export default PenOverlay

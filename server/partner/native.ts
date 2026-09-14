// Direction belongs to line points; element bounds remain nonnegative.
export function normalizeNative(value: unknown): unknown {
  if (!value || typeof value !== 'object') { return value }
  const item = value as Record<string, any>
  if (item.kind !== 'native' || !['arrow', 'line'].includes(item.element?.type)) { return value }
  if (!(item.width < 0 || item.height < 0)) { return value }
  const points = item.element.points
  if (!Array.isArray(points) || !points.length || !points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
    throw new Error('Directional lines need finite [x, y] points; widths and heights describe their bounds.')
  }
  const left = Math.min(...points.map(point => point[0]))
  const top = Math.min(...points.map(point => point[1]))
  const x = item.x + left, y = item.y + top
  const width = Math.max(...points.map(point => point[0])) - left
  const height = Math.max(...points.map(point => point[1])) - top
  return {...item,x,y,width,height,element:{...item.element,x,y,width,height,points:points.map(point => [point[0]-left,point[1]-top])}}
}

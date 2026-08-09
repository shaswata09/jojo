import { cn } from '@/lib/utils'
import { COLOR_MAP } from './textures'
import './transfer.css'

/**
 * What the scene degrades to when there is no WebGPU adapter.
 *
 * Deliberately the same *picture*, not a spinner and not an apology: the point
 * of the panel is the image, and the shader's contribution is motion. So this
 * shows the colour texture with a CSS approximation of the dot grid and the red
 * scan band, and loses only the depth parallax and the bloom.
 *
 * Also used as the Suspense fallback while the `three/webgpu` chunk downloads,
 * which means the layout never reflows when the real scene arrives.
 */
export function TransferFallback({ className }: { className?: string }) {
  return (
    <div className={cn('transfer-scope relative overflow-hidden', className)} aria-hidden>
      <img src={COLOR_MAP} alt="" className="transfer-fallback-img" />
      <span className="transfer-fallback-dots" />
      <span className="transfer-fallback-scan" />
    </div>
  )
}

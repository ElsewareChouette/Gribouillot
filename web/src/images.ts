/**
 * Decoded pictures, with a pyramid of reduced copies ("mipmaps") so that a
 * huge map stays smooth and sharp when zoomed out.
 */

export interface Mip {
  bitmap: ImageBitmap;
  scale: number; // bitmap width / original width
}

export class Picture {
  readonly w: number;
  readonly h: number;
  private mips: Mip[];
  private grayMips: Mip[] | null = null;
  private grayPending: Promise<void> | null = null;

  private constructor(base: ImageBitmap, mips: Mip[]) {
    this.w = base.width;
    this.h = base.height;
    this.mips = mips;
  }

  static async load(blob: Blob, withMips = true): Promise<Picture> {
    const base = await createImageBitmap(blob);
    const mips = withMips ? await buildMips(base) : [{ bitmap: base, scale: 1 }];
    return new Picture(base, mips);
  }

  /** The smallest copy with at least `scale` pixels per original pixel. */
  pick(scale: number, gray = false): Mip {
    const list = gray && this.grayMips ? this.grayMips : this.mips;
    let best = list[0];
    for (const m of list) if (m.scale >= scale * 0.999) best = m;
    return best;
  }

  get smallest(): Mip {
    return this.mips[this.mips.length - 1];
  }

  hasGray(): boolean {
    return this.grayMips !== null;
  }

  /** Compute the grayscale copies (luma coefficients of the desktop version). */
  ensureGray(): Promise<void> {
    if (this.grayMips) return Promise.resolve();
    if (!this.grayPending) {
      this.grayPending = (async () => {
        const base = await toGray(this.mips[0].bitmap);
        this.grayMips = await buildMips(base);
      })();
    }
    return this.grayPending;
  }

  close(): void {
    for (const m of [...this.mips, ...(this.grayMips ?? [])]) m.bitmap.close();
  }
}

async function buildMips(base: ImageBitmap): Promise<Mip[]> {
  const mips: Mip[] = [{ bitmap: base, scale: 1 }];
  let w = base.width, h = base.height, scale = 1;
  while (Math.max(w, h) > 1024) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    scale /= 2;
    try {
      const prev = mips[mips.length - 1].bitmap;
      const bitmap = await createImageBitmap(prev, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      mips.push({ bitmap, scale });
    } catch {
      break; // resize options unsupported: keep what we have
    }
  }
  return mips;
}

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function toGray(src: ImageBitmap): Promise<ImageBitmap> {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('canvas 2D indisponible');
  ctx.drawImage(src, 0, 0);
  // Process by horizontal bands to bound the memory used by getImageData.
  const band = Math.max(1, Math.floor(4_000_000 / src.width));
  for (let y = 0; y < src.height; y += band) {
    const h = Math.min(band, src.height - y);
    const img = ctx.getImageData(0, y, src.width, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    ctx.putImageData(img, 0, y);
    await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  return createImageBitmap(c);
}

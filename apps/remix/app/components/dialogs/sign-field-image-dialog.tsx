import { IMAGE_FIELD_MAX_DATA_URL_LENGTH } from '@documenso/lib/constants/signatures';
import { Button } from '@documenso/ui/primitives/button';
import { Checkbox } from '@documenso/ui/primitives/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@documenso/ui/primitives/dialog';
import { Label } from '@documenso/ui/primitives/label';
import { Slider } from '@documenso/ui/primitives/slider';
import { Trans, useLingui } from '@lingui/react/macro';
import { CameraIcon, ImageIcon, RotateCwIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createCallable } from 'react-call';

import { DocumentSigningDisclosure } from '../general/document-signing/document-signing-disclosure';

export type SignFieldImageDialogProps = {
  /**
   * What the sender asked for, such as "Company stamp".
   */
  label?: string;
};

/**
 * Asks the recipient for an image, such as their company stamp, to place in an image field.
 *
 * The recipient chooses a picture or takes a photo, then moves and zooms it under a circle (or a square, for square
 * stamps) and turns it if it was photographed sideways. The paper around the ink can be made clear, so the stamp sits
 * on the page as if it were stamped there. Gives a 600 px PNG.
 */
export const SignFieldImageDialog = createCallable<SignFieldImageDialogProps, string | null>(({ call, label }) => (
  <ImageFieldDialog label={label} onClose={(image) => call.end(image)} />
));

export type ImageFieldDialogProps = SignFieldImageDialogProps & {
  /**
   * Called with the image as a PNG data URL, or null when cancelled.
   */
  onClose: (image: string | null) => void;
};

/** The crop's size in the output, in pixels */
const OUT = 600;
/** The crop area, as a share of the view */
const CROP = 0.84;
/** Large photos are scaled down to this many pixels on their longer side before cropping */
const MAX_SOURCE = 2000;

type StampShape = 'circle' | 'square';
type Source = { bitmap: ImageBitmap | HTMLCanvasElement; width: number; height: number };
type View = { scale: number; x: number; y: number; turn: number };

/**
 * The dialog itself, for signing views that keep their own dialog state rather than calling `SignFieldImageDialog`.
 */
export const ImageFieldDialog = ({ label, onClose }: ImageFieldDialogProps) => {
  const { t } = useLingui();

  const [source, setSource] = useState<Source | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0, turn: 0 });
  const [fit, setFit] = useState(1);
  const [shape, setShape] = useState<StampShape>('circle');
  const [isClearBackground, setIsClearBackground] = useState(true);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState(300);

  const $box = useRef<HTMLDivElement>(null);
  const $canvas = useRef<HTMLCanvasElement>(null);
  const $preview = useRef<HTMLCanvasElement>(null);
  const $video = useRef<HTMLVideoElement>(null);
  const $fileInput = useRef<HTMLInputElement>(null);
  const $cameraInput = useRef<HTMLInputElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);

  // The view's width follows the space it has, up to 280 px.
  useEffect(() => {
    const el = $box.current;

    if (!el) {
      return;
    }

    const observer = new ResizeObserver(() => setSize(Math.min(280, Math.max(200, Math.floor(el.clientWidth)))));
    observer.observe(el);

    return () => observer.disconnect();
  }, [source]);

  const start = (s: Source) => {
    // The shorter side fills the crop to start with.
    const f = (size * CROP) / Math.min(s.width, s.height);

    setFit(f);
    setView({ scale: f, x: 0, y: 0, turn: 0 });
    setSource(s);
  };

  const openFile = async (file: File | undefined | null) => {
    setError(null);

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError(t`Please choose an image file.`);
      return;
    }

    try {
      start(await loadSource(file));
    } catch {
      setError(t`This image could not be read. Please choose another image.`);
    }
  };

  const takePhoto = async () => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      $cameraInput.current?.click();
      return;
    }

    try {
      setCamera(
        await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } },
          audio: false,
        }),
      );
    } catch {
      // No camera, or not allowed: the file picker, which on a phone offers its camera.
      $cameraInput.current?.click();
    }
  };

  const stopCamera = () => {
    camera?.getTracks().forEach((track) => track.stop());
    setCamera(null);
  };

  useEffect(() => {
    if (camera && $video.current) {
      $video.current.srcObject = camera;
      void $video.current.play().catch(() => undefined);
    }

    return () => camera?.getTracks().forEach((track) => track.stop());
  }, [camera]);

  const capture = () => {
    const video = $video.current;

    if (!video || !video.videoWidth) {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    stopCamera();
    start({ bitmap: canvas, width: canvas.width, height: canvas.height });
  };

  /** The stamp as it will be: the crop at `out` pixels, the paper made clear if asked. */
  const render = (out: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;

    const ctx = canvas.getContext('2d');

    if (!ctx || !source) {
      return canvas;
    }

    ctx.save();
    ctx.beginPath();
    shapePath(ctx, shape, out / 2, out / 2, out);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    drawSource(ctx, source, view, out / 2, out / 2, out / (size * CROP));
    ctx.restore();

    if (isClearBackground) {
      const pixels = ctx.getImageData(0, 0, out, out);
      clearPaper(pixels.data);
      ctx.putImageData(pixels, 0, 0);
    }

    return canvas;
  };

  // The view: the picture, darkened outside the crop, with the crop's outline, and the preview beside it.
  useEffect(() => {
    const canvas = $canvas.current;
    const ctx = canvas?.getContext('2d');

    if (!canvas || !ctx || !source) {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(0, 0, size, size);
    drawSource(ctx, source, view, size / 2, size / 2, 1);

    const d = size * CROP;

    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    shapePath(ctx, shape, size / 2, size / 2, d);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.fill('evenodd');

    ctx.beginPath();
    shapePath(ctx, shape, size / 2, size / 2, d);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();

    const preview = $preview.current;
    const previewCtx = preview?.getContext('2d');

    if (preview && previewCtx) {
      preview.width = 160;
      preview.height = 160;
      previewCtx.clearRect(0, 0, 160, 160);
      previewCtx.drawImage(render(160), 0, 0);
    }
  });

  const zoomTo = (scale: number) => setView((v) => ({ ...v, scale: Math.min(fit * 8, Math.max(fit * 0.3, scale)) }));

  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const last = pointers.current.get(event.pointerId);

    if (!last) {
      return;
    }

    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      zoomTo(pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist));
      return;
    }

    setView((v) => ({ ...v, x: v.x + event.clientX - last.x, y: v.y + event.clientY - last.y }));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);

    if (pointers.current.size < 2) {
      pinch.current = null;
    }
  };

  // Wheel zoom, kept from scrolling the page.
  useEffect(() => {
    const canvas = $canvas.current;

    if (!canvas) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((v) => ({
        ...v,
        scale: Math.min(fit * 8, Math.max(fit * 0.3, v.scale * Math.exp(-event.deltaY / 400))),
      }));
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => canvas.removeEventListener('wheel', onWheel);
  }, [source, fit]);

  const onAdd = () => {
    let image = render(OUT).toDataURL('image/png');

    // A busy photo can make a big PNG: smaller then, to stay under the limit.
    if (image.length > IMAGE_FIELD_MAX_DATA_URL_LENGTH) {
      image = render(420).toDataURL('image/png');
    }

    if (image.length > IMAGE_FIELD_MAX_DATA_URL_LENGTH) {
      setError(t`This image is too large. Please choose a smaller image.`);
      return;
    }

    onClose(image);
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    void openFile(event.target.files?.[0]);

    // Allow choosing the same file again.
    event.target.value = '';
  };

  return (
    <Dialog open={true} onOpenChange={(value) => (!value ? onClose(null) : null)}>
      <DialogContent position="center" className="max-h-[95dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label || <Trans>Add Image</Trans>}</DialogTitle>

          <DialogDescription>
            {source ? (
              <Trans>Drag to move the stamp into the outline, and zoom until it fills it.</Trans>
            ) : (
              <Trans>Choose an image, such as your company stamp, or take a photo of it.</Trans>
            )}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={$fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="image-field-file-input"
          onChange={onInputChange}
        />

        <input
          ref={$cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onInputChange}
        />

        {camera && (
          <div className="flex flex-col items-center gap-3">
            <video ref={$video} playsInline muted className="max-h-[50vh] w-full rounded-md bg-black object-contain" />

            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={stopCamera}>
                <Trans>Back</Trans>
              </Button>

              <Button type="button" onClick={capture}>
                <Trans>Take Photo</Trans>
              </Button>
            </div>
          </div>
        )}

        {!camera && !source && (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="flex flex-col items-center gap-2 rounded-md border border-border border-dashed bg-white px-2 py-8 text-muted-foreground hover:bg-muted/40"
              onClick={() => $fileInput.current?.click()}
            >
              <ImageIcon className="h-8 w-8" />
              <span className="font-semibold">
                <Trans>Choose Image</Trans>
              </span>
            </button>

            <button
              type="button"
              className="flex flex-col items-center gap-2 rounded-md border border-border border-dashed bg-white px-2 py-8 text-muted-foreground hover:bg-muted/40"
              onClick={() => void takePhoto()}
            >
              <CameraIcon className="h-8 w-8" />
              <span className="font-semibold">
                <Trans>Take Photo</Trans>
              </span>
            </button>
          </div>
        )}

        {!camera && source && (
          <div className="flex flex-col items-center gap-3">
            <div ref={$box} className="w-full max-w-[280px]">
              <canvas
                ref={$canvas}
                className="mx-auto block cursor-grab touch-none rounded-md active:cursor-grabbing"
                style={{ width: size, height: size }}
                aria-label={t`Crop area`}
                data-testid="image-field-crop-area"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />

              <div className="mt-3 flex items-center gap-3">
                <span className="text-muted-foreground text-sm">
                  <Trans>Zoom</Trans>
                </span>

                <Slider
                  min={Math.log(fit * 0.3)}
                  max={Math.log(fit * 8)}
                  step={0.01}
                  value={[Math.log(view.scale)]}
                  onValueChange={([value]) => zoomTo(Math.exp(value))}
                  aria-label={t`Zoom`}
                />
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center justify-center gap-2">
              <div className="flex gap-2" role="radiogroup" aria-label={t`Shape`}>
                <Button
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={shape === 'circle'}
                  variant={shape === 'circle' ? 'default' : 'outline'}
                  onClick={() => setShape('circle')}
                >
                  <Trans>Round</Trans>
                </Button>

                <Button
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={shape === 'square'}
                  variant={shape === 'square' ? 'default' : 'outline'}
                  onClick={() => setShape('square')}
                >
                  <Trans>Square</Trans>
                </Button>
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setView((v) => ({ ...v, turn: (v.turn + 1) % 4 }))}
              >
                <RotateCwIcon className="mr-2 h-4 w-4" />
                <Trans>Turn</Trans>
              </Button>
            </div>

            <div className="flex w-full items-center gap-3">
              {/* On a page's white, as it will be on the document. */}
              <div className="shrink-0 rounded-md border border-border bg-white p-1" title={t`On the page`}>
                <canvas ref={$preview} className="block h-16 w-16" data-testid="image-field-preview" />
              </div>

              <div className="flex min-w-0 flex-col items-start gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="image-field-clear-background"
                    checked={isClearBackground}
                    onCheckedChange={(checked) => setIsClearBackground(checked === true)}
                  />

                  <Label htmlFor="image-field-clear-background" className="font-normal text-sm">
                    <Trans>Make the paper around it clear</Trans>
                  </Label>
                </div>

                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => {
                    setSource(null);
                    setError(null);
                  }}
                >
                  <Trans>Choose Another</Trans>
                </Button>
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}

        <DocumentSigningDisclosure />

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onClose(null)}>
            <Trans>Cancel</Trans>
          </Button>

          <Button type="button" disabled={!source || !!camera} onClick={onAdd}>
            <Trans>Add</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** Draws the source as moved, zoomed and turned, centred on (cx, cy), at `k` times the view's scale. */
const drawSource = (ctx: CanvasRenderingContext2D, s: Source, v: View, cx: number, cy: number, k: number) => {
  ctx.save();
  ctx.translate(cx + v.x * k, cy + v.y * k);
  ctx.rotate((v.turn * Math.PI) / 2);
  ctx.scale(v.scale * k, v.scale * k);
  ctx.drawImage(s.bitmap, -s.width / 2, -s.height / 2);
  ctx.restore();
};

const shapePath = (ctx: CanvasRenderingContext2D, shape: StampShape, cx: number, cy: number, d: number) => {
  if (shape === 'circle') {
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  } else {
    ctx.rect(cx - d / 2, cy - d / 2, d, d);
  }
};

/**
 * Makes the paper clear: pixels near the paper's own brightness fade out and the ink stays. The paper is the light
 * most of the crop, its brightness taken from the 80th percentile of each pixel's darkest channel, so coloured ink
 * (a red or blue stamp) is kept as firmly as black.
 */
const clearPaper = (data: Uint8ClampedArray) => {
  const lows: number[] = [];

  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3] > 0) {
      lows.push(Math.min(data[i], data[i + 1], data[i + 2]));
    }
  }

  if (!lows.length) {
    return;
  }

  lows.sort((a, b) => a - b);

  const paper = lows[Math.floor(lows.length * 0.8)];
  const hi = paper - 12;
  const lo = Math.max(0, paper - 70);

  for (let i = 0; i < data.length; i += 4) {
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    const keep = min <= lo ? 1 : min >= hi ? 0 : (hi - min) / (hi - lo);

    data[i + 3] = Math.round(data[i + 3] * keep);
  }
};

const loadSource = async (file: Blob): Promise<Source> => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_SOURCE / Math.max(bitmap.width, bitmap.height));

  if (k === 1) {
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return { bitmap: canvas, width: canvas.width, height: canvas.height };
};

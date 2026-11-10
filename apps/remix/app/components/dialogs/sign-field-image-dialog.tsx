import { IMAGE_FIELD_MAX_DATA_URL_LENGTH, IMAGE_FIELD_MAX_DIMENSION } from '@documenso/lib/constants/signatures';
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
import { Trans, useLingui } from '@lingui/react/macro';
import { ImageIcon } from 'lucide-react';
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
 * The image is scaled down to fit within `IMAGE_FIELD_MAX_DIMENSION` pixels and exported as a PNG. The paper around
 * a photographed stamp can be made transparent, so the stamp sits on the page as if it were stamped there.
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

/**
 * The dialog itself, for signing views that keep their own dialog state rather than calling `SignFieldImageDialog`.
 */
export const ImageFieldDialog = ({ label, onClose }: ImageFieldDialogProps) => {
  const { t } = useLingui();

  const $fileInput = useRef<HTMLInputElement>(null);

  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [isClearBackground, setIsClearBackground] = useState(true);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceImage) {
      setImageDataUrl(null);
      return;
    }

    const dataUrl = exportImage(sourceImage, isClearBackground);

    if (dataUrl.length > IMAGE_FIELD_MAX_DATA_URL_LENGTH) {
      setImageDataUrl(null);
      setError(t`This image is too large. Please choose a smaller image.`);
      return;
    }

    setError(null);
    setImageDataUrl(dataUrl);
  }, [sourceImage, isClearBackground]);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    // Allow choosing the same file again.
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError(t`Please choose an image file.`);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      if (img.width === 0 || img.height === 0) {
        setError(t`This image could not be read. Please choose another image.`);
        return;
      }

      setSourceImage(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError(t`This image could not be read. Please choose another image.`);
    };

    img.src = objectUrl;
  };

  return (
    <Dialog open={true} onOpenChange={(value) => (!value ? onClose(null) : null)}>
      <DialogContent position="center">
        <DialogHeader>
          <DialogTitle>{label || <Trans>Add Image</Trans>}</DialogTitle>

          <DialogDescription>
            <Trans>Choose an image, such as your company stamp, or take a photo of it.</Trans>
          </DialogDescription>
        </DialogHeader>

        <input
          ref={$fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="image-field-file-input"
          onChange={onFileChange}
        />

        <button
          type="button"
          className="flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-md border border-border border-dashed bg-white p-4"
          onClick={() => $fileInput.current?.click()}
        >
          {imageDataUrl ? (
            <img src={imageDataUrl} alt={label || t`Image`} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-2 text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
              <span className="font-semibold text-lg">
                <Trans>Choose Image</Trans>
              </span>
            </span>
          )}
        </button>

        {error && <p className="text-destructive text-sm">{error}</p>}

        {sourceImage && (
          <div className="flex items-center justify-between gap-4">
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

            <Button type="button" variant="link" className="h-auto p-0" onClick={() => $fileInput.current?.click()}>
              <Trans>Choose Another</Trans>
            </Button>
          </div>
        )}

        <DocumentSigningDisclosure />

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onClose(null)}>
            <Trans>Cancel</Trans>
          </Button>

          <Button type="button" disabled={!imageDataUrl} onClick={() => onClose(imageDataUrl)}>
            <Trans>Add</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * The image scaled down to fit within `IMAGE_FIELD_MAX_DIMENSION` pixels, as a PNG data URL.
 *
 * With `isClearBackground`, pixels close to the paper's brightness fade to transparent and the ink stays. The paper's
 * brightness is taken from the brightest pixels, so a photo in dim light works as well as a scan.
 */
const exportImage = (image: HTMLImageElement, isClearBackground: boolean) => {
  const scale = Math.min(IMAGE_FIELD_MAX_DIMENSION / image.width, IMAGE_FIELD_MAX_DIMENSION / image.height, 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return '';
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  if (isClearBackground) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);

    clearPaper(pixels.data);

    ctx.putImageData(pixels, 0, 0);
  }

  return canvas.toDataURL('image/png');
};

const clearPaper = (data: Uint8ClampedArray) => {
  const brightness = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

  // The paper: the 90th percentile of brightness among visible pixels.
  const histogram = new Array<number>(256).fill(0);
  let visible = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) {
      histogram[Math.round(brightness(i))]++;
      visible++;
    }
  }

  let paper = 255;
  let seen = 0;

  for (let level = 0; level < 256; level++) {
    seen += histogram[level];

    if (seen >= visible * 0.9) {
      paper = level;
      break;
    }
  }

  // Fully clear at the paper's brightness, fully kept 25% darker than it, and faded in between.
  const keep = paper * 0.75;

  for (let i = 0; i < data.length; i += 4) {
    const level = brightness(i);

    if (level >= paper) {
      data[i + 3] = 0;
    } else if (level > keep) {
      data[i + 3] = Math.round(data[i + 3] * ((paper - level) / (paper - keep)));
    }
  }
};

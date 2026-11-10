import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { TFieldImage } from '@documenso/lib/types/field';
import type { TSignEnvelopeFieldValue } from '@documenso/trpc/server/envelope-router/sign-envelope-field.types';
import { FieldType } from '@prisma/client';

import { SignFieldImageDialog } from '~/components/dialogs/sign-field-image-dialog';

type HandleImageFieldClickOptions = {
  field: TFieldImage;
};

/**
 * Asks for the image to place in an image field, or removes the one already placed.
 *
 * Unlike a signature, an image is never reused from another field: a stamp field and a signature field next to each
 * other each get their own image.
 */
export const handleImageFieldClick = async (
  options: HandleImageFieldClickOptions,
): Promise<Extract<TSignEnvelopeFieldValue, { type: typeof FieldType.IMAGE }> | null> => {
  const { field } = options;

  if (field.type !== FieldType.IMAGE) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Invalid field type',
    });
  }

  if (field.inserted) {
    return {
      type: FieldType.IMAGE,
      value: null,
    };
  }

  const image = await SignFieldImageDialog.call({
    label: field.fieldMeta?.label,
  });

  if (!image) {
    return null;
  }

  return {
    type: FieldType.IMAGE,
    value: image,
  };
};

import { useAnalytics } from '@documenso/lib/client-only/hooks/use-analytics';
import { DO_NOT_INVALIDATE_QUERY_ON_MUTATION } from '@documenso/lib/constants/trpc';
import { ZImageFieldMeta } from '@documenso/lib/types/field-meta';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import { trpc } from '@documenso/trpc/react';
import type {
  TRemovedSignedFieldWithTokenMutationSchema,
  TSignFieldWithTokenMutationSchema,
} from '@documenso/trpc/server/field-router/schema';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { useState } from 'react';
import { useRevalidator } from 'react-router';

import { ImageFieldDialog } from '~/components/dialogs/sign-field-image-dialog';

import { DocumentSigningFieldContainer } from './document-signing-field-container';
import { DocumentSigningFieldsLoader, DocumentSigningFieldsUninserted } from './document-signing-fields';
import { useDocumentSigningRecipientContext } from './document-signing-recipient-provider';

export type DocumentSigningImageFieldProps = {
  field: FieldWithSignature;
  onSignField?: (value: TSignFieldWithTokenMutationSchema) => Promise<void> | void;
  onUnsignField?: (value: TRemovedSignedFieldWithTokenMutationSchema) => Promise<void> | void;
};

/**
 * An image field, such as a company stamp: the recipient chooses or photographs an image to place in it.
 */
export const DocumentSigningImageField = ({ field, onSignField, onUnsignField }: DocumentSigningImageFieldProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const { revalidate } = useRevalidator();
  const analytics = useAnalytics();

  const { recipient } = useDocumentSigningRecipientContext();

  const { mutateAsync: signFieldWithToken, isPending: isSignFieldWithTokenLoading } =
    trpc.field.signFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const { mutateAsync: removeSignedFieldWithToken, isPending: isRemoveSignedFieldWithTokenLoading } =
    trpc.field.removeSignedFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const isLoading = isSignFieldWithTokenLoading || isRemoveSignedFieldWithTokenLoading;

  const safeFieldMeta = ZImageFieldMeta.safeParse(field.fieldMeta);
  const label = safeFieldMeta.success ? safeFieldMeta.data.label : undefined;

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  /**
   * Opens the dialog first: the image is inserted once it is chosen.
   */
  const onPreSign = () => {
    setIsDialogOpen(true);

    return false;
  };

  const onImageChosen = async (image: string | null) => {
    setIsDialogOpen(false);

    if (!image) {
      return;
    }

    try {
      const payload: TSignFieldWithTokenMutationSchema = {
        token: recipient.token,
        fieldId: field.id,
        value: image,
        isBase64: true,
      };

      if (onSignField) {
        await onSignField(payload);
        return;
      }

      await signFieldWithToken(payload);

      await revalidate();
    } catch (err) {
      console.error(err);

      analytics.captureException(err, {
        source: 'signing',
        location: 'sign_field',
        fieldType: field.type,
        recipientId: field.recipientId,
      });

      toast({
        title: _(msg`Error`),
        description: _(msg`An error occurred while signing the document.`),
        variant: 'destructive',
      });
    }
  };

  const onRemove = async () => {
    try {
      const payload: TRemovedSignedFieldWithTokenMutationSchema = {
        token: recipient.token,
        fieldId: field.id,
      };

      if (onUnsignField) {
        await onUnsignField(payload);
        return;
      }

      await removeSignedFieldWithToken(payload);

      await revalidate();
    } catch (err) {
      console.error(err);

      analytics.captureException(err, {
        source: 'signing',
        location: 'remove_field',
        fieldType: field.type,
        recipientId: field.recipientId,
      });

      toast({
        title: _(msg`Error`),
        description: _(msg`An error occurred while removing the field.`),
        variant: 'destructive',
      });
    }
  };

  return (
    <DocumentSigningFieldContainer
      field={field}
      onPreSign={onPreSign}
      onSign={async () => setIsDialogOpen(true)}
      onRemove={onRemove}
      type="Image"
    >
      {isLoading && <DocumentSigningFieldsLoader />}

      {!field.inserted && (
        <DocumentSigningFieldsUninserted>{label || <Trans>Image</Trans>}</DocumentSigningFieldsUninserted>
      )}

      {field.inserted && field.signature?.signatureImageAsBase64 && (
        <img
          src={field.signature.signatureImageAsBase64}
          alt={label || _(msg`Image`)}
          className="h-full w-full object-contain"
        />
      )}

      {isDialogOpen && <ImageFieldDialog label={label} onClose={(image) => void onImageChosen(image)} />}
    </DocumentSigningFieldContainer>
  );
};
